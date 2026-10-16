#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const OUT = `${ROOT}/artifacts/interactive-live/provider-runtime-status.json`;
const profile = 'local-dev';
const nodeBin = `${ROOT}/tools/node/bin/node`;
const errorInfo = (error) => ({ code: error?.code, message: String(error?.message ?? error) });
const commandId = (name) => `interactive-runtime-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (data) => typeof data === 'string' ? data : typeof data?.text === 'string' ? data.text : Array.isArray(data?.content) ? data.content.map((item) => item?.text || '').join('') : '';
const eventRecord = (event) => {
  const data = event?.data || {};
  return {
    seq: event?.seq,
    type: event?.type,
    ts: event?.ts,
    origin: event?.origin,
    data: {
      state: data.state,
      reason: data.reason,
      code: data.code || data.error?.code,
      message: data.message || data.error?.message,
      model: data.model,
      route: data.route,
      stopReason: data.stopReason,
      response: data.response ? { status: data.response.status, headerNames: data.response.headerNames } : undefined,
      text: event?.type === 'assistant/message' ? textOf(data) : undefined,
    },
  };
};

async function packageOperation(client, receipt) {
  for (;;) {
    const op = await client.packages.operation.get({ profile, operationId: receipt.operationId });
    if (['failed', 'cancelled'].includes(op.state)) throw new Error(op.lastSafeError?.message || `package operation ${op.state}`);
    if (['completed', 'rolled-back'].includes(op.state)) return op;
    await wait(100);
  }
}
async function resourceOperation(client, receipt) {
  for (;;) {
    const op = await client.resources.operation.get({ profile, operationId: receipt.operationId });
    if (['failed', 'cancelled'].includes(op.state)) throw new Error(op.lastSafeError?.message || `resource operation ${op.state}`);
    if (op.state === 'succeeded') return op;
    await wait(100);
  }
}
async function reconnectManaged(client, identity, serverId) {
  const descriptor = await client.mcp.servers.get({ profile, serverId });
  const receipt = await client.mcp.servers.reconnect({
    profile,
    serverId,
    expectedRevision: descriptor.revision,
    clientId: identity.clientId,
    commandId: commandId(`mcp-reconnect-${serverId}`),
  });
  await resourceOperation(client, receipt);
  let status;
  for (let i = 0; i < 120; i += 1) {
    status = await client.mcp.servers.status({ profile, serverId });
    if (status.connectionState === 'ready') return status;
    await wait(100);
  }
  throw new Error(`MCP_RECONNECT_NOT_READY:${serverId}:${JSON.stringify(status)}`);
}
async function ensurePlugin(client, identity) {
  const source = { type: 'file', ref: 'file:./packages/embodied-rescue-plugin' };
  const inspected = await packageOperation(client, await client.packages.inspect({ ...identity, source, commandId: commandId('plugin-inspect') }));
  let rows = await client.packages.list({ profile });
  let row = rows.packages.find((item) => item.id === 'embodied-rescue-plugin');
  if (!row) await packageOperation(client, await client.packages.install({ ...identity, source, expectedIntegrity: inspected.preview.integrity, commandId: commandId('plugin-install') }));
  else if (row.integrity !== inspected.preview.integrity) await packageOperation(client, await client.packages.update({ ...identity, id: 'embodied-rescue-plugin', source, expectedIntegrity: inspected.preview.integrity, commandId: commandId('plugin-update') }));
  rows = await client.packages.list({ profile }); row = rows.packages.find((item) => item.id === 'embodied-rescue-plugin');
  if (!row?.trusted) await packageOperation(client, await client.packages.trust({ ...identity, id: 'embodied-rescue-plugin', expectedIntegrity: inspected.preview.integrity, capabilityHash: inspected.preview.capabilityHash, commandId: commandId('plugin-trust') }));
  rows = await client.packages.list({ profile }); row = rows.packages.find((item) => item.id === 'embodied-rescue-plugin');
  if (row?.desired !== 'enabled') await packageOperation(client, await client.packages.enable({ ...identity, id: 'embodied-rescue-plugin', commandId: commandId('plugin-enable') }));
  rows = await client.packages.list({ profile }); row = rows.packages.find((item) => item.id === 'embodied-rescue-plugin');
  if (!row || row.desired !== 'enabled' || row.actual !== 'running' || !row.trusted) throw new Error(`PLUGIN_NOT_READY:${JSON.stringify({ desired: row?.desired, actual: row?.actual, trusted: row?.trusted })}`);
  return { id: row.id, desired: row.desired, actual: row.actual, trusted: row.trusted, integrity: row.integrity };
}
async function ensureMcp(client, identity) {
  const definition = { serverId: 'robot-mcp', displayName: 'Real ROS2 Robot MCP Final Rescue', transport: { kind: 'stdio', executable: nodeBin, args: [`${ROOT}/scripts/final-rescue/mcp-launch.mjs`] }, secretBinding: { kind: 'none' } };
  const listed = await client.mcp.servers.list({ profile });
  let descriptor = listed.items.find((item) => item.serverId === 'robot-mcp') || null;
  if (!descriptor) { await resourceOperation(client, await client.mcp.servers.create({ profile, definition, clientId: identity.clientId, commandId: commandId('mcp-create') })); descriptor = await client.mcp.servers.get({ profile, serverId: 'robot-mcp' }); }
  if (descriptor.trust !== 'trusted') { await resourceOperation(client, await client.mcp.servers.trustSet({ profile, serverId: 'robot-mcp', expectedRevision: descriptor.revision, trust: 'trusted', clientId: identity.clientId, commandId: commandId('mcp-trust') })); descriptor = await client.mcp.servers.get({ profile, serverId: 'robot-mcp' }); }
  if (descriptor.desired !== 'enabled') await resourceOperation(client, await client.mcp.servers.enable({ profile, serverId: 'robot-mcp', expectedRevision: descriptor.revision, clientId: identity.clientId, commandId: commandId('mcp-enable') }));
  // A managed MCP row can remain catalog-ready while its one-shot ROS2 child
  // bridge has exited. Reconnect on every interactive stack admission so a
  // stale JsonlBridge handle is never reused by a new mission.
  await reconnectManaged(client, identity, 'robot-mcp');
  let status;
  for (let i = 0; i < 100; i += 1) { status = await client.mcp.servers.status({ profile, serverId: 'robot-mcp' }); if (status.connectionState === 'ready') break; await wait(100); }
  const catalog = await client.mcp.servers.tools.list({ profile, serverId: 'robot-mcp' });
  if (status?.connectionState !== 'ready' || catalog.items.length !== 8) throw new Error(`MCP_NOT_READY:${JSON.stringify({ state: status?.connectionState, tools: catalog.items.length })}`);
  // Keep environment interaction as a separate managed MCP server.  The short
  // id is intentional: Harness derives capabilities.tools.prefix from serverId
  // and validates that prefix against the 32-character manifest limit.
  const environmentDefinition = { serverId: 'envdoor', displayName: 'Real Gazebo Environment Interaction', transport: { kind: 'stdio', executable: nodeBin, args: [`${ROOT}/scripts/final-rescue/environment-interaction-launch.mjs`] }, secretBinding: { kind: 'none' } };
  let environment = (await client.mcp.servers.list({ profile })).items.find((item) => item.serverId === 'envdoor') || null;
  if (!environment) {
    await resourceOperation(client, await client.mcp.servers.create({ profile, definition: environmentDefinition, clientId: identity.clientId, commandId: commandId('environment-create') }));
    environment = await client.mcp.servers.get({ profile, serverId: 'envdoor' });
  }
  if (environment.trust !== 'trusted') {
    await resourceOperation(client, await client.mcp.servers.trustSet({ profile, serverId: 'envdoor', expectedRevision: environment.revision, trust: 'trusted', clientId: identity.clientId, commandId: commandId('environment-trust') }));
    environment = await client.mcp.servers.get({ profile, serverId: 'envdoor' });
  }
  if (environment.desired !== 'enabled') await resourceOperation(client, await client.mcp.servers.enable({ profile, serverId: 'envdoor', expectedRevision: environment.revision, clientId: identity.clientId, commandId: commandId('environment-enable') }));
  await reconnectManaged(client, identity, 'envdoor');
  let environmentStatus;
  for (let i = 0; i < 100; i += 1) { environmentStatus = await client.mcp.servers.status({ profile, serverId: 'envdoor' }); if (environmentStatus.connectionState === 'ready') break; await wait(100); }
  const environmentCatalog = await client.mcp.servers.tools.list({ profile, serverId: 'envdoor' });
  const expectedEnvironmentTools = ['inspect_door', 'open_door'];
  const discoveredEnvironmentTools = environmentCatalog.items.map((item) => item.name).sort();
  if (environmentStatus?.connectionState !== 'ready' || expectedEnvironmentTools.some((name) => !discoveredEnvironmentTools.includes(name))) throw new Error(`ENVIRONMENT_MCP_NOT_READY:${JSON.stringify({ state: environmentStatus?.connectionState, tools: discoveredEnvironmentTools })}`);
  return { connection_state: status.connectionState, tool_count: catalog.items.length, tools: catalog.items.map((item) => item.name).sort(), revision: status.observedRevision, environment_interaction: { server_id: 'envdoor', connection_state: environmentStatus.connectionState, tool_count: environmentCatalog.items.length, tools: discoveredEnvironmentTools, revision: environmentStatus.observedRevision, managed: true } };
}
async function providerSmoke(client, config) {
  const session = await client.session.new({ cwd: ROOT, preset: 'standard', sessionKey: `interactive-provider-smoke-${Date.now()}` });
  await session.attach();
  const output = [];
  const trace = [];
  const iterator = session.events()[Symbol.asyncIterator]();
  const reader = (async () => { for (;;) { const next = await iterator.next(); if (next.done) return; trace.push(eventRecord(next.value)); const data = next.value?.data || {}; if (next.value?.type === 'assistant/message') output.push(textOf(data)); } })();
  let response; let error = null;
  try { response = await session.prompt('只回复 OK。', { titleLocale: 'zh-CN', signal: AbortSignal.timeout(180000) }); } catch (caught) { error = errorInfo(caught); }
  await iterator.return?.().catch?.(() => {}); await reader.catch?.(() => {});
  const result = { session_id: session.id, reason: response?.reason || error?.code || 'unknown', output: output.join(''), error, pass: response?.reason === 'completed' && /\bOK\b/u.test(output.join('')), provider: { id: config.provider?.id, model: config.provider?.model, route: config.provider?.route }, trace };
  await session.close?.().catch?.(() => {});
  return result;
}
async function managedMcpRoundTrip(client) {
  const session = await client.session.new({ cwd: ROOT, preset: 'standard', sessionKey: `interactive-mcp-roundtrip-${Date.now()}` });
  await session.attach();
  session.onPermissionRequest(async (q) => {
    const name = q.toolCall?._meta?.['ai.agnes.harness']?.tool || '';
    const allowed = String(name).includes('mcp_robot_mcp_') || String(name).includes('mcp_envdoor_');
    const option = q.options.find((v) => v.kind === (allowed ? 'allow_once' : 'reject_once')) || q.options[0];
    return { optionId: option.optionId };
  });
  const events = [];
  const iterator = session.events()[Symbol.asyncIterator]();
  const reader = (async () => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      const event = next.value;
      if (event?.type === 'tool/call' || event?.type === 'tool/result') events.push(event);
    }
  })();
  let response = null;
  let error = null;
  try {
    response = await session.prompt(
      '这是实时 MCP readiness probe，不是任务。只读调用必须全部执行一次：'
      + 'Robot MCP 的 get_robot_state、list_known_locations，以及 Environment MCP 的 '
      + 'inspect_door(door_id="D_A_Link")。禁止 navigate_to、open_door、stop_robot 或其他工具。'
      + '每个调用都必须等待真实结果，最后只回复 PROBE_OK。',
      { titleLocale: 'zh-CN', signal: AbortSignal.timeout(120000) },
    );
  } catch (caught) {
    error = errorInfo(caught);
  }
  await iterator.return?.().catch?.(() => {});
  await reader.catch?.(() => {});
  await session.close?.().catch?.(() => {});
  const calls = events.filter((event) => event.type === 'tool/call');
  const results = events.filter((event) => event.type === 'tool/result');
  const names = calls.map((event) => String(event.data?.name || ''));
  const resultText = results.map((event) => textOf(event.data?.result ?? event.data?.content ?? event.data)).join('\n');
  const required = {
    robot_state: names.some((name) => /mcp_robot_mcp_[^_]+_get_robot_state|mcp_robot_mcp_get_robot_state/u.test(name)),
    locations: names.some((name) => /mcp_robot_mcp_[^_]+_list_known_locations|mcp_robot_mcp_list_known_locations/u.test(name)),
    environment_inspect: names.some((name) => /mcp_envdoor_[^_]+_inspect_door|mcp_envdoor_inspect_door/u.test(name)),
  };
  const bridgeClosed = /BRIDGE_CLOSED/u.test(resultText);
  const pass = Object.values(required).every(Boolean) && !bridgeClosed && !error && response?.reason === 'completed';
  return {
    pass,
    attached: true,
    required,
    bridge_closed: bridgeClosed,
    tool_calls: names,
    tool_results: results.length,
    response_reason: response?.reason || null,
    error,
  };
}
const startedAt = new Date().toISOString();
let client; let result; let smokeClient;
try {
  const owner = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`, 'utf8'));
  client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() });
  await client.initialize();
  const config = await client.config.get();
  if (!config.configured || config.provider?.id !== 'agnes-ai' || config.provider?.model !== 'agnes-3.0-flash') throw new Error(`PROVIDER_CONFIG_INVALID:${JSON.stringify({ configured: config.configured, provider: config.provider })}`);
  const identity = { profile, clientId: await client.clientId() };
  const plugin = await ensurePlugin(client, identity);
  const mcp = await ensureMcp(client, identity);
  const managed_mcp_roundtrip = await managedMcpRoundTrip(client);
  if (!managed_mcp_roundtrip.pass) throw new Error(`MANAGED_MCP_ROUNDTRIP_FAILED:${JSON.stringify(managed_mcp_roundtrip)}`);
  await client.close?.().catch?.(() => {});
  client = null;
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    smokeClient = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() });
    await smokeClient.initialize();
    const smokeConfig = await smokeClient.config.get();
    const smoke = await providerSmoke(smokeClient, smokeConfig);
    attempts.push({ attempt, pass: smoke.pass, reason: smoke.reason, session_id: smoke.session_id, trace: smoke.trace, error: smoke.error });
    await smokeClient.close?.().catch?.(() => {});
    smokeClient = null;
    if (smoke.pass) break;
    if (attempt < 2) await wait(1000);
  }
  const smoke = attempts.at(-1);
  result = { generated_at: new Date().toISOString(), started_at: startedAt, pass: Boolean(smoke?.pass), provider: smoke?.provider || { id: config.provider?.id, model: config.provider?.model, route: config.provider?.route }, daemon: { generation: owner.generation, socket_reachable: true }, plugin, mcp, managed_mcp_roundtrip, provider_smoke: smoke, recovery: { max_attempts: 2, attempts, bounded: true, destructive_tool_replay: false }, real: true, mock_fallback: false, fixture: false, scripted_tool_sequence: false };
} catch (error) { result = { generated_at: new Date().toISOString(), started_at: startedAt, pass: false, error: errorInfo(error), real: true, mock_fallback: false, fixture: false, scripted_tool_sequence: false }; }
finally { await smokeClient?.close?.().catch?.(() => {}); await client?.close?.().catch?.(() => {}); }
await mkdir(`${ROOT}/artifacts/interactive-live`, { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, plugin: result.plugin, mcp: result.mcp, managed_mcp_roundtrip: result.managed_mcp_roundtrip || null, smoke: result.provider_smoke ? { pass: result.provider_smoke.pass, reason: result.provider_smoke.reason } : null, error: result.error || null }));
if (!result.pass) process.exitCode = 1;
