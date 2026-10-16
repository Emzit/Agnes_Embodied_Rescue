#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { scenarioForSeed } from './scenario-manager.mjs';
import { validateScenario } from './solvability-gate.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/interactive-live');
const seeds = [1, 5, 8, 258, 1112, 1185];
const realMissionEvidence = {
  1: { mission_id: 'interactive-1791367515378', task_kind: 'navigation_only', status: 'SUCCEEDED', note: 'real Agnes navigation-only; no inspection' },
  251: { mission_id: 'interactive-1791367604449', task_kind: 'navigation_inspection', status: 'SUCCEEDED', note: 'real Agnes navigate Room_A + inspect_room success' },
  1112: { mission_id: 'interactive-1791367369183', task_kind: 'multi_step', status: 'SUCCEEDED', note: 'real Agnes Room_C -> Room_A inspect -> Start; Room_B forbidden' },
};

function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function write(name, value) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n'); }
function missionDir(id) { return path.join(OUT, 'missions', id); }
function events(id) { const file = path.join(missionDir(id), 'events.jsonl'); try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function result(id) { return readJson(path.join(missionDir(id), 'result.json'), null); }
function forbiddenText(value) { return /hidden_ground_truth|person_target_room|dynamic_obstacle_event|object_placements|active_perception_challenge|future obstacle|未来阻断/iu.test(JSON.stringify(value || '')); }

const layouts = [];
for (const seed of seeds) {
  const spec = scenarioForSeed(seed);
  const gate = validateScenario(spec);
  const evidence = realMissionEvidence[seed] || null;
  const mission = evidence ? result(evidence.mission_id) : null;
  layouts.push({
    seed,
    layout_id: spec.layout_id,
    map_load_pass: gate.static.checks.map_load_pass,
    semantic_registry_aligned: gate.static.checks.semantic_registry_aligned,
    start_reachable: gate.static.checks.start_reachable,
    required_locations_reachable: gate.static.checks.required_locations_reachable,
    alternate_route_exists: gate.static.checks.alternate_route_exists,
    runtime_placement_clearance: gate.static.runtime_placement_clearance,
    solvability_gate: gate.pass,
    real_mission: evidence ? { ...evidence, terminal_result: mission?.status || 'MISSING_RESULT' } : { status: 'NOT_RUN' },
  });
}
write('solvability-validation.json', { generated_at: new Date().toISOString(), seeds: layouts.map(item => ({ seed: item.seed, layout_id: item.layout_id, gate_pass: item.solvability_gate, clearance: item.runtime_placement_clearance })), layouts, pass: layouts.every(item => item.solvability_gate) });
write('layout-validation.json', {
  generated_at: new Date().toISOString(),
  layouts: ['layout_a', 'layout_b', 'layout_c'].map(layout => {
    const rows = layouts.filter(item => item.layout_id === layout);
    const real = rows.find(item => item.real_mission?.status === 'SUCCEEDED');
    return { layout_id: layout, map_load_pass: rows.every(item => item.map_load_pass), semantic_registry_aligned: rows.every(item => item.semantic_registry_aligned), start_reachable: rows.every(item => item.start_reachable), required_locations_reachable: rows.every(item => item.required_locations_reachable), alternate_route_exists: rows.every(item => item.alternate_route_exists), nav2_pass: rows.some(item => item.real_mission?.status === 'SUCCEEDED'), real_task_evidence: real?.real_mission || { status: 'NOT_RUN' }, pass: Boolean(real && rows.every(item => item.solvability_gate)) };
  }),
  pass: ['layout_a', 'layout_b', 'layout_c'].every(layout => layouts.some(item => item.layout_id === layout && item.real_mission?.status === 'SUCCEEDED')),
});

const adaptiveCases = [];
const perceptionCases = [];
for (const item of layouts) {
  const id = item.real_mission?.mission_id;
  if (!id) continue;
  const ev = events(id); const resultValue = result(id);
  const navFailures = ev.filter(entry => entry.type === 'tool_result' && /navigate_to$/u.test(entry.tool || '') && entry.result?.status === 'FAILED');
  const reinspection = ev.filter(entry => entry.type === 'tool_result' && /inspect_object$/u.test(entry.tool || '') && entry.result?.status === 'SUCCEEDED');
  if (navFailures.length) adaptiveCases.push({ seed: item.seed, mission_id: id, status: 'OBSERVED_FAILURE_ONLY', physical_event: false, world_model_update: Boolean(resultValue?.replans_count), plan_invalidated: false, new_plan: false, real_route_change: false, evidence: { navigation_failures: navFailures.length } });
  if (reinspection.length) perceptionCases.push({ seed: item.seed, mission_id: id, branch: 'low_confidence_reinspection', real_inspect_object_success: true, count: reinspection.length });
}
write('adaptive-decision-validation.json', { generated_at: new Date().toISOString(), required_chain: ['original_plan', 'physical_environment_change', 'real_observation', 'world_model_update', 'plan_invalidation', 'new_plan', 'real_route_change'], missions: adaptiveCases, real_replan_cases: adaptiveCases.filter(item => item.physical_event && item.world_model_update && item.plan_invalidated && item.new_plan && item.real_route_change).length, pass: adaptiveCases.filter(item => item.physical_event && item.world_model_update && item.plan_invalidated && item.new_plan && item.real_route_change).length >= 3, blocker: 'No randomized mission currently contains a complete physical event -> evidence -> replan -> route-change chain' });
write('active-perception-random-validation.json', { generated_at: new Date().toISOString(), required_conditional_cases: ['low_confidence_reinspection', 'sufficient_evidence_no_reinspection'], observed_cases: perceptionCases, low_confidence_reinspection: perceptionCases.some(item => item.branch === 'low_confidence_reinspection'), sufficient_evidence_no_reinspection: false, pass: false, blocker: 'Randomized low/high real perception branches are not both terminally evidenced' });

const publicAudit = { available: false, reason: 'Dashboard public snapshot was not persisted for every seed before terminal state' };
const hiddenAudit = seeds.map(seed => {
  const evidence = realMissionEvidence[seed]; const id = evidence?.mission_id; const ev = id ? events(id) : []; const trace = id ? readJson(path.join(missionDir(id), 'mcp-trace.json'), []) : []; const memory = id ? readJson(path.join(missionDir(id), 'world-memory-final.json'), null) : null;
  const promptLeak = ev.some(entry => entry.type === 'agent_message' && forbiddenText(entry.text));
  const mcpLeak = trace.some(entry => forbiddenText(entry.result));
  const memoryLeak = forbiddenText(memory);
  return { seed, mission_id: id || null, terminal_status: evidence ? result(id)?.status || 'MISSING_RESULT' : 'NOT_RUN', prompt_hidden_field_leak: promptLeak, mcp_hidden_field_leak: mcpLeak, world_memory_unproven_hidden_fact: memoryLeak, dashboard_live_audit: publicAudit, pass: Boolean(evidence && result(id)?.status && !promptLeak && !mcpLeak && !memoryLeak) };
});
write('hidden-ground-truth-validation.json', { generated_at: new Date().toISOString(), pre_run_public_views_redact_target_and_future_events: true, terminal_audit: hiddenAudit, dashboard_live_api_audit: publicAudit, pass: hiddenAudit.length === seeds.length && hiddenAudit.every(item => item.pass), blocker: 'All six randomized seeds require terminal real mission audits; unrun seeds remain NOT_RUN' });

const previous = readJson(path.join(OUT, 'randomization-debug-attempts.json'), null);
const attempts = [
  { attempt: 5, observed_failure: 'Layout C real planner 208 on Room_C/Room_A', root_cause: 'bottom boundary shift plus Room_A semantic goal in inflated costmap', files_changed: ['simulation/scenarios/layout_c/world.sdf', 'simulation/scenarios/layout_c/map.pgm', 'simulation/scenarios/layout_{a,b,c}/world_registry.json'], test: 'real ComputePathToPose and Layout C multi-step', result: 'Room_C -> Room_A -> Start SUCCEEDED after safe geometry/pose changes', next_action: 'continue seeded real suite' },
  { attempt: 6, observed_failure: 'random seed 1117 placement near required pose', root_cause: 'seeded person/object clearance below 1m', files_changed: ['scripts/interactive/solvability-gate.mjs', 'scripts/interactive/scenario-manager.mjs'], test: 'explicit generate seed 1117', result: 'correctly rejected UNSOLVABLE_SCENARIO; no silent seed substitution', next_action: 'use gate-passing seed 1185' },
  { attempt: 7, observed_failure: 'randomized full rescue returned without MCP tool calls', root_cause: 'Agnes real session emitted only untrusted result summary; no navigation evidence', files_changed: [], test: 'real seed 1 and seed 1185 full rescue', result: 'FAILED; not counted as replan', next_action: 'diagnose real Agnes session/tool-call availability' },
];
write('randomization-debug-attempts.json', { generated_at: new Date().toISOString(), attempts: [...(previous?.attempts || []).filter(item => item.attempt < 5), ...attempts], max_attempts: 10, next_action: 'Complete terminal real suite only after Agnes emits real MCP calls; do not claim adaptive pass' });
process.stdout.write(JSON.stringify({ seeds, layouts: layouts.map(item => ({ seed: item.seed, layout_id: item.layout_id, gate: item.solvability_gate, mission: item.real_mission.status })), adaptive_cases: adaptiveCases.length, perception_cases: perceptionCases.length }) + '\n');
