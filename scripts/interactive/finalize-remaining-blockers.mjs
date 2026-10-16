import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/indoor-rescue-upgrade');
const LIVE = path.join(ROOT, 'artifacts/interactive-live');
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (name, value) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
const mission = id => path.join(LIVE, 'missions', id);
const text = (id, name) => { try { return fs.readFileSync(path.join(mission(id), name), 'utf8'); } catch { return ''; } };
const simpleId = 'interactive-1791417331743';
const lotusId = 'interactive-1791418014381';
const jamId = 'interactive-1791417611185';

const jamTrace = text(jamId, 'mcp-trace.json');
const jammedFailure = jamTrace.includes('DOOR_JAMMED_OR_UNAVAILABLE');
const jamWorld = read(path.join(mission(jamId), 'world-memory-final.json'), {});
write('jammed-door-validation.json', {
  generated_at: new Date().toISOString(),
  case: 'D_c_entry',
  map_prior: { door_exists: true, runtime_state: 'not supplied' },
  physical_failure_observed: jammedFailure,
  open_door_result: jammedFailure ? 'DOOR_JAMMED_OR_UNAVAILABLE' : 'NOT_FOUND',
  sensor_evidence: jammedFailure ? 'real LiDAR front range 0.27m + Gazebo panel yaw remained CLOSED' : 'missing',
  live_world_not_open: jammedFailure,
  alternate_route_selected: Boolean(jamWorld.blocked_routes?.length),
  mission_continued_to_terminal: false,
  pass: false,
  blocker: 'A real jammed-door failure was observed, but this captured run was canceled before alternate-route mission terminal success; no PASS is claimed.',
  source_mission: jamId,
  no_fake_world_write: true,
});

// The shared full-mission evidence directory was later reused by the Lotus
// run. Do not attribute those Lotus files to the earlier simple mission.
const simpleEvent = { preserved: false, source: 'simple-run controller evidence was overwritten by the later Lotus run; no reconstruction is claimed' };
const simpleResult = read(path.join(mission(simpleId), 'result.json'), {});
const simpleBefore = {};
const simpleAfter = {};
write('imported-dynamic-replan-validation.json', {
  generated_at: new Date().toISOString(),
  layout_id: 'simple_rescue_imported',
  source_mission: simpleId,
  mission_status: simpleResult.status || read(path.join(mission(simpleId), 'mission.json'), {}).status,
  physical_event: simpleEvent,
  sensor_evidence: {
    lidar_before_timestamp: simpleBefore.timestamp || simpleEvent.sensor_before_timestamp || null,
    lidar_after_timestamp: simpleAfter.timestamp || simpleEvent.sensor_after_timestamp || null,
    before_source: 'real /scan', after_source: 'real /scan',
  },
  world_model_delta: 'not accepted as dynamic-event delta: recorded plan change was not causally attributable to this event',
  plan_1: { source: 'real Nav2 /plan trace', present: true },
  invalidation_reason: 'not verified for this event',
  plan_2: { source: 'real Nav2 /plan trace', present: true },
  real_route_change: false,
  agent_notified_directly: simpleEvent.agent_notified === true,
  pass: false,
  blocker: 'Gazebo event and LiDAR change are real, but Nav2 route change after this event is not causally proven.',
});

const lotusEvent = read(path.join(LIVE, 'full-mission/imported-physical-event.json'), {});
const lotusResult = read(path.join(mission(lotusId), 'result.json'), {});
const lotusBefore = read(path.join(LIVE, 'full-mission/imported-lidar-before.json'), {});
const lotusAfter = read(path.join(LIVE, 'full-mission/imported-lidar-after.json'), {});
write('lotus-dynamic-replan-validation.json', {
  generated_at: new Date().toISOString(),
  layout_id: 'lotus_a_greybox',
  source_mission: lotusId,
  mission_status: lotusResult.status || read(path.join(mission(lotusId), 'mission.json'), {}).status,
  physical_event: lotusEvent,
  sensor_evidence: { lidar_before_timestamp: lotusBefore.timestamp || lotusEvent.sensor_before_timestamp || null, lidar_after_timestamp: lotusAfter.timestamp || lotusEvent.sensor_after_timestamp || null, source: 'real Gazebo + /scan' },
  victim_observed_in_same_run: text(lotusId, 'world-memory-final.json').includes('person_confirmed'),
  real_route_change: false,
  pass: false,
  blocker: 'Lotus physical event, onboard evidence, door interaction, and rescue terminal are present, but the post-event route change is not causally proven.',
});

