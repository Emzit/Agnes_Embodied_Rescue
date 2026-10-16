#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/indoor-rescue-upgrade');
const forbidden = /["'](?:person_target_room|dynamic_obstacle_event|object_placements|active_perception_challenge|future_event|door_runtime_truth|hidden_ground_truth)["']\s*:/iu;
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function json(file) { try { return JSON.parse(read(file)); } catch { return null; } }
function missionDirs() { const root = path.join(ROOT, 'artifacts/interactive-live/missions'); try { return fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => path.join(root, x.name)); } catch { return []; } }
const publicScenario = json(path.join(ROOT, 'artifacts/interactive-live/current-scenario.json')) || {};
const dirs = missionDirs();
const promptTexts = dirs.flatMap(d => [read(path.join(d, 'agnes-events.jsonl')), read(path.join(d, 'events.jsonl'))]);
const mcpTexts = dirs.map(d => read(path.join(d, 'mcp-trace.json')));
const memories = dirs.map(d => read(path.join(d, 'world-memory-final.json')));
const dashboardLive = read(path.join(ROOT, 'artifacts/interactive-live/current.json'));
const checks = {
  scenario_private_truth_not_in_public_scenario: !forbidden.test(JSON.stringify(publicScenario)),
  scenario_private_truth_not_in_prompt: promptTexts.every(x => !forbidden.test(x)),
  scenario_private_truth_not_in_mcp: mcpTexts.every(x => !forbidden.test(x)),
  unobserved_person_not_in_memory: memories.every(x => !/person_target_room|hidden_ground_truth/iu.test(x)),
  future_event_not_in_dashboard: !forbidden.test(dashboardLive),
  blocked_state_requires_sensor_evidence: dirs.every(d => { const trace = json(path.join(d, 'mcp-trace.json')) || []; return !trace.some(x => /PATH_BLOCKED/i.test(JSON.stringify(x.result || x)) && !/lidar|nav|observation|navigate/i.test(JSON.stringify(x))); }),
  semantic_object_requires_visual_evidence: dirs.every(d => { const trace = json(path.join(d, 'mcp-trace.json')) || []; return trace.filter(x => /get_observation|inspect_/i.test(x.tool || '')).flatMap(x => x.result?.semantic_objects || x.result?.detections || []).every(x => x.evidence?.frame_sha256 || x.evidence?.method === 'vlm'); }),
};
const result = { generated_at: new Date().toISOString(), mission_count: dirs.length, checks, pass: Object.values(checks).every(Boolean) && dirs.length > 0, audit_boundary: 'terminal evaluator may read controller-private scenario after mission; this audit covers agent-visible pre-terminal files only' };
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'no-god-view-audit.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result)); process.exitCode = result.pass ? 0 : 2;
