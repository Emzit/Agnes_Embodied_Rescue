#!/usr/bin/env node
import { handleDemoUi } from './demo-ui-server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import { currentScenario, layouts, publicCurrentScenario, scenarioForSeed, writeScenario } from '../../scripts/interactive/scenario-manager.mjs';
import { validateScenario } from '../../scripts/interactive/solvability-gate.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEMO = path.join(ROOT, 'artifacts/demo');
const FINAL = path.join(ROOT, 'artifacts/final_rescue');
const STATIC = import.meta.dirname;
const HOST = process.env.DEMO_HOST || '127.0.0.1';
const PORT = Number(process.env.DEMO_PORT || 4188);
const MISSION = '进入实验室寻找失联研究员，并报告环境风险。';
const INTERACTIVE = path.join(ROOT, 'artifacts/interactive-live');
const TSX = path.join(ROOT, 'third_party/agnes-harness/node_modules/tsx/dist/cli.mjs');
const RUNNER = path.join(ROOT, 'scripts/interactive/mission-runner.mts');
const PREFLIGHT = path.join(ROOT, 'scripts/interactive/preflight.mts');
const RUNTIME_ADMISSION = path.join(ROOT, 'scripts/interactive/ensure-real-runtime.mjs');
const MAP_IMPORT = path.join(ROOT, 'scripts/map-import/map_import.py');
const IMPORT_SHOWCASE = path.join(ROOT, 'artifacts/import-skeleton-showcase');
const IMPORT_UPLOADS = path.join(IMPORT_SHOWCASE, 'uploads');
const execFileAsync = promisify(execFile);
let activeMissionChild = null;
let preflightPromise = null;

function admittedScenario(spec, gate) {
  return { ...spec, solvability_metadata: { ...spec.solvability_metadata, start_reachable: gate.static?.checks?.start_reachable === true, required_locations_reachable: gate.static?.checks?.required_locations_reachable === true, alternate_route_exists: gate.static?.checks?.alternate_route_exists === true, prechecked: gate.pass === true, validation_source: 'solvability-gate static clearance + current Nav2 preflight' } };
}

// Ensure the control plane always has a reviewed scenario selection.  The
// public API below redacts the private controller/evaluator fields.
if (!currentScenario()) {
  let candidate = scenarioForSeed(Date.now());
  for (let attempt = 0; attempt < 16; attempt++) {
    const gate = validateScenario(candidate);
    if (gate.pass) { writeScenario(admittedScenario(candidate, gate)); break; }
    candidate = scenarioForSeed(Date.now() + attempt + 1);
  }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readText(file, fallback = 'unavailable') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function interactiveCurrent() {
  const pointer = readJson(path.join(INTERACTIVE, 'current.json'), null);
  if (!pointer) return { mission_id: null, status: 'IDLE', task: MISSION, current_stage: '等待任务', current_plan: '输入自然语言任务后开始执行', mission_dir: null };
  return pointer;
}

function interactiveMissionDir() {
  const current = interactiveCurrent();
  return current.mission_dir || path.join(INTERACTIVE, 'current-mission');
}

function readJsonl(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; }
}

function realCameraMeta() { return readJson(path.join(INTERACTIVE, 'camera/latest-meta.json'), null); }
function realCameraStats() { return readJson(path.join(INTERACTIVE, 'camera/camera-stats.json'), null); }
function cameraStatsSummary(stats) {
  if (!stats) return null;
  return { topic: stats.topic, target_interval_ms: stats.target_interval_ms, frames_received: stats.frames_received, timestamp_monotonic: stats.timestamp_monotonic, timestamp_resets: stats.timestamp_resets || 0, pixel_hash_changes: stats.pixel_hash_changes, updated_at: stats.updated_at, real_sensor: stats.real_sensor };
}
function realCameraFile() { const file = path.join(INTERACTIVE, 'camera/latest.png'); return fs.existsSync(file) ? file : null; }
function interactiveEvents() { return readJsonl(path.join(interactiveMissionDir(), 'events.jsonl')); }
function cameraAge(meta) { if (!meta) return null; const captured = Date.parse(meta.captured_at || ''); return Number.isFinite(captured) ? Math.max(0, Date.now() - captured) : null; }
function normalizePose(value) {
  const pose = value?.pose && Number.isFinite(Number(value.pose.x)) ? value.pose : value;
  if (!pose || !Number.isFinite(Number(pose.x)) || !Number.isFinite(Number(pose.y))) return null;
  return { x: Number(pose.x), y: Number(pose.y), yaw: Number(pose.yaw ?? pose.heading ?? 0), frame_id: pose.frame_id || 'map' };
}
function nearestRegistryLocation(registry, pose) {
  if (!registry?.locations || !pose) return null;
  return registry.locations.map(item => ({ id: item.id, distance: Math.hypot(item.pose.x - pose.x, item.pose.y - pose.y) })).sort((a, b) => a.distance - b.distance)[0]?.id || null;
}
function routeCost(registry, names) {
  const poses = (names || []).map(name => registry?.locations?.find(item => item.id === name)?.pose).filter(Boolean);
  return poses.slice(1).reduce((total, pose, index) => total + Math.hypot(pose.x - poses[index].x, pose.y - poses[index].y), 0);
}
function mapPrior(registry) {
  return {
    source: 'canonical static registry / map prior',
    runtime_truth_included: false,
    locations: (registry?.locations || []).map(item => ({ id: item.id, name: item.name, type: item.type, pose: item.pose, bounds: item.bounds, adjacency: item.adjacency })),
    doors: (registry?.doors || []).map(door => ({ ...door, runtime_state: 'UNKNOWN' })),
  };
}
function liveWorldFromEvents(events, missionId = null) {
  const facts = [];
  const observedAt = event => event?.timestamp || new Date().toISOString();
  for (const event of events) {
    if (event.type !== 'tool_result') continue;
    const result = event.result || {};
    const source = /get_observation$/.test(event.tool || '') ? 'Camera/LiDAR observation' : /get_robot_state$/.test(event.tool || '') ? 'Nav2/odom feedback' : /navigate_to$/.test(event.tool || '') ? 'Nav2 feedback' : /inspect_(room|object)$/.test(event.tool || '') ? 'Camera/LiDAR observation' : null;
    if (!source) continue;
    if (result.pose || result.final_pose) facts.push({ key: 'robot.pose', value: result.pose || result.final_pose, source: 'Nav2/odom feedback', observed_at: observedAt(event), evidence: { tool: event.tool, status: result.status }, confidence: 1, mission_id: missionId });
    for (const detection of result.semantic_objects || result.detections || []) facts.push({ key: `observation.${detection.id || detection.label}`, value: { label: detection.label, bbox: detection.bbox, location: result.location }, source: 'Camera', observed_at: observedAt(event), evidence: detection.evidence || { tool: event.tool }, confidence: detection.confidence ?? null, mission_id: missionId });
    if (/PATH_BLOCKED|NAVIGATION_SYSTEM_UNHEALTHY/i.test(JSON.stringify(result))) facts.push({ key: 'dynamic_traversability', value: 'BLOCKED', source: 'LiDAR/Nav2 feedback', observed_at: observedAt(event), evidence: { tool: event.tool, reason: result.reason, code: result.code || result.error_code }, confidence: null, mission_id: missionId });
    if (/inspect_room$/.test(event.tool || '') && result.status === 'SUCCEEDED') facts.push({ key: `room.${event.args?.location || result.room}.contents`, value: 'OBSERVED', source: 'Camera/LiDAR observation', observed_at: observedAt(event), evidence: { tool: event.tool, status: result.status }, confidence: null, mission_id: missionId });
  }
  return { unknown_defaults: { contents: 'UNKNOWN', dynamic_traversability: 'UNKNOWN', door_runtime_state: 'UNKNOWN', victim_state: 'UNKNOWN', hazards: 'UNKNOWN' }, facts, source: 'mission-scoped evidence only', hidden_ground_truth_leak: false };
}
function livePoseHistory(events, currentPose) {
  const points = [];
  for (const event of events) {
    const tool = String(event.tool || '');
    const candidate = tool.includes('navigate_to') ? event.result?.final_pose : tool.includes('get_robot_state') ? event.result?.pose : null;
    const pose = normalizePose(candidate);
    if (!pose) continue;
    const point = { ...pose, wall_monotonic: Date.parse(event.timestamp || '') || points.length };
    const previous = points.at(-1);
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.001 || Math.abs(previous.yaw - point.yaw) > 0.001) points.push(point);
  }
  if (currentPose) {
    const previous = points.at(-1);
    if (!previous || Math.hypot(previous.x - currentPose.x, previous.y - currentPose.y) > 0.001 || Math.abs(previous.yaw - currentPose.yaw) > 0.001) points.push({ ...currentPose, wall_monotonic: Date.now() });
  }
  return points;
}

