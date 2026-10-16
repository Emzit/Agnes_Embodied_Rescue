#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FINAL = path.join(ROOT, 'artifacts/final_rescue');
const DEMO = path.join(ROOT, 'artifacts/demo');
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DEMO, `live-smoke-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });

function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }

function resultValue(response) {
  if (!response?.result) return response?.error || null;
  if (response.result.structuredContent) return response.result.structuredContent;
  const text = response.result.content?.find(item => item.type === 'text')?.text;
  if (text) { try { return JSON.parse(text); } catch { return { text }; } }
  return response.result;
}

function callMcp(method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FINAL_NODE || path.join(ROOT, 'tools/node/bin/node'), [path.join(ROOT, 'scripts/final-rescue/mcp-launch.mjs')], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = '';
    const responses = new Map();
    let nextId = 1;
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`MCP timeout for ${method}`)); }, 30000);
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { const message = JSON.parse(line); if (message.id !== undefined) responses.set(message.id, message); } catch { /* server diagnostics are ignored; evidence comes from JSON-RPC */ }
      }
    });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { if (code && code !== 0) { clearTimeout(timeout); reject(new Error(`MCP exited ${code}`)); } });
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    const request = (id, requestMethod, requestParams = {}) => {
      send({ jsonrpc: '2.0', id, method: requestMethod, params: requestParams });
      const wait = setInterval(() => { if (responses.has(id)) { clearInterval(wait); resolve(responses.get(id)); child.kill('SIGTERM'); } }, 20);
    };
    const id = nextId++;
    send({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'final-dashboard-live-smoke', version: '1.0.0' } } });
    const initWait = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(initWait);
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        request(nextId++, method, params);
      }
    }, 20);
  });
}

function runCall(tool) {
  return callMcp('tools/call', { name: tool, arguments: {} }).then(response => ({ tool, result: resultValue(response), raw: response, source: 'real Robot MCP read-only tools/call' }));
}

const statusRun = spawnSync('/bin/bash', [path.join(ROOT, 'scripts/final-rescue/status.sh')], { cwd: ROOT, env: { ...process.env, FINAL_RUN_DIR: out }, encoding: 'utf8', timeout: 90000 });
const status = readJson(path.join(FINAL, 'stack-status.json'), { available: statusRun.status === 0, command_exit: statusRun.status, stdout: statusRun.stdout?.slice(-1000) });
const calls = [];
for (const tool of ['get_robot_state', 'get_world_state', 'get_observation', 'list_known_locations']) {
  try { calls.push(await runCall(tool)); } catch (error) { calls.push({ tool, error: error.message, source: 'real Robot MCP read-only tools/call' }); }
}
const get = tool => calls.find(item => item.tool === tool)?.result || null;
const robot = get('get_robot_state');
const world = get('get_world_state');
const observation = get('get_observation');
const locations = get('list_known_locations');
const registry = { ...(readJson(path.join(ROOT, 'simulation/final_rescue/world_registry.json'), {}) || {}) };
if (Array.isArray(locations) && locations.length) registry.locations = locations;
const perceptionEvents = observation ? [{ tool: 'get_observation', input: {}, result: observation, backend: 'real_robot_mcp_ros2', source: 'live Robot MCP response' }] : [];
const events = calls.filter(item => item.result).map((item, index) => ({ sequence: index + 1, tool: item.tool, label: item.tool === 'get_robot_state' ? 'navigation state (read-only)' : item.tool, result: item.result, source: item.source, source_timestamp: item.result?.timestamp || item.result?.camera_status?.frame_timestamp || null }));
const camera = observation?.camera_status ? { ...observation.camera_status, evidence_frame: false, image_path: null, note: 'live RGB sensor metadata; image file is not exported by this read-only smoke.' } : { available: false, image_path: null };
const snapshot = {
  schema_version: 1,
  mode: 'LIVE',
  run: 'live-smoke',
  mission_text: '进入实验室寻找失联研究员，并报告环境风险。',
  source: { kind: 'live_read_only_adapter', directory: path.relative(ROOT, out), calls: calls.map(item => item.tool) },
  status,
  provider: readJson(path.join(FINAL, 'provider.json'), null),
  registry,
  world: world || { available: false, source: 'get_world_state unavailable' },
  mission: { available: false, status: 'not_started_by_dashboard', source: 'read-only smoke did not start a mission' },
  robot: robot || { current_location: 'unavailable' },
  dynamic: { cabinet: 'unavailable', corridor_a: 'unavailable', source: 'live smoke is read-only and does not infer a mission event' },
  route: { original: [], alternative: [], blocked: false, source: 'unavailable in read-only smoke' },
  perception: { available: Boolean(observation), events: perceptionEvents, latest_detection: observation?.detections?.at(-1) || null, active: {}, front_min_range: observation?.lidar_obstacle_summary?.front_min_range ?? null, camera },
  camera,
  events,
  mcp_events: calls,
  navigation: robot ? [{ tool: 'get_robot_state', input: {}, result: robot, source: 'real Robot MCP read-only state' }] : [],
  stages: [],
  final_report: { text: '实时 smoke 未启动任务，因此没有新的 final-report.txt。', source: null },
  evidence: { live: true, read_only: true, no_dashboard_control: true, no_hidden_ground_truth: true },
};
writeJson(path.join(out, 'snapshot.json'), snapshot);
writeJson(path.join(out, 'status.json'), status);
writeJson(path.join(out, 'world.json'), world || { available: false });
writeJson(path.join(out, 'perception.json'), observation || { available: false });
writeJson(path.join(out, 'robot-state.json'), robot || { available: false });
writeJson(path.join(out, 'events.json'), events);
fs.writeFileSync(path.join(out, 'final-report.txt'), snapshot.final_report.text + '\n');
writeJson(path.join(DEMO, 'live-current.json'), { directory: out, source: 'scripts/demo/live-smoke.mjs', mode: 'LIVE', read_only: true });
console.log(JSON.stringify({ output: path.relative(ROOT, out), status_exit: statusRun.status, calls: calls.map(item => ({ tool: item.tool, ok: Boolean(item.result), error: item.error || null })) }, null, 2));