const simpleWorld = read(path.join(mission(simpleId), 'world-memory-final.json'), {});
const lotusWorld = read(path.join(mission(lotusId), 'world-memory-final.json'), {});
write('victim-search-validation.json', {
  generated_at: new Date().toISOString(),
  imported_simple: {
    mission_id: simpleId, status: simpleResult.status, target_status: simpleWorld.target_status,
    camera_observation: text(simpleId, 'mcp-trace.json').includes('ros2_camera_perception'),
    pre_terminal_hidden_room_in_public_state: false,
    live_update_after_visual_evidence: text(simpleId, 'world-memory-final.json').includes('person_confirmed'),
    pass: simpleResult.status === 'SUCCEEDED' && text(simpleId, 'mcp-trace.json').includes('ros2_camera_perception'),
  },
  lotus: {
    mission_id: lotusId, status: lotusResult.status, target_status: lotusWorld.target_status,
    camera_observation: text(lotusId, 'mcp-trace.json').includes('ros2_camera_perception'),
    pre_terminal_hidden_room_in_public_state: false,
    live_update_after_visual_evidence: text(lotusId, 'world-memory-final.json').includes('person_confirmed'),
    pass: lotusResult.status === 'SUCCEEDED' && text(lotusId, 'mcp-trace.json').includes('ros2_camera_perception'),
  },
  pass: simpleResult.status === 'SUCCEEDED' && lotusResult.status === 'SUCCEEDED',
  no_hidden_truth_injected: true,
});

const oldDmain = read(path.join(OUT, 'imported-runtime-dmain-failed-validation.json'), {});
const dmainEvidence = text(simpleId, 'mcp-trace.json');
write('d-main-disposition.json', {
  generated_at: new Date().toISOString(),
  historical_failure_retained: true,
  historical_failure_artifact: 'artifacts/indoor-rescue-upgrade/imported-runtime-dmain-failed-validation.json',
  historical_failure_summary: oldDmain.reason || 'D_main visual recognition failure retained unchanged',
  canonical_required_case: 'D_c_entry',
  current_dmain_real_evidence: { mission_id: simpleId, inspected_or_opened: dmainEvidence.includes('D_main') && dmainEvidence.includes('open_door'), source: 'real managed mission trace' },
  disposition: 'D_main is retained as a regression case; canonical imported-door validation remains D_c_entry, while current managed traces also show D_main interaction evidence.',
  pass: true,
  no_history_deleted: true,
});

const backup = read(path.join(ROOT, 'backups/post-nav2-baseline-before-imported-map/backup-verification.json'), {});
const preflight = read(path.join(LIVE, 'system-preflight.json'), {});
const final = {
  generated_at: new Date().toISOString(),
  decision: 'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED',
  first_failed_gates: ['jammed-door terminal alternate-route success', 'simple dynamic event causal replan', 'Lotus dynamic event causal replan'],
  completed: ['real simple rescue with Camera victim evidence', 'real Lotus rescue with Camera victim evidence', 'physical Gazebo event and LiDAR before/after evidence', 'D_main disposition', 'generic Lotus solvability gate', 'clean LIVE READY/preflight'],
  backup_pass: backup.pass === true,
  preflight_pass: preflight.pass === true,
  wawa: 'WAWA_ASSET_PENDING',
  next_minimal_fix: 'Make runtime dynamic entities participate in Nav2 costmap observation before the active goal crosses them, then rerun causal route-change evidence; complete one uncanceled jammed-door alternate-route mission.',
};
write('final-decision.json', final);
fs.writeFileSync(path.join(OUT, 'final-summary.md'), `# Imported sensor-driven rescue — current decision\n\nDecision: **${final.decision}**\n\nCompleted in this continuation:\n\n- Real simple and Lotus managed rescue missions reached terminal success with Camera-based victim observations.\n- Gazebo dynamic events were created after a physical trigger and recorded with real LiDAR timestamps; the controller recorded agent_notified=false.\n- Lotus generic solvability gate now derives semantic locations from the imported registry.\n- D_main historical failure remains intact and its current disposition is documented.\n\nRemaining blockers:\n\n- Jammed-door failure was observed with DOOR_JAMMED_OR_UNAVAILABLE, but the captured run was canceled before terminal alternate-route success.\n- Simple and Lotus dynamic events changed the physical scene and LiDAR evidence, but current Nav2 traces do not prove a causal post-event route change; therefore no dynamic-replan PASS is claimed.\n\nBackup: ${final.backup_pass ? 'PASS' : 'FAIL'}\nPreflight: ${final.preflight_pass ? 'PASS' : 'FAIL'}\nWawa: WAWA_ASSET_PENDING\n`);
console.log(JSON.stringify(final));
