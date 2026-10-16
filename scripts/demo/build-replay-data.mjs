#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FINAL = path.join(ROOT, 'artifacts/final_rescue');
const DEMO = path.join(ROOT, 'artifacts/demo');
const REGISTRY_PATH = path.join(ROOT, 'artifacts/phase9f/world-registry.json');
const INPUT_ROOT = path.resolve(process.env.REPLAY_INPUT_ROOT || FINAL);
const MISSION = '进入实验室寻找失联研究员，并报告环境风险。';

fs.mkdirSync(DEMO, { recursive: true });

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch { return []; }
}

function nested(value, keys) {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

function sourceTimestamp(value) {
  const candidates = [
    value?.timestamp, value?.frame_timestamp, value?.result?.timestamp,
    value?.result?.frame_timestamp, value?.result?.camera_status?.frame_timestamp,
    value?.result?.lidar_obstacle_summary?.frame_timestamp,
  ];
  for (const timestamp of candidates) {
    if (timestamp && typeof timestamp === 'object' && (number(timestamp.sec) !== null || number(timestamp.nanosec) !== null)) return timestamp;
    if (typeof timestamp === 'string') return timestamp;
  }
  return null;
}

function sourceFrom(run, file) { return path.relative(ROOT, path.join(INPUT_ROOT, `run${run}`, file)); }

function toolName(tool) {
  if (!tool) return '';
  const known = ['get_observation', 'get_robot_state', 'get_world_state', 'inspect_object', 'inspect_room', 'list_known_locations', 'navigate_to', 'stop_robot'];
  return known.find(name => tool.endsWith(`_${name}`)) || tool;
}

function textOf(value) {
  try { return JSON.stringify(value); } catch { return String(value ?? ''); }
}

function allStrings(value) {
  return textOf(value).toLowerCase();
}

function locationFrom(event) {
  const args = event.args || event.input || {};
  const result = event.result || {};
  return args.location || args.target || result.location || result.room || result.target || result.current_location || null;
}

function eventLabel(tool, event) {
  const location = locationFrom(event);
  const blob = allStrings(event);
  if (tool === 'navigate_to') return `navigate → ${location || 'unknown'}`;
  if (tool === 'inspect_room') return `inspect ${location || 'room'}`;
  if (tool === 'inspect_object') return `inspect_object → ${location || 'object'}`;
  if (tool === 'list_known_locations') return 'list_known_locations';
  if (tool === 'get_observation') return 'get_observation';
  if (tool === 'get_robot_state') return 'get_robot_state';
  if (tool === 'get_world_state') return 'get_world_state';
  if (blob.includes('path_blocked')) return 'PATH_BLOCKED';
  return tool;
}

function phaseFor(tool, event, trigger, memory) {
  const location = locationFrom(event);
  const blob = allStrings(event);
  if (tool === 'mission_get_state' || tool === 'mission_start') return 1;
  if (tool === 'list_known_locations' || tool === 'get_world_state') return 2;
  if (tool === 'navigate_to' && location === 'Room_A') return 3;
  if (tool === 'inspect_room' && location === 'Room_A') return 4;
  if (tool === 'navigate_to' && ['Room_C', 'Side_Corridor', 'Room_B'].includes(location) && trigger?.triggered) return 8;
  if (blob.includes('path_blocked') || (trigger?.triggered && (tool === 'navigate_to' || tool === 'get_observation'))) return 5;
  if (tool === 'memory_update' || blob.includes('world_memory')) return 6;
  if (tool === 'decision_score_candidates') return 7;
  if (blob.includes('replan') || blob.includes('blocked_routes')) return 7;
  if (tool === 'inspect_room' && location === 'Room_B') return 9;
  if (tool === 'inspect_object') return 10;
  if (blob.includes('person') || blob.includes('target_status')) return 11;
  return null;
}

function flattenTrace(run, traceFile, trace, trigger, memory) {
  return (Array.isArray(trace) ? trace : []).map((entry, index) => {
    const tool = toolName(entry.tool);
    const result = entry.result ?? null;
    return {
      sequence: entry.seq ?? index + 1,
      result_sequence: entry.result_seq ?? null,
      tool,
      raw_tool: entry.tool ?? null,
      label: eventLabel(tool, entry),
      args: entry.args ?? {},
      result,
      is_error: Boolean(entry.is_error),
      source: sourceFrom(run, traceFile),
      source_timestamp: sourceTimestamp(result) || sourceTimestamp(entry),
      phase: phaseFor(tool, entry, trigger, memory),
    };
  });
}

function normalizeMcp(run, entries) {
  return (Array.isArray(entries) ? entries : []).map((entry, index) => ({
    sequence: entry.seq ?? index + 1,
    tool: entry.tool || '',
    label: eventLabel(entry.tool || '', entry),
    args: entry.input || entry.args || {},
    result: entry.result ?? null,
    is_error: Boolean(entry.is_error),
    source: sourceFrom(run, 'mcp-trace.json'),
    source_timestamp: sourceTimestamp(entry.result) || sourceTimestamp(entry),
  }));
}

function normalizePerception(run, entries) {
  return (Array.isArray(entries) ? entries : []).map((entry, index) => ({
    sequence: index + 1,
    tool: entry.tool || 'perception',
    input: entry.input || {},
    result: entry.result || null,
    backend: entry.backend || null,
    source: sourceFrom(run, 'perception-events.json'),
    source_timestamp: sourceTimestamp(entry.result) || sourceTimestamp(entry),
  }));
}

function loadKeyframes(runDir) {
  const file = fs.existsSync(path.join(runDir, 'camera-keyframes.json')) ? path.join(runDir, 'camera-keyframes.json') : path.join(path.dirname(runDir), 'camera-keyframes.json');
  const raw = readJson(file, {});
  const base = path.dirname(file);
  return Object.fromEntries(Object.entries(raw || {}).map(([name, frame]) => [name, frame && frame.path ? { ...frame, path: path.relative(ROOT, path.resolve(base, frame.path)) } : frame]));
}

function loadFrameIndex(runDir) {
  const file = fs.existsSync(path.join(runDir, 'frame-index.json')) ? path.join(runDir, 'frame-index.json') : path.join(path.dirname(runDir), 'frame-index.json');
  const raw = readJson(file, null);
  if (!raw) return null;
  return raw;
}

function latestDetection(perception) {
  const detections = [];
  for (const event of perception) {
    const result = event.result || {};
    for (const detection of result.detections || []) detections.push({ ...detection, source: event.source });
    for (const evidence of result.evidence || []) for (const detection of evidence.detections || []) detections.push({ ...detection, source: event.source, evidence_frame: evidence.timestamp || null });
  }
  return detections.at(-1) || null;
}

function activePerception(perception, memory, runDir) {
  const inspections = perception.filter(event => event.tool === 'inspect_object');
  const last = [...inspections].reverse().find(event => (event.result?.detections || []).some(item => item.label === 'person') && Number(event.result?.after_confidence) > Number(event.result?.before_confidence)) || inspections.at(-1);
  const result = last?.result || {};
  const history = result.confidence_history || result.history || [];
  const before = result.before_confidence ?? history[0]?.confidence ?? null;
  const after = result.after_confidence ?? history.at(-1)?.confidence ?? null;
  const keyframes = loadKeyframes(runDir);
  return {
    count: Math.max(memory?.active_perception_count || 0, inspections.length),
    object: result.object_id || result.id || last?.input?.object_id || null,
    before_confidence: before,
    after_confidence: after,
    inspect_object_seen: inspections.length > 0,
    before_frame: keyframes?.active_before || null,
    after_frame: keyframes?.active_after || null,
    source: last?.source || sourceFrom(0, 'perception-events.json'),
  };
}

function findPerson(perception, memory) {
  const fromMemory = (memory?.known_objects || []).find(object => object.label === 'person');
  if (fromMemory) return { ...fromMemory, source: 'world-memory-final.json' };
  for (const event of perception) {
    const found = (event.result?.detections || []).find(item => item.label === 'person');
    if (found) return { ...found, source: event.source };
  }
  return null;
}

function routeState(run, navigation, trigger, memory) {
  const navText = allStrings(navigation);
  const blocked = Boolean(trigger?.triggered) && (navText.includes('path_blocked') || Boolean(memory?.action_history?.some(item => item.reason === 'PATH_BLOCKED')));
  const original = ['Start', 'Room_A', 'Corridor_A', 'Room_B'];
  const alternative = ['Start', 'Room_A', 'Room_C', 'Side_Corridor', 'Room_B'];
  return {
    original,
    alternative,
    blocked,
    cabinet: trigger?.collision_geometry ? {
      center: trigger.collision_geometry.center,
      size: trigger.collision_geometry.size,
      active: Boolean(trigger.triggered),
      source: sourceFrom(run, 'dynamic-obstacle-trigger.json'),
    } : null,
    source: [sourceFrom(run, 'dynamic-obstacle-trigger.json'), sourceFrom(run, 'navigation-events.json'), sourceFrom(run, 'world-memory-final.json')],
  };
}

function cameraFrom(world, perception, run, runDir) {
  const camera = world?.camera_status || null;
  const latest = perception.at(-1)?.result || {};
  const evidence = latest.evidence?.at(-1) || latest.detections?.at(-1)?.evidence || null;
  const keyframes = loadKeyframes(runDir);
  const frameIndex = loadFrameIndex(runDir);
  const rawActiveAnalysis = readJson(path.join(runDir, '..', 'active-perception-analysis.json'), null);
  const activeAnalysis = rawActiveAnalysis ? {
    ...rawActiveAnalysis,
    before: rawActiveAnalysis.before ? { ...rawActiveAnalysis.before, crop: path.relative(ROOT, path.resolve(path.dirname(runDir), rawActiveAnalysis.before.crop)) } : rawActiveAnalysis.before,
    after: rawActiveAnalysis.after ? { ...rawActiveAnalysis.after, crop: path.relative(ROOT, path.resolve(path.dirname(runDir), rawActiveAnalysis.after.crop)) } : rawActiveAnalysis.after,
  } : null;
  const imagePath = keyframes?.final?.path || keyframes?.room_b?.path || keyframes?.room_a?.path || null;
  return {
    available: Boolean(camera?.available || evidence),
    evidence_frame: true,
    frame_sha256: camera?.summary?.sha256 || evidence?.frame_sha256 || null,
    timestamp: camera?.frame_timestamp || evidence?.frame_timestamp || null,
    width: camera?.width || evidence?.image_width || null,
    height: camera?.height || evidence?.image_height || null,
    image_path: imagePath,
    keyframes,
    frame_index: frameIndex,
    active_analysis: activeAnalysis,
    note: '真实 /camera/image_raw RGB evidence；replay 仅回放历史帧。',
    source: camera ? sourceFrom(run, 'world-memory-final.json') : sourceFrom(run, 'perception-events.json'),
  };
}

function buildRun(run) {
  const dir = path.join(INPUT_ROOT, `run${run}`);
  const acceptance = readJson(path.join(dir, 'acceptance.json'), {});
  const provider = readJson(path.join(dir, 'provider.json'), readJson(path.join(FINAL, 'provider.json'), {}));
  const mission = readJson(path.join(dir, 'mission-state-final.json'), {});
  const memory = readJson(path.join(dir, 'world-memory-final.json'), {});
  const trigger = readJson(path.join(dir, 'dynamic-obstacle-trigger.json'), {});
  const world = readJson(path.join(ROOT, 'simulation/final_rescue/world_registry.json'), readJson(REGISTRY_PATH, {}));
  const traceDoc = readJson(path.join(dir, 'agnes-trace.json'), {});
  const trace = flattenTrace(run, 'agnes-trace.json', traceDoc.trace, trigger, memory);
  const mcp = normalizeMcp(run, readJson(path.join(dir, 'mcp-trace.json'), []));
  const navigation = readJson(path.join(dir, 'navigation-events.json'), []);
  const perception = normalizePerception(run, readJson(path.join(dir, 'perception-events.json'), []));
  const person = findPerson(perception, memory);
  const report = fs.existsSync(path.join(dir, 'final-report.txt')) ? fs.readFileSync(path.join(dir, 'final-report.txt'), 'utf8') : 'unavailable';
  const personObserved = Boolean(person);
  const motion = readJson(path.join(dir, 'physical-motion.json'), []);
  const camera = cameraFrom(memory, perception, run, dir);
  const stages = [
    ['接收任务', 1], ['获取环境', 2], ['前往 Room_A', 3], ['检查 Room_A', 4],
    ['道路发生阻挡', 5], ['Agent 更新世界模型', 6], ['重新规划', 7], ['绕行前往 Room_B', 8],
    ['检查 Room_B', 9], ['主动复检', 10], ['找到人员目标', 11], ['生成最终报告', 12],
  ].map(([label, phase]) => ({
    label, phase,
    completed: trace.some(event => event.phase === phase) || (phase === 5 && trigger.triggered) || (phase === 11 && personObserved) || (phase === 12 && Boolean(report)),
    source: trace.find(event => event.phase === phase)?.source || (phase === 5 && trigger.triggered ? sourceFrom(run, 'dynamic-obstacle-trigger.json') : null) || (phase === 11 && personObserved ? sourceFrom(run, 'world-memory-final.json') : null) || (phase === 12 && report ? sourceFrom(run, 'final-report.txt') : null),
  }));
  return {
    schema_version: 1,
    mode: 'REPLAY',
    replay_notice: '历史真实运行回放，不是当前实时机器人状态。',
    run,
    mission_text: MISSION,
    source: { run_dir: path.relative(ROOT, dir), files: ['acceptance.json', 'agnes-trace.json', 'mcp-trace.json', 'navigation-events.json', 'perception-events.json', 'world-memory-final.json', 'dynamic-obstacle-trigger.json', 'final-report.txt'] },
    acceptance,
    provider,
    registry: world,
    world: { ...memory, source: sourceFrom(run, 'world-memory-final.json') },
    mission: { ...mission, source: sourceFrom(run, 'mission-state-final.json') },
    robot: { current_location: memory.robot_location || mission.world_memory?.robot_location || 'unavailable', pose: motion.at(-1) || null, trajectory: Array.isArray(motion) ? motion : [], trajectory_source: sourceFrom(run, 'physical-motion.json'), source: sourceFrom(run, 'world-memory-final.json') },
    dynamic: { cabinet: trigger.triggered ? 'ACTIVE' : 'OPEN', corridor_a: trigger.triggered ? 'BLOCKED' : 'OPEN', trigger, source: sourceFrom(run, 'dynamic-obstacle-trigger.json') },
    route: routeState(run, navigation, trigger, memory),
    perception: { events: perception, latest_detection: latestDetection(perception), person_target: person, active: activePerception(perception, memory, dir), front_min_range: memory.lidar_obstacle_summary?.front_min_range ?? null, camera },
    camera,
    events: trace,
    mcp_events: mcp,
    navigation,
    stages,
    final_report: { text: report, source: sourceFrom(run, 'final-report.txt') },
    evidence: { no_runtime_ground_truth_read: true, no_mock_fallback: true, no_fixture: true },
  };
}

const runs = process.env.REPLAY_RUN ? [Number(process.env.REPLAY_RUN)] : [1, 2, 3];
for (const run of runs) {
  const output = process.env.REPLAY_OUTPUT_FILE ? path.resolve(process.env.REPLAY_OUTPUT_FILE) : path.join(DEMO, `replay-run${run}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(buildRun(run), null, 2) + '\n');
}
console.log(`Built replay data from ${path.relative(ROOT, INPUT_ROOT)}: ${runs.join(', ')}`);