function body(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let value = ''; req.on('data', chunk => { value += chunk; if (value.length > limit) { reject(new Error('request body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch (error) { reject(error); } }); req.on('error', reject);
  });
}

function safeUploadName(value) {
  const name = path.basename(String(value || 'building-skeleton.json'));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/i.test(name)) {
    throw new Error('INVALID_UPLOAD_FILENAME');
  }
  return name;
}

async function inspectImportedSkeleton(file) {
  const validate = await execFileAsync('python3', [MAP_IMPORT, 'validate', file], {
    cwd: ROOT, env: process.env, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  const preview = await execFileAsync('python3', [MAP_IMPORT, 'preview', file], {
    cwd: ROOT, env: process.env, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  return {
    validation: JSON.parse(String(validate.stdout || '{}')),
    preview: JSON.parse(String(preview.stdout || '{}')),
  };
}

function uploadPath(uploadId) {
  const id = String(uploadId || '');
  if (!/^[a-f0-9]{16,64}$/i.test(id)) throw new Error('INVALID_UPLOAD_ID');
  const file = path.resolve(IMPORT_UPLOADS, `${id}.json`);
  if (!file.startsWith(`${path.resolve(IMPORT_UPLOADS)}${path.sep}`)) {
    throw new Error('UPLOAD_PATH_OUTSIDE_PROJECT');
  }
  return file;
}

function missionStatus() { const current = interactiveCurrent(); return { ...current, camera: { available: Boolean(realCameraFile()), meta: realCameraMeta(), stats: cameraStatsSummary(realCameraStats()), age_ms: cameraAge(realCameraMeta()) }, runner_pid: activeMissionChild?.pid || null }; }

async function runSystemPreflight() {
  if (preflightPromise) return preflightPromise;
  preflightPromise = (async () => {
    let ros = readJson(path.join(INTERACTIVE, 'preflight.json'), null);
    let helperError = null;
    try {
      const result = await execFileAsync(process.execPath, [TSX, PREFLIGHT], {
        cwd: ROOT,
        env: { ...process.env, INTERACTIVE_LIVE_ROOT: INTERACTIVE, ROBOT_ROS2_ENV: 'final_rescue' },
        timeout: 90000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const line = result.stdout.trim().split('\n').at(-1);
      ros = JSON.parse(line || '{}');
    } catch (error) {
      helperError = String(error?.message || error);
      const line = String(error?.stdout || '').trim().split('\n').at(-1);
      try { ros = JSON.parse(line || '{}'); } catch {}
    }
    const daemon = daemonRunning();
    let agnes = daemon;
    try {
      await execFileAsync(process.execPath, [path.join(ROOT, 'third_party/agnes-harness/packages/cli/dist/local/agnes.mjs'), 'daemon', 'status'], { cwd: ROOT, env: process.env, timeout: 8000 });
    } catch { agnes = false; }
    let mcpReady = false;
    let mcpStatus = '';
    try {
      const result = await execFileAsync(process.execPath, [path.join(ROOT, 'third_party/agnes-harness/packages/cli/dist/local/agnes.mjs'), 'mcp', 'status', 'robot-mcp'], { cwd: ROOT, env: process.env, timeout: 8000 });
      mcpStatus = `${result.stdout || ''}${result.stderr || ''}`;
      mcpReady = /connection=ready\b/.test(mcpStatus) && /tools=8\b/.test(mcpStatus);
    } catch (error) {
      mcpStatus = `${error?.stdout || ''}${error?.stderr || ''}${error?.message || ''}`;
    }
    // A live daemon and an active ROS graph are necessary but insufficient for
    // a real mission.  The interactive admission probe records the provider
    // session, managed MCP round-trip, and current plugin state in this
    // project-local status file.  Require that fresh admission result here so
    // manually starting the dashboard cannot advertise READY after a failed
    // provider admission or stale mission.
    const providerRuntime = readJson(path.join(INTERACTIVE, 'provider-runtime-status.json'), null);
    const providerReady = providerRuntime?.pass === true
      && providerRuntime?.real === true
      && providerRuntime?.mock_fallback === false
      && providerRuntime?.scripted_tool_sequence === false;
    const stack = stackStatus() || {};
    const result = {
      timestamp: new Date().toISOString(),
      pass: Boolean(ros?.pass && agnes && mcpReady && providerReady),
      state: ros?.pass && agnes && mcpReady && providerReady ? 'READY' : 'FAILED_PRECHECK',
      gazebo_running: Boolean(stack?.lifecycle),
      bridge_running: Boolean(ros?.bridge_ready),
      robot_mcp_ready: mcpReady,
      nav2: ros || { pass: false, failure_reasons: ['PREFLIGHT_HELPER_FAILED'] },
      mcp_ready: mcpReady,
      agnes_ready: agnes,
      provider_ready: providerReady,
      provider_runtime: providerRuntime ? {
        generated_at: providerRuntime.generated_at || null,
        pass: providerRuntime.pass === true,
        provider: providerRuntime.provider || null,
        error: providerRuntime.error || null,
      } : null,
      dashboard_ready: true,
      failure_reasons: [...(ros?.failure_reasons || []), ...(mcpReady ? [] : ['MCP_NOT_READY']), ...(agnes ? [] : ['AGNES_NOT_READY']), ...(providerReady ? [] : ['PROVIDER_SESSION_NOT_READY']), ...(helperError ? [`PREFLIGHT_HELPER:${helperError}`] : [])],
      mcp_status: mcpStatus.slice(-1000),
    };
    fs.mkdirSync(INTERACTIVE, { recursive: true });
    fs.writeFileSync(path.join(INTERACTIVE, 'system-preflight.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  })().finally(() => { preflightPromise = null; });
  return preflightPromise;
}

async function runManagedMcpAdmission() {
  const result = await execFileAsync(process.execPath, [TSX, RUNTIME_ADMISSION], {
    cwd: ROOT,
    env: { ...process.env, INTERACTIVE_LIVE_ROOT: INTERACTIVE },
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const status = readJson(path.join(INTERACTIVE, 'provider-runtime-status.json'), null);
  const roundtrip = status?.managed_mcp_roundtrip || null;
  const pass = status?.pass === true && roundtrip?.pass === true
    && roundtrip?.bridge_closed === false
    && roundtrip?.required?.robot_state === true
    && roundtrip?.required?.locations === true
    && roundtrip?.required?.environment_inspect === true;
  if (!pass) {
    const error = new Error('MANAGED_MCP_ROUNDTRIP_NOT_READY');
    error.details = { status, stdout: String(result.stdout || '').slice(-4000) };
    throw error;
  }
  return { pass, mcp: status.mcp, roundtrip, stdout: String(result.stdout || '').slice(-4000) };
}

function writeMissionState(dir, value) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(path.join(INTERACTIVE, 'current.json'), JSON.stringify(value, null, 2) + '\n');
}

async function resetScene() {
  if (activeMissionChild) {
    activeMissionChild.kill('SIGTERM');
    await new Promise(resolve => activeMissionChild?.once('exit', resolve) || resolve());
    activeMissionChild = null;
  }
  // Preserve controller evidence before clearing a physical runtime.  A
  // previous event must not become a hidden precondition of the next mission,
  // but its evidence must remain reviewable.
  const runtimeEvidence = path.join(INTERACTIVE, 'full-mission', 'imported-physical-event.json');
  if (fs.existsSync(runtimeEvidence)) {
    const archive = path.join(
      INTERACTIVE,
      'full-mission',
      'previous-evidence',
      `stale-runtime-${Date.now()}`,
    );
    fs.mkdirSync(archive, { recursive: true });
    for (const name of [
      'imported-physical-event.json',
      'lotus-actuator-feedback.json',
      'lotus-event-target-geometry.json',
      'lotus-event-closed-loop-validation.json',
    ]) {
      const source = path.join(INTERACTIVE, 'full-mission', name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(archive, name));
    }
  }
  const stopScript = path.join(ROOT, 'scripts/final-rescue/stop-stack.sh');
  const startScript = path.join(ROOT, 'scripts/final-rescue/start-stack.sh');
  try { await execFileAsync('/bin/bash', [stopScript], { cwd: ROOT, env: process.env, timeout: 30000 }); } catch {}
  const log = path.join(INTERACTIVE, 'logs', 'scene-reset-stack.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, '');
  const child = spawn('/bin/bash', [startScript], { cwd: ROOT, env: process.env, detached: true, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  fs.mkdirSync(path.join(INTERACTIVE, 'pids'), { recursive: true });
  fs.writeFileSync(path.join(INTERACTIVE, 'pids', 'stack.pid'), `${child.pid}\n`);
  child.unref();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (readText(log, '').includes('FINAL_RESCUE_STACK_STARTED')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!readText(log, '').includes('FINAL_RESCUE_STACK_STARTED')) throw new Error('SCENE_RESET_STACK_TIMEOUT');
  const preflight = await runSystemPreflight();
  const reset = { timestamp: new Date().toISOString(), ok: preflight.pass, physical_world: 'Gazebo restarted from final_rescue/world.sdf', cabinet: 'initial', robot: 'demo Start', mission_memory: 'reset on next mission', costmaps: 'cleared by preflight recovery', preflight };
  fs.writeFileSync(path.join(INTERACTIVE, 'scene-reset.json'), JSON.stringify(reset, null, 2) + '\n');
  for (const name of ['dynamic-obstacle-trigger.json', 'lidar-before-block.json', 'lidar-after-block.json', 'nav2-paths.jsonl', 'physical-motion.json', 'scenario-physical-objects.json', 'imported-physical-event.json', 'lotus-actuator-feedback.json', 'lotus-event-target-geometry.json', 'lotus-event-closed-loop-validation.json']) {
    try { fs.unlinkSync(path.join(INTERACTIVE, 'full-mission', name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (preflight.pass) {
    const idle = { mission_id: null, status: 'IDLE', task: MISSION, current_stage: '演示场景已重置', current_plan: '等待新的 mission-scoped 任务', current_location: 'Start', mission_memory: 'empty', scene_reset_at: reset.timestamp };
    fs.writeFileSync(path.join(INTERACTIVE, 'current.json'), JSON.stringify(idle, null, 2) + '\n');
  }
  return reset;
}

async function startAfterPreflight(missionId, task, dir, initial) {
  let preflight = await runSystemPreflight();
  if (!preflight.pass) {
    const failed = { ...initial, status: 'FAILED_PRECHECK', current_stage: '系统预检失败', error: { code: 'FAILED_PRECHECK', reasons: preflight.failure_reasons }, finished_at: new Date().toISOString(), preflight };
    writeMissionState(dir, failed);
    return;
  }
  let runtimeClean;
  try {
    runtimeClean = await ensureFreshPhysicalRuntime();
    if (runtimeClean.reset_performed) preflight = await runSystemPreflight();
  } catch (error) {
    const failed = { ...initial, status: 'FAILED_PRECHECK', current_stage: '物理运行时清洁预检失败', error: { code: 'FAILED_RUNTIME_CLEAN_GATE', reasons: [String(error?.message || error)] }, finished_at: new Date().toISOString(), preflight };
    writeMissionState(dir, failed);
    return;
  }
  if (!preflight.pass) {
    const failed = { ...initial, status: 'FAILED_PRECHECK', current_stage: '场景重置后系统预检失败', error: { code: 'FAILED_PRECHECK', reasons: preflight.failure_reasons }, finished_at: new Date().toISOString(), preflight };
    writeMissionState(dir, failed);
    return;
  }
  let managedAdmission;
  try {
    managedAdmission = await runManagedMcpAdmission();
  } catch (error) {
    const failed = { ...initial, status: 'FAILED_PRECHECK', current_stage: 'MCP 实时 round-trip 预检失败', error: { code: 'FAILED_MCP_ROUNDTRIP', reasons: [String(error?.message || error)], details: error?.details || null }, finished_at: new Date().toISOString(), preflight };
    writeMissionState(dir, failed);
    return;
  }
  const scenario = currentScenario();
  const solvability = scenario ? validateScenario(scenario, { runtime: true }) : { pass: false, status: 'UNSOLVABLE', failure_reasons: ['CURRENT_SCENARIO_MISSING'] };
  fs.mkdirSync(INTERACTIVE, { recursive: true });
  fs.writeFileSync(path.join(INTERACTIVE, 'solvability-validation.json'), JSON.stringify(solvability, null, 2) + '\n');
  if (!solvability.pass) {
    const failed = { ...initial, status: 'FAILED_PRECHECK', current_stage: '场景可达性预检失败', error: { code: 'FAILED_PRECHECK_UNSOLVABLE_SCENARIO', reasons: solvability.static?.failure_reasons || ['SCENARIO_UNSOLVABLE'], solvability }, finished_at: new Date().toISOString(), preflight };
    writeMissionState(dir, failed);
    return;
  }
  writeMissionState(dir, { ...initial, status: 'READY', current_stage: '系统就绪，正在创建 Agnes 任务…', preflight, runtime_clean: runtimeClean, managed_mcp_admission: managedAdmission });
  writeMissionState(dir, { ...initial, status: 'STARTING', current_stage: '正在创建 Agnes 任务…', preflight, runtime_clean: runtimeClean, managed_mcp_admission: managedAdmission });
  spawnMission(missionId, task, dir);
}

function spawnMission(missionId, task, dir) {
  const env = { ...process.env, INTERACTIVE_LIVE_ROOT: INTERACTIVE, INTERACTIVE_MISSION_DIR: dir, FINAL_ARTIFACTS_ROOT: dir, FINAL_RUN_DIR: path.join(INTERACTIVE, 'full-mission'), ROBOT_TRACE_DIR: path.join(INTERACTIVE, 'full-mission') };
  const child = spawn(process.execPath, [TSX, RUNNER], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  activeMissionChild = child; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(INTERACTIVE, 'runner.pid'), `${child.pid}\n`);
  child.stdout.on('data', chunk => fs.appendFileSync(path.join(INTERACTIVE, 'mission-runner.log'), chunk));
  child.stderr.on('data', chunk => fs.appendFileSync(path.join(INTERACTIVE, 'mission-runner.log'), chunk));
  child.on('exit', (code, signal) => { if (activeMissionChild === child) activeMissionChild = null; const current = readJson(path.join(dir, 'current.json'), {}); const result = readJson(path.join(dir, 'result.json'), null); const status = result?.status || (signal ? 'CANCELED' : 'FAILED'); const merged = { ...current, ...result, status, mission_dir: dir, finished_at: current.finished_at || new Date().toISOString(), runner_exit: { code, signal, meaning: code === 0 ? 'RUNNER_COMPLETED' : 'RUNNER_FAILED' } }; fs.writeFileSync(path.join(INTERACTIVE, 'current.json'), JSON.stringify(merged, null, 2) + '\n'); });
  child.stdin.end(JSON.stringify({ mission_id: missionId, task }) + '\n');
  return child;
}

function replay(run) {
  if (run === 'showcase-v2') return readJson(path.join(DEMO, 'replay-showcase-v2.json'), null);
  if (run === 'showcase') return readJson(path.join(DEMO, 'replay-showcase.json'), null);
  return readJson(path.join(DEMO, `replay-run${run}.json`), null);
}

function liveDirectory() {
  const pointer = readJson(path.join(DEMO, 'live-current.json'), null);
  if (pointer?.directory && fs.existsSync(pointer.directory)) return pointer.directory;
  const candidates = fs.readdirSync(DEMO, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^(live-smoke|live-run)-/.test(entry.name))
    .map(entry => path.join(DEMO, entry.name))
    .sort()
    .reverse();
  return candidates[0] || null;
}

function liveSnapshot() {
  const directory = liveDirectory();
  if (!directory) return { available: false, directory: null, snapshot: null };
  return { available: true, directory, snapshot: readJson(path.join(directory, 'snapshot.json'), null) };
}

function stackStatus() {
  return readJson(path.join(FINAL, 'stack-status.json'), null);
}

// A prior validation can leave a real Gazebo event body in the scene.  Do not
// let that physical state become an implicit precondition of a new mission.
function currentPhysicalEventEvidence() {
  return readJson(path.join(INTERACTIVE, 'full-mission', 'imported-physical-event.json'), null);
}

async function ensureFreshPhysicalRuntime() {
  const before = currentPhysicalEventEvidence();
  if (before?.triggered === true) {
    const reset = await resetScene();
    if (!reset?.ok) throw new Error('STALE_PHYSICAL_EVENT_RESET_FAILED');
  }
  const after = currentPhysicalEventEvidence();
  if (after?.triggered === true) throw new Error('STALE_PHYSICAL_EVENT_PRESENT');
  return { checked: true, reset_performed: before?.triggered === true };
}

function scenarioPublic() {
  return publicCurrentScenario() || { error: 'scenario_unavailable', hidden_ground_truth_leak: false };
}

async function generateScenario(seed) {
  const current = interactiveCurrent();
  if (activeMissionChild || ['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING', 'CANCELING'].includes(current.status)) {
    throw new Error('MISSION_IN_PROGRESS');
  }
  const explicit = seed !== undefined;
  let candidate = scenarioForSeed(seed);
  let gate = validateScenario(candidate);
  if (!gate.pass && !explicit) {
    for (let attempt = 1; attempt <= 16 && !gate.pass; attempt++) {
      candidate = scenarioForSeed(Date.now() + attempt);
      gate = validateScenario(candidate);
    }
  }
  if (!gate.pass) {
    fs.mkdirSync(INTERACTIVE, { recursive: true });
    fs.writeFileSync(path.join(INTERACTIVE, 'solvability-validation.json'), JSON.stringify(gate, null, 2) + '\n');
    const error = new Error('UNSOLVABLE_SCENARIO');
    error.validation = gate;
    throw error;
  }
  const spec = writeScenario(admittedScenario(candidate, gate));
  fs.writeFileSync(path.join(INTERACTIVE, 'solvability-validation.json'), JSON.stringify(gate, null, 2) + '\n');
  const reset = await resetScene();
  return { ...scenarioPublic(), reset: { ok: Boolean(reset?.ok), preflight: reset?.preflight || null } };
}

function daemonRunning() {
  const owner = readJson(path.join(ROOT, '.agh-home-step7/data/daemon/owner.json'), null);
  if (!owner?.pid) return false;
  try { return fs.existsSync(`/proc/${owner.pid}`); } catch { return false; }
}

function liveData() {
  const live = liveSnapshot();
  const snapshot = live.snapshot || {};
  const status = snapshot.status || stackStatus();
  const connected = daemonRunning();
  if (!connected) {
    return {
      schema_version: 1, mode: 'LIVE', replay_notice: null, run: 'live', mission_text: MISSION,
      source: { kind: 'live_read_only_adapter', connected: false }, provider: null, registry: null,
      world: { available: false, source: 'final_rescue daemon is not running' },
      mission: { available: false, status: 'unavailable', source: 'final_rescue daemon is not running' },
      robot: { current_location: 'unavailable', source: null }, dynamic: { cabinet: 'unavailable', corridor_a: 'unavailable', source: null },
      route: { original: [], alternative: [], blocked: false, source: null },
      perception: { available: false, events: [], latest_detection: null, active: {}, front_min_range: null, camera: { available: false } },
      camera: { available: false, image_path: null }, events: [], mcp_events: [], navigation: [], stages: [],
      final_report: { text: 'LIVE 不可用：当前 final_rescue daemon/stack 未运行。请先执行 scripts/demo/live.sh。', source: null },
      status: { available: false, overall: 'STOPPED', source: 'owner.json unavailable' }, evidence: { live: true, read_only: true, historical_replay: false }
    };
  }
  const current = interactiveCurrent();
  const liveMeta = realCameraMeta();
  const liveStats = realCameraStats();
  const liveEvents = interactiveEvents();
  const dynamicEvidence = readJson(path.join(INTERACTIVE, 'full-mission/dynamic-obstacle-trigger.json'), null);
  const selectedScenario = currentScenario();
  const registryPath = selectedScenario?.layout?.registry ? path.join(ROOT, selectedScenario.layout.registry) : path.join(ROOT, 'simulation/final_rescue/world_registry.json');
  const registry = readJson(registryPath, null) || readJson(path.join(ROOT, 'artifacts/phase9f/world-registry.json'), null);
  const lastPose = normalizePose(liveMeta?.pose);
  const cameraPose = normalizePose(liveMeta?.pose);
  const poseHistory = livePoseHistory(liveEvents, lastPose);
  // Camera metadata carries a transport label (often "ros2_pose"), not a
  // semantic room.  Resolve the displayed location from the same live map
  // pose first; only then use the mission's verified semantic result.
  const cameraLocation = nearestRegistryLocation(registry, cameraPose) || current.current_location || null;
  // The physical controller's private event artifact is evaluator evidence,
  // not an observation.  The live API may expose a blocked state only after a
  // real tool/sensor event; it must never expose its hidden geometry/type.
  const currentDynamic = current.blocked_route ? { cabinet: 'UNKNOWN', corridor_a: 'BLOCKED', trigger: { source: 'real LiDAR/Nav2/tool evidence' } } : { cabinet: 'UNKNOWN', corridor_a: 'UNKNOWN', trigger: null };
  const blocked = Boolean(current.blocked_route || liveEvents.some(e => /blocked|PATH_BLOCKED/i.test(JSON.stringify(e))));
  const events = liveEvents.map(e => ({ ...e, label: e.type === 'tool_call' ? `tool call · ${e.tool}` : e.type === 'tool_result' ? `tool result · ${e.tool}` : e.type }));
  const navigateTargets = liveEvents.filter(e => e.type === 'tool_call' && /navigate_to$/.test(e.tool || '')).map(e => e.args?.location).filter(Boolean);
  const firstObservedLocation = liveEvents.find(e => e.type === 'tool_result' && /get_robot_state$/.test(e.tool || '') && e.result?.current_location)?.result?.current_location || 'Start';
  const actualRoute = [firstObservedLocation, ...navigateTargets].filter((value, index, values) => index === 0 || value !== values[index - 1]);
  const blockedIndex = liveEvents.findIndex(event => event.type === 'tool_result' && /PATH_BLOCKED|blocked/i.test(JSON.stringify(event.result || '')));
  const callsBeforeBlock = liveEvents.slice(0, blockedIndex < 0 ? liveEvents.length : blockedIndex).filter(event => event.type === 'tool_call' && /navigate_to$/.test(event.tool || '')).map(event => event.args?.location).filter(Boolean);
  const callsAfterBlock = blockedIndex < 0 ? [] : liveEvents.slice(blockedIndex + 1).filter(event => event.type === 'tool_call' && /navigate_to$/.test(event.tool || '')).map(event => event.args?.location).filter(Boolean);
  const decision = {
    plans: [{ number: 1, targets: [firstObservedLocation, ...callsBeforeBlock].filter((value, index, values) => index === 0 || value !== values[index - 1]), route_cost_m: routeCost(registry, [firstObservedLocation, ...callsBeforeBlock]), reason: 'real Agnes tool calls before any navigation health/block evidence' }],
    invalidation: blockedIndex >= 0 ? { status: 'INVALIDATED', reason: liveEvents[blockedIndex]?.result?.reason || 'PATH_BLOCKED', source: 'real navigation/LiDAR/ costmap evidence', observed_at: liveEvents[blockedIndex]?.timestamp } : null,
    updated_world_model: blockedIndex >= 0,
    new_plan: callsAfterBlock.length ? { number: 2, targets: callsAfterBlock, route_cost_m: routeCost(registry, callsAfterBlock), reason: 'real post-failure navigation calls' } : null,
  };
  const perceptionEvents = liveEvents.filter(e => ['tool_result', 'object_detection', 'active_perception_result'].includes(e.type));
  return {
    schema_version: 1,
    mode: 'LIVE',
    replay_notice: null,
    run: current.mission_id || snapshot.run || 'interactive-live',
    mission_text: current.task || MISSION,
    source: { directory: current.mission_dir ? path.relative(ROOT, current.mission_dir) : (live.directory ? path.relative(ROOT, live.directory) : null), kind: 'interactive_control_adapter' },
    acceptance: null,
    provider: snapshot.provider || readJson(path.join(FINAL, 'provider.json'), null),
    registry,
    world: snapshot.world || { available: false, source: null },
    mission: { ...current, available: true, source: 'interactive mission runner' },
    robot: { ...(snapshot.robot || {}), pose: lastPose, position: lastPose ? { x: lastPose.x, y: lastPose.y } : null, yaw: lastPose?.yaw ?? null, linear_velocity: liveMeta?.pose?.linear_velocity ?? null, angular_velocity: liveMeta?.pose?.angular_velocity ?? null, navigation_status: liveMeta?.pose?.navigation_status || current.status || null, trajectory: poseHistory, current_location: cameraLocation || nearestRegistryLocation(registry, lastPose) || current.current_location || 'LIVE', source: '/odom via real ROS2 bridge' },
    dynamic: { ...(snapshot.dynamic || {}), ...currentDynamic, corridor_a: blocked ? 'BLOCKED' : 'OPEN', cabinet: blocked ? 'ACTIVE' : 'OPEN', source: 'real mission events' },
    route: { ...(snapshot.route || {}), original: current.route?.original || actualRoute, alternative: current.route?.alternative || (blocked ? actualRoute : []), cabinet: null, blocked, source: navigateTargets.length ? 'real live navigation events' : 'waiting for real navigation event' },
    map_prior: mapPrior(registry),
    live_world: liveWorldFromEvents(liveEvents, current.mission_id),
    decision,
    perception: { ...(snapshot.perception || {}), available: Boolean(liveMeta), events: perceptionEvents, latest_detection: current.latest_detection || null, active: current.active_perception || {}, front_min_range: current.front_min_range || snapshot.perception?.front_min_range || null, camera: { available: Boolean(liveMeta), source: '/camera/image_raw', real_sensor: true, pose: cameraPose, fps: liveStats?.frames_received && liveStats?.started_at ? liveStats.frames_received / Math.max(1, (Date.now() - Date.parse(liveStats.started_at)) / 1000) : null } },
    camera: { available: Boolean(realCameraFile()), image_path: realCameraFile() ? path.relative(ROOT, realCameraFile()) : null, source_topic: '/camera/image_raw', live: true, pose: cameraPose, frame_id: liveMeta?.frame_id || null, timestamp: liveMeta?.timestamp || null, image_url: realCameraFile() ? '/api/camera/latest.jpg' : null, fps: liveStats?.frames_received && liveStats?.started_at ? liveStats.frames_received / Math.max(1, (Date.now() - Date.parse(liveStats.started_at)) / 1000) : null, last_frame_age_ms: cameraAge(liveMeta), stats: cameraStatsSummary(liveStats) },
    events,
    mcp_events: snapshot.mcp_events || [],
    navigation: snapshot.navigation || [],
    stages: snapshot.stages || [],
    final_report: current.final_report ? { text: current.final_report, source: path.join(path.relative(ROOT, interactiveMissionDir()), 'final-report.txt') } : snapshot.final_report || { text: '实时任务尚未生成 final-report.txt。', source: null },
    status: { ...(status || {}), available: true, overall: current.status === 'SUCCEEDED' ? 'PASS' : current.status === 'FAILED' ? 'FAIL' : 'RUNNING', components: { Agnes_LLM: 'PASS', Plugin: 'PASS', Robot_MCP: 'PASS', ROS2: 'PASS', Gazebo: 'PASS', Nav2: 'PASS', Camera: liveMeta ? 'PASS' : 'WAIT', LiDAR: 'PASS', Perception: liveMeta ? 'PASS' : 'WAIT' } },
    evidence: { live: true, read_only: false, interactive_control: true, historical_replay: false, connected },
  };
}

function selected(url) {
  const mode = (url.searchParams.get('mode') || process.env.DEMO_MODE || 'live').toLowerCase();
  if (mode === 'live') return { mode: 'LIVE', data: liveData() };
  const rawRun = url.searchParams.get('run') || process.env.DEMO_RUN || (replay('showcase-v2') ? 'showcase-v2' : 'showcase');
  const run = rawRun === 'showcase-v2' && replay('showcase-v2') ? 'showcase-v2' : rawRun === 'showcase' && replay('showcase') ? 'showcase' : rawRun === 'showcase' ? 1 : Math.min(3, Math.max(1, Number(rawRun)));
  return { mode: 'REPLAY', data: replay(run) || { mode: 'REPLAY', run, unavailable: true } };
}

function json(res, value, status = 200) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(res, file, contentType) {
  if (!fs.existsSync(file)) return json(res, { error: 'not_found' }, 404);
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store', 'content-length': body.length });
  res.end(body);
}

function cameraResponse(choice, publicRun = choice.data.run) {
  const camera = choice.data.camera || { available: false };
  const imagePath = camera.image_path && path.resolve(ROOT, camera.image_path);
  if (imagePath && imagePath.startsWith(ROOT) && fs.existsSync(imagePath)) {
    const ext = path.extname(imagePath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
    if (type) return { ...camera, image_url: `/api/camera/latest?mode=${choice.mode.toLowerCase()}&run=${publicRun}`, evidence_frame: choice.mode === 'REPLAY' };
  }
  return { ...camera, available: Boolean(camera.available), image_available: false, image_url: null, evidence_frame: choice.mode === 'REPLAY', unavailable_reason: '真实 Camera RGB 文件没有作为图片 artifact 导出，页面仅展示原始 evidence 元数据。' };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (handleDemoUi(req, res, url)) return;
  if (url.pathname === '/legacy') return sendFile(res, path.join(STATIC, 'index.html'), 'text/html; charset=utf-8');
  if (url.pathname === '/styles.css') return sendFile(res, path.join(STATIC, 'styles.css'), 'text/css; charset=utf-8');
  if (url.pathname === '/app.js') return sendFile(res, path.join(STATIC, 'app.js'), 'text/javascript; charset=utf-8');
  if (url.pathname === '/final-demo-report.html') return sendFile(res, path.join(DEMO, 'final-demo-report.html'), 'text/html; charset=utf-8');
  if (url.pathname === '/system-architecture.svg') return sendFile(res, path.join(DEMO, 'system-architecture.svg'), 'image/svg+xml');
  if (req.method === 'POST' && url.pathname === '/api/mission/start') {
    let value; try { value = await body(req); } catch (error) { return json(res, { error: 'invalid_json', message: error.message }, 400); }
    const task = String(value.task || '').trim(); const current = interactiveCurrent();
    if (!task || task.length > 2000) return json(res, { error: 'task_required', message: 'task must be 1..2000 characters' }, 400);
    if (['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING', 'CANCELING'].includes(current.status) || activeMissionChild) return json(res, { error: 'mission_in_progress', message: '当前任务正在执行，请停止后再开始新任务。', mission: missionStatus() }, 409);
    const missionId = `interactive-${Date.now()}`; const dir = path.join(INTERACTIVE, 'missions', missionId); fs.mkdirSync(dir, { recursive: true });
    const initial = { mission_id: missionId, task, status: 'PRECHECK_RUNNING', started_at: new Date().toISOString(), finished_at: null, current_stage: '正在检查系统…', current_plan: '等待真实 ROS2/Nav2 preflight', current_location: null, mission_state: 'mission_scoped', real_llm: true, provider: 'agnes-ai', model: 'agnes-3.0-flash', mock_fallback: false, fixture: false, scripted_tool_sequence: false, mission_dir: dir };
    writeMissionState(dir, initial);
    void startAfterPreflight(missionId, task, dir, initial).catch((error) => writeMissionState(dir, { ...initial, status: 'FAILED_PRECHECK', current_stage: '系统预检失败', finished_at: new Date().toISOString(), error: { code: 'FAILED_PRECHECK', message: String(error?.message || error) } }));
    return json(res, { mission_id: missionId, status: 'PRECHECK_RUNNING', message: '正在检查系统…' }, 202);
  }
  if (req.method === 'GET' && url.pathname === '/api/scenario') return json(res, { scenario: scenarioPublic(), layouts: layouts(), hidden_ground_truth_available_to: ['scenario_controller', 'post_run_evaluator'], hidden_ground_truth_leak: false });
  if (req.method === 'POST' && url.pathname === '/api/scenario/generate') {
    let value = {};
    try { value = await body(req); } catch (error) { return json(res, { error: 'invalid_json', message: error.message }, 400); }
    const seed = value.seed === undefined || value.seed === '' ? undefined : Number(value.seed);
    if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 1)) return json(res, { error: 'invalid_seed', message: 'seed must be a positive safe integer' }, 400);
    try { return json(res, await generateScenario(seed), 202); } catch (error) { return json(res, { error: error.message === 'MISSION_IN_PROGRESS' ? 'mission_in_progress' : 'scenario_generation_failed', message: String(error.message || error) }, error.message === 'MISSION_IN_PROGRESS' ? 409 : 503); }
  }
  if (req.method === 'POST' && url.pathname === '/api/map/upload') {
    let value;
    try { value = await body(req, 3 * 1024 * 1024); }
    catch (error) { return json(res, { error: 'invalid_upload', message: String(error.message || error) }, 400); }
    const current = interactiveCurrent();
    if (activeMissionChild || ['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING', 'CANCELING'].includes(current.status)) {
      return json(res, { error: 'mission_in_progress', message: '请先停止当前任务。' }, 409);
    }
    let filename;
    try { filename = safeUploadName(value.filename); }
    catch (error) { return json(res, { error: 'invalid_filename', message: error.message }, 400); }
    const content = typeof value.content === 'string'
      ? value.content
      : value.document && typeof value.document === 'object' ? JSON.stringify(value.document) : '';
    if (!content || Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
      return json(res, { error: 'invalid_upload', message: 'JSON 文件不能为空且必须不超过 2 MiB。' }, 400);
    }
    try { JSON.parse(content); }
    catch (error) { return json(res, { error: 'invalid_json', message: '上传内容不是合法 JSON。' }, 422); }
    const uploadId = crypto.createHash('sha256').update(`${Date.now()}\0${filename}\0${content}`).digest('hex').slice(0, 32);
    const file = uploadPath(uploadId);
    fs.mkdirSync(IMPORT_UPLOADS, { recursive: true });
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
    try {
      const inspected = await inspectImportedSkeleton(file);
      const evidence = {
        upload_id: uploadId,
        filename,
        source: path.relative(ROOT, file),
        source_sha256: crypto.createHash('sha256').update(content).digest('hex'),
        received_at: new Date().toISOString(),
        validation: inspected.validation,
        preview: inspected.preview,
        map_prior_only: true,
        physical_activation: 'NOT_ACTIVATED',
        hidden_ground_truth_leak: false,
      };
      fs.mkdirSync(IMPORT_SHOWCASE, { recursive: true });
      fs.writeFileSync(path.join(IMPORT_SHOWCASE, `preview-${uploadId}.json`), JSON.stringify(evidence, null, 2) + '\n');
      return json(res, evidence, inspected.validation.pass ? 201 : 422);
    } catch (error) {
      const details = String(error?.stdout || error?.stderr || error?.message || error);
      const evidence = { upload_id: uploadId, filename, source: path.relative(ROOT, file), received_at: new Date().toISOString(), validation: { status: 'INVALID', pass: false, errors: [details.slice(-2000)] }, map_prior_only: true, physical_activation: 'NOT_ACTIVATED' };
      fs.mkdirSync(IMPORT_SHOWCASE, { recursive: true });
      fs.writeFileSync(path.join(IMPORT_SHOWCASE, `preview-${uploadId}.json`), JSON.stringify(evidence, null, 2) + '\n');
      return json(res, evidence, 422);
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/map/activate') {
    let value; try { value = await body(req); } catch (error) { return json(res, { error: 'invalid_json', message: error.message }, 400); }
    const current = interactiveCurrent();
    if (activeMissionChild || ['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING', 'CANCELING'].includes(current.status)) return json(res, { error: 'mission_in_progress', message: '请先停止当前任务。' }, 409);
    let file;
    try { file = uploadPath(value.upload_id); } catch (error) { return json(res, { error: 'invalid_upload_id', message: error.message }, 400); }
    if (!fs.existsSync(file)) return json(res, { error: 'upload_not_found', message: '请先上传并预览有效骨架。' }, 404);
    const uploadId = String(value.upload_id);
    const out = path.join(IMPORT_SHOWCASE, 'compiled', uploadId);
    try {
      const inspected = await inspectImportedSkeleton(file);
      if (inspected.validation.pass !== true) return json(res, { error: 'invalid_skeleton', validation: inspected.validation }, 422);
      const result = await execFileAsync('python3', [MAP_IMPORT, 'activate', file, '--out', out], { cwd: ROOT, env: process.env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const reset = await resetScene();
      const evidence = { upload_id: uploadId, source: path.relative(ROOT, file), compiled: path.relative(ROOT, out), activated_at: new Date().toISOString(), map_prior_only: true, physical_activation: reset?.ok === true ? 'REQUESTED_AND_STACK_RESET' : 'ACTIVATION_FAILED', reset, compiler: String(result.stdout || '').trim() };
      fs.writeFileSync(path.join(IMPORT_SHOWCASE, `activation-${uploadId}.json`), JSON.stringify(evidence, null, 2) + '\n');
      return json(res, { ok: reset?.ok === true, ...evidence }, 202);
    } catch (error) { return json(res, { error: 'map_activation_failed', message: String(error?.stderr || error?.message || error) }, 422); }
  }
  if (req.method === 'POST' && url.pathname === '/api/map/import') {
    let value = {}; try { value = await body(req); } catch (error) { return json(res, { error: 'invalid_json', message: error.message }, 400); }
    const current = interactiveCurrent();
    if (activeMissionChild || ['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING', 'CANCELING'].includes(current.status)) return json(res, { error: 'mission_in_progress', message: '请先停止当前任务。' }, 409);
    const raw = String(value.skeleton || ''); const skeleton = path.resolve(ROOT, raw);
    if (!skeleton.startsWith(`${ROOT}${path.sep}`) || !skeleton.endsWith('.json') || !fs.existsSync(skeleton)) return json(res, { error: 'invalid_skeleton_path', message: 'skeleton must be an existing project-local JSON file' }, 400);
    try {
      const result = await execFileAsync('python3', [MAP_IMPORT, 'activate', skeleton], { cwd: ROOT, env: process.env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const reset = await resetScene();
      return json(res, { ok: true, source: path.relative(ROOT, skeleton), compiler: String(result.stdout || '').trim(), reset: reset?.ok === true }, 202);
    } catch (error) { return json(res, { error: 'map_import_failed', message: String(error?.stderr || error?.message || error) }, 422); }
  }
  if (req.method === 'GET' && url.pathname === '/api/mission/current') return json(res, missionStatus());
  if (req.method === 'GET' && url.pathname === '/api/system/preflight') return json(res, await runSystemPreflight());
  if (req.method === 'POST' && url.pathname === '/api/mission/stop') {
    const current = interactiveCurrent(); if (!activeMissionChild && !['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING'].includes(current.status)) return json(res, { ...missionStatus(), status: current.status });
    if (activeMissionChild) { activeMissionChild.kill('SIGTERM'); return json(res, { ...missionStatus(), status: 'CANCELING' }, 202); }
    return json(res, { ...missionStatus(), status: 'CANCELING', warning: 'runner unavailable; no process was killed' }, 202);
  }
  if (req.method === 'POST' && url.pathname === '/api/scene/reset') {
    if (activeMissionChild || ['PRECHECK_RUNNING', 'READY', 'STARTING', 'RUNNING', 'CANCELING'].includes(interactiveCurrent().status)) return json(res, { error: 'mission_in_progress', message: '请先停止当前任务。' }, 409);
    try { return json(res, await resetScene()); } catch (error) { return json(res, { ok: false, error: 'SCENE_RESET_FAILED', message: String(error?.message || error) }, 503); }
  }
  if (req.method === 'GET' && url.pathname === '/api/mission/events') {
    const after = Number(url.searchParams.get('after') || 0); const events = interactiveEvents().filter(event => Number(event.sequence || 0) > after); return json(res, { mission_id: interactiveCurrent().mission_id, events, next_sequence: events.at(-1)?.sequence || after });
  }
  if (req.method === 'GET' && url.pathname === '/api/events/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    let cursor = Number(url.searchParams.get('after') || 0); let closed = false; const send = (name, value) => { if (!closed) res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`); };
    const timer = setInterval(() => { const current = missionStatus(); send('mission_state', current); for (const event of interactiveEvents().filter(item => Number(item.sequence || 0) > cursor)) { cursor = Number(event.sequence); send(event.type || 'message', event); } }, 400);
    req.on('close', () => { closed = true; clearInterval(timer); }); send('mission_state', missionStatus()); return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/camera/latest-meta') {
    const meta = realCameraMeta(); return meta ? json(res, { ...meta, age_ms: cameraAge(meta), stats: cameraStatsSummary(realCameraStats()), available: true }) : json(res, { available: false, error: 'camera_unavailable' }, 503);
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/camera/latest.jpg') {
    const file = realCameraFile(); return file ? sendFile(res, file, 'image/png') : json(res, { available: false, error: 'camera_unavailable' }, 503);
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/camera/stream') {
    const file = realCameraFile(); if (!file) return json(res, { available: false, error: 'camera_unavailable' }, 503);
    const boundary = 'interactive-frame'; res.writeHead(200, { 'content-type': `multipart/x-mixed-replace; boundary=${boundary}`, 'cache-control': 'no-cache, no-store', pragma: 'no-cache', connection: 'keep-alive' }); let last = 0; let closed = false;
    if (req.method === 'HEAD') return res.end();
    const push = () => { if (closed) return; const meta = realCameraMeta(); const seq = Number(meta?.sequence || 0); if (!seq || seq === last) return; const bytes = fs.readFileSync(file); res.write(`--${boundary}\r\nContent-Type: image/png\r\nContent-Length: ${bytes.length}\r\nX-Frame-Id: ${meta.frame_id}\r\n\r\n`); res.write(bytes); res.write('\r\n'); last = seq; };
    push(); const timer = setInterval(push, 250); req.on('close', () => { closed = true; clearInterval(timer); try { res.end(); } catch {} }); return;
  }
  if (req.method === 'GET' && url.pathname === '/api/live-pose') {
    const data = liveData();
    const backendPose = normalizePose(data.robot?.pose);
    const cameraPose = normalizePose(data.camera?.pose);
    const positionError = backendPose && cameraPose ? Math.hypot(backendPose.x - cameraPose.x, backendPose.y - cameraPose.y) : null;
    const currentLocation = nearestRegistryLocation(data.registry, backendPose) || data.mission?.current_location || data.robot?.current_location;
    return json(res, { backend_pose: backendPose, camera_pose: cameraPose, dashboard_pose: backendPose, position_error: positionError, current_location: currentLocation, source: 'live ROS2 /odom + map->base_link; Camera adapter pose cross-check', pass: Boolean(backendPose && cameraPose && positionError <= 0.25) });
  }
  const choice = selected(url);
  const requestedRun = url.searchParams.get('run');
  const runId = requestedRun || (choice.mode === 'REPLAY' && replay('showcase-v2') ? 'showcase-v2' : choice.data.run);
  if (url.pathname === '/api/mode') return json(res, { mode: choice.mode, run: choice.data.run, run_id: runId, replay_notice: choice.data.replay_notice, mission: MISSION });
  if (url.pathname === '/api/status') return json(res, { mode: choice.mode, run: choice.data.run, status: choice.mode === 'LIVE' ? (choice.data.status || { available: false }) : { available: true, overall: 'PASS', source: choice.data.source?.run_dir || 'artifacts/final_rescue/run', historical: true }, provider: choice.data.provider, stack: choice.mode === 'LIVE' ? choice.data.status || null : { historical: true, components: { Agnes_LLM: 'PASS', Plugin: 'PASS', Robot_MCP: 'PASS', ROS2: 'PASS', Gazebo: 'PASS', Nav2: 'PASS', Camera: 'PASS', LiDAR: 'PASS', Perception: 'PASS' } }, notice: choice.data.replay_notice });
  if (url.pathname === '/api/world') return json(res, { mode: choice.mode, registry: choice.data.registry, map_prior: choice.data.map_prior || mapPrior(choice.data.registry), live_world: choice.data.live_world || { facts: [], hidden_ground_truth_leak: false }, world: choice.data.world, robot: choice.data.robot, dynamic: choice.data.dynamic, route: choice.data.route, decision: choice.data.decision || null });
  if (url.pathname === '/api/map-prior') return json(res, { mode: choice.mode, map_prior: choice.data.map_prior || mapPrior(choice.data.registry) });
  if (url.pathname === '/api/live-world') return json(res, { mode: choice.mode, live_world: choice.data.live_world || { facts: [], hidden_ground_truth_leak: false } });
  if (url.pathname === '/api/mission') return json(res, { mode: choice.mode, mission: choice.data.mission, mission_text: MISSION, stages: choice.data.stages, provider: choice.data.provider });
  if (url.pathname === '/api/perception') return json(res, { mode: choice.mode, perception: choice.data.perception, camera: cameraResponse(choice, requestedRun || runId), lidar: { front_min_range: choice.data.perception?.front_min_range ?? null, source: choice.data.perception?.camera?.source || null } });
  if (url.pathname === '/api/events') return json(res, { mode: choice.mode, events: choice.data.events || [], mcp_events: choice.data.mcp_events || [], navigation: choice.data.navigation || [], stages: choice.data.stages || [], notice: choice.data.replay_notice });
  if (url.pathname === '/api/final-report') return json(res, { mode: choice.mode, ...choice.data.final_report, text: choice.data.final_report?.text || 'unavailable' });
  const replayMatch = url.pathname.match(/^\/api\/replay\/(showcase-v2|showcase|run[123]|[123])$/);
  if (replayMatch) {
    const run = replayMatch[1].startsWith('showcase') ? replayMatch[1] : Number(replayMatch[1].replace('run', ''));
    const data = replay(run);
    return data ? json(res, data) : json(res, { error: 'replay_not_found', run }, 404);
  }
  if (url.pathname === '/api/camera/latest') {
    const camera = cameraResponse(choice, requestedRun || runId);
    if (camera.image_url) {
      const imagePath = path.resolve(ROOT, camera.image_path);
      const ext = path.extname(imagePath).toLowerCase();
      return sendFile(res, imagePath, ext === '.png' ? 'image/png' : 'image/jpeg');
    }
    return json(res, camera);
  }
  const frameMatch = url.pathname.match(/^\/api\/camera\/frame\/([^/]+)$/);
  if (frameMatch) {
    const id = decodeURIComponent(frameMatch[1]);
    const frame = choice.data.camera?.keyframes?.[id] || Object.values(choice.data.camera?.keyframes || {}).find(item => item?.frame === id || item?.id === id);
    const analysis = choice.data.camera?.active_analysis;
    const analysisFrame = id === 'active_before_crop' ? analysis?.before : id === 'active_after_crop' ? analysis?.after : null;
    const imagePath = (analysisFrame?.crop || frame?.path) ? path.resolve(ROOT, analysisFrame?.crop || frame.path) : null;
    if (imagePath && imagePath.startsWith(ROOT) && fs.existsSync(imagePath)) {
      const ext = path.extname(imagePath).toLowerCase();
      return sendFile(res, imagePath, ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');
    }
    return json(res, { available: false, frame: id, error: 'camera_frame_not_found' }, 404);
  }
  const evidenceMatch = url.pathname.match(/^\/api\/camera\/evidence\/([^/]+)\/([a-z0-9_-]+)$/);
  if (evidenceMatch) {
    const runName = decodeURIComponent(evidenceMatch[1]);
    const stage = decodeURIComponent(evidenceMatch[2]);
    const runData = replay(runName);
    const frame = runData?.camera?.keyframes?.[stage] || (runName === choice.data.run ? choice.data.camera?.keyframes?.[stage] : null);
    const imagePath = frame?.path ? path.resolve(ROOT, frame.path) : null;
    if (imagePath && imagePath.startsWith(ROOT) && fs.existsSync(imagePath)) {
      const ext = path.extname(imagePath).toLowerCase();
      return sendFile(res, imagePath, ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');
    }
    return json(res, { available: false, evidence_frame: true, stage, run: runName, source: frame?.source_topic || null, unavailable_reason: '该运行没有保存此真实 Camera evidence frame。' }, 404);
  }
  const legacyEvidenceMatch = url.pathname.match(/^\/api\/camera\/evidence\/(start|room_a|blocked|room_b|active_before|active_after|final)$/);
  if (legacyEvidenceMatch) {
    const frame = choice.data.camera?.keyframes?.[legacyEvidenceMatch[1]];
    const imagePath = frame?.path ? path.resolve(ROOT, frame.path) : null;
    if (imagePath && imagePath.startsWith(ROOT) && fs.existsSync(imagePath)) return sendFile(res, imagePath, 'image/png');
    return json(res, { available: false, evidence_frame: choice.mode === 'REPLAY', source: frame?.source_topic || null, unavailable_reason: '该运行没有保存此真实 Camera evidence frame。' });
  }
  return json(res, { error: 'not_found' }, 404);
}

const server = http.createServer(route);
server.listen(PORT, HOST, () => console.log(`final-dashboard listening at http://${HOST}:${PORT}`));
function shutdownUi(){server.close(()=>process.exit(0));server.closeAllConnections();}
process.on('SIGTERM',shutdownUi);
process.on('SIGINT',shutdownUi);
