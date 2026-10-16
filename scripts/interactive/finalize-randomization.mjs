#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/interactive-live');
const mission = id => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'missions', id, 'current.json'), 'utf8')); } catch { return null; } };
const write = (file, value) => fs.writeFileSync(path.join(OUT, file), JSON.stringify(value, null, 2) + '\n');
const taskB = mission('interactive-1791359272245');
const taskC = mission('interactive-1791357981922');
const rescueAttempts = ['interactive-1791359401117', 'interactive-1791359505175', 'interactive-1791359587823'].map(mission).filter(Boolean);
const preflight = JSON.parse(fs.readFileSync(path.join(OUT, 'randomization-start-preflight.json'), 'utf8'));
const regression = {
  startup: { start_script_live_ready: true, preflight_pass: preflight.pass, dashboard_4188: true },
  layout_preflight: { layout_a: true, layout_b: true, layout_c: true },
  generic_tasks: { baseline_validation: true, layout_b_navigation_only: taskB?.status === 'SUCCEEDED', layout_c_navigation_only: false, layout_c_blocker: 'direct Start->Room_C required route recovery and did not finish in this run' },
  full_rescue: { prior_stable_acceptance: true, randomized_layout_c: rescueAttempts.some(item => item.status === 'SUCCEEDED'), attempts: rescueAttempts.map(item => ({ id: item.mission_id, status: item.status })) },
  sensors: { camera_live: true, lidar_live: preflight.nav2?.lidar_fresh === true, pose_live: true },
  robot_mcp: { unit_tests_pass: 22, skipped_real_optional: 6, contract_tool_count: 8 },
  mcp_contract: { tool_count: 8, changed: false },
  pass: false,
  blocker: 'Randomized full-rescue adaptive replan and all six seeded real mission regressions are not yet complete.'
};
write('randomization-regression.json', regression);
write('randomization-debug-attempts.json', {
  max_attempts: 12,
  attempts: [
    { attempt: 1, observed_failure: 'workspace has no Git metadata', root_cause: 'git snapshot unavailable', files_changed: [], test: 'git rev-parse', result: 'recorded file snapshot fallback', next_action: 'verify restore archive' },
    { attempt: 2, observed_failure: 'startup scenario selection absent', root_cause: 'stack paths were fixed to final_rescue', files_changed: ['scripts/final-rescue/env.sh', 'scripts/phase9d/stack.py'], test: 'clean interactive start', result: 'LIVE READY', next_action: 'run seeded layout preflight' },
    { attempt: 3, observed_failure: 'layout_c direct route not completed', root_cause: 'real Nav2 route/occupancy behavior requires recovery; not assumed solvable', files_changed: ['simulation/scenarios/layout_c/world.sdf', 'simulation/scenarios/layout_c/map.pgm'], test: 'real Agnes navigation-only', result: 'blocked/canceled evidence retained', next_action: 'do not claim randomized pass; repair solvability before more seeds' },
    { attempt: 4, observed_failure: 'seeded object placement could occupy a goal', root_cause: 'runtime perception objects had collision geometry', files_changed: ['simulation/final_rescue/dynamic_scenario.py'], test: 'layout_c reset + physical spawn', result: '4 Gazebo objects spawned; perception objects collision-free', next_action: 'rerun real rescue after route solvability validation' }
  ],
  next_action: 'Add per-seed real Nav2 solvability precheck and bounded recovery, then rerun six seeds with full rescue/replan evidence.'
});
const summary = `# Randomized adaptive demo summary

## Stable backup

- File snapshot: backups/interactive-stable-20261007-before-randomization/ with backup-verification.json.pass=true.
- Git snapshot: unavailable because the project root has no Git metadata.

## Implemented

- Deterministic ScenarioManager with seed reproduction and three project-local world/map/registry templates.
- Seed/layout API and Dashboard controls; pre-run public scenario view redacts target room, future obstacle, object placements, and perception challenge.
- Stack selects scenario-local world, map, bridge, Nav2 params, registry, and dynamic controller.
- Runtime controller spawns seed-selected physical Gazebo objects through EntityFactory and records controller evidence without exposing truth to Agnes.
- Clean start waits for real Nav2/TF/sensor readiness and reports LIVE READY.
- Existing generic evaluator and real pose binding remain in place; layout_b navigation-only regression succeeded with no inspection and final Room_C.
- Dashboard adaptive-decision panel is driven by real navigation/block/world-memory events when present.

## Blocking evidence

- Static seeded reproducibility/layout checks pass, and layout_a/layout_b/layout_c startup preflight passed in the observed runs.
- The randomized suite does not yet have six completed real missions covering all required generic tasks, three runtime environment-change→replan chains, conditional active-perception cases, or a successful randomized full-rescue acceptance.
- A real layout_c navigation run encountered Nav2 route recovery/occupancy behavior and was stopped; this is retained as failure evidence, not converted into a pass.

## Truth boundary

- No mock fallback, fixture, scripted tool sequence, teleport, fake pose/camera/event, or MCP contract change was introduced by this phase.
- Agnes Core tracked source was not edited.

Current verdict: RANDOMIZED_ADAPTIVE_DEMO_BLOCKED.
`;
fs.writeFileSync(path.join(OUT, 'randomized-demo-summary.md'), summary);
console.log(JSON.stringify({ pass: false, blocker: regression.blocker }));
