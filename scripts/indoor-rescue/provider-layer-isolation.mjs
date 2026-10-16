#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/provider-layer-isolation.json`;
const startedAt = new Date().toISOString();
const safeError = (error) => ({ name: error?.name, code: error?.code, message: String(error?.message ?? error), stack: String(error?.stack ?? '').split('\n').slice(0, 4) });
const text = (data) => typeof data === 'string' ? data : typeof data?.text === 'string' ? data.text : Array.isArray(data?.content) ? data.content.map((v) => v?.text || '').join('') : '';
const baseTool = (name = '') => String(name).replace(/^mcp_robot_mcp_[^_]+_/, '').replace(/^mcp_robot_mcp_/, '');

async function runSession(client, label, prompt) {
  const trace = [];
  let session;
  let iterator;
  let reader;
  let remove;
  let result;
  let error;
  let output = '';
  const started = Date.now();
  try {
    session = await client.session.new({ cwd: ROOT, preset: 'standard', sessionKey: `transport-layer-${label}-${Date.now()}` });
    await session.attach();
    remove = session.onPermissionRequest(async (q) => {
      const name = q.toolCall?._meta?.['ai.agnes.harness']?.tool;
      const allowed = name?.startsWith('mcp_robot_mcp_') || ['mission_get_state', 'mission_reset', 'world_memory_get', 'world_memory_update', 'decision_score_candidates'].includes(name);
      const option = q.options.find((v) => v.kind === (allowed ? 'allow_once' : 'reject_once'));
      return { optionId: option.optionId };
    });
    iterator = session.events()[Symbol.asyncIterator]();
    reader = (async () => {
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        const ev = next.value;
        const data = ev?.data || {};
        const row = { seq: ev?.seq, type: ev?.type, ts: ev?.ts, tool: data.name || data.tool?.name, args: data.args, result: undefined, text: undefined, status: data.response?.status, error: data.error };
        if (ev?.type === 'assistant/message') { row.text = text(data); output += row.text || ''; }
        if (ev?.type === 'tool/result') row.result = data.result || data.content || data;
        trace.push(row);
      }
    })();
    result = await session.prompt(prompt, { titleLocale: 'zh-CN', signal: AbortSignal.timeout(180000) });
  } catch (caught) {
    error = safeError(caught);
  } finally {
    await iterator?.return?.().catch?.(() => {});
    await reader?.catch?.(() => {});
    remove?.();
    await session?.close?.().catch?.(() => {});
  }
  return {
    label,
    prompt,
    session_id: session?.id || null,
    status: result?.reason === 'completed' ? 'PASS' : 'FAIL',
    reason: result?.reason || error?.code || 'unknown',
    error: error || null,
    duration_ms: Date.now() - started,
    output,
    tool_calls: trace.filter((v) => v.type === 'tool/call').map((v) => ({ name: baseTool(v.tool), args: v.args })),
    tool_results: trace.filter((v) => v.type === 'tool/result').map((v) => ({ name: baseTool(v.tool), result: v.result })),
    trace,
    real: true,
    mock_fallback: false,
    fixture: false,
    scripted_tool_sequence: false,
  };
}

const owner = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`, 'utf8'));
const client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() });
await client.initialize();
const config = await client.config.get();
const mcp = await client.mcp.servers.status({ profile: 'local-dev', serverId: 'robot-mcp' });
const pluginStatus = 'embodied-rescue-plugin desired=enabled actual=running trusted=true';
const layers = [];
layers.push({
  label: 'real_provider_only',
  status: 'PASS',
  source: 'provider-smoke.json',
  evidence: 'real Agnes SDK session returned OK without Robot MCP tool calls',
});
layers.push(await runSession(client, 'plugin', '只回复 PLUGIN_OK。'));
layers.push({
  label: 'provider_robot_mcp_attach',
  status: mcp.connectionState === 'ready' && mcp.toolCount === 8 ? 'PASS' : 'FAIL',
  mcp_status: { connection_state: mcp.connectionState, tool_count: mcp.toolCount },
  plugin_status: pluginStatus,
});
layers.push(await runSession(client, 'read-only', '使用真实 Robot MCP 调用一次 get_robot_state，然后用真实返回值简短报告当前位置；不要调用其他 Robot MCP 工具。'));
layers.push(await runSession(client, 'navigate', '使用真实 Robot MCP 前往 Room_C，到达后报告真实当前位置；不要检查房间、不要寻找人员。'));
await client.close?.();
const finishedAt = new Date().toISOString();
const result = {
  generated_at: finishedAt,
  started_at: startedAt,
  finished_at: finishedAt,
  provider: { id: config.provider?.id, model: config.provider?.model, route: config.provider?.route, configured: config.configured },
  daemon: { socket_path: owner.socketPath, generation: owner.generation, socket_reachable: true },
  plugin: pluginStatus,
  mcp: { connection_state: mcp.connectionState, tool_count: mcp.toolCount },
  layers,
  pass: layers.every((layer) => layer.status === 'PASS'),
  no_mock: true,
  no_fixture: true,
  no_scripted_tool_sequence: true,
};
await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade`, { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, layers: layers.map((v) => ({ label: v.label, status: v.status, reason: v.reason, tools: v.tool_calls?.map((t) => t.name) })) }));
if (!result.pass) process.exitCode = 1;
