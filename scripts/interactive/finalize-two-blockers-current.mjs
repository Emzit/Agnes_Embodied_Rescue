import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = path.join(ROOT, 'artifacts/indoor-rescue-upgrade')
const read = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback } }
const write = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n')
const simpleRun = path.join(OUT, 'simple-causal-run-20261008-3')
const simpleEvent = read(path.join(simpleRun, 'imported-physical-event.json'), {})
const simplePaths = fs.existsSync(path.join(simpleRun, 'imported-nav-paths.jsonl'))
  ? fs.readFileSync(path.join(simpleRun, 'imported-nav-paths.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
const simpleMission = read(path.join(ROOT, 'artifacts/interactive-live/missions/interactive-1791422306472', 'result.json'), {})
const jamMissionIds = ['interactive-1791420900449', 'interactive-1791421124033']
const jamRuns = jamMissionIds.map(id => ({ id, result: read(path.join(ROOT, 'artifacts/interactive-live/missions', id, 'result.json'), {}), trace: read(path.join(ROOT, 'artifacts/interactive-live/missions', id, 'mcp-trace.json'), []) }))
const jamEvidence = jamRuns.map(({ id, result, trace }) => {
  const open = trace.find(e => String(e.tool || '').endsWith('open_door'))
  const inspect = trace.find(e => String(e.tool || '').endsWith('inspect_door'))
  const nav = trace.filter(e => String(e.tool || '').endsWith('navigate_to')).map(e => e.result?.target).filter(Boolean)
  return { mission_id: id, terminal_status: result.status, inspect_status: inspect?.result?.status || null, open_result: open?.result?.code || null, route_targets: nav, final_report: result.final_report || null }
})
const jamPhysicalFailure = jamEvidence.some(x => x.open_result === 'DOOR_JAMMED_OR_UNAVAILABLE')
const jamCameraPrecondition = jamEvidence.some(x => x.inspect_status === 'SUCCEEDED' && x.open_result === 'DOOR_JAMMED_OR_UNAVAILABLE')
const jamAlternateTerminal = jamEvidence.some(x => x.terminal_status === 'SUCCEEDED' && x.open_result === 'DOOR_JAMMED_OR_UNAVAILABLE' && x.route_targets.includes('Side_Corridor') && x.route_targets.includes('Room_C'))
write('jammed-door-validation.json', {
  generated_at: new Date().toISOString(),
  cases: jamEvidence,
  physical_joint_failure_observed: jamPhysicalFailure,
  camera_observed_closed_before_open: jamCameraPrecondition,
  alternate_route_terminal_succeeded: jamAlternateTerminal,
  physical_evidence: 'validation-only Gazebo skeleton D_c_entry hinge upper_limit=0.0; panel yaw remained 0.0 rad',
  pass: jamPhysicalFailure && jamCameraPrecondition && jamAlternateTerminal,
  blocker: jamCameraPrecondition ? null : 'Real zero-limit joint failure and alternate route are observed, but no captured run has both successful Camera door observation and DOOR_JAMMED_OR_UNAVAILABLE in the same fresh managed session.'
})

const eventTime = Number(simpleEvent.physical_event_created_at || 0)
const triggerPathCount = Number(simpleEvent.trigger_observation?.path_count || 0)
const before = simplePaths.filter(p => p.seq <= triggerPathCount).at(-1) || null
const after = simplePaths.find(p => Number(p.timestamp?.sec || 0) >= Number(simpleEvent.sensor_after_timestamp?.sec || Infinity)) || null
const later = simplePaths.find(p => p.seq > triggerPathCount && p.points?.at(-1)?.[0] > 8) || null
const obstacle = simpleEvent.event_type_private === 'debris_block' ? { x: 6.0, y: 0.0, size: [0.9, 3.8, 1.4] } : null
const oldPathIntersectsObstacle = Boolean(before && obstacle && before.points.some(([x, y]) => Math.abs(x - obstacle.x) < obstacle.size[0] / 2 + 0.45 && Math.abs(y - obstacle.y) < obstacle.size[1] / 2 + 0.45))
const oldPathContinuedAfterSensing = Boolean(after && after.points?.at(-1)?.[0] > 6.2)
const localCostmapChanged = Number(simpleEvent.local_costmap_after?.sample_occupied_or_inflated || 0) !== Number(simpleEvent.local_costmap_before?.sample_occupied_or_inflated || 0)
const strictOrder = { event_time: eventTime, onboard_detection_time: `sim:${simpleEvent.sensor_after_timestamp?.sec}.${String(simpleEvent.sensor_after_timestamp?.nanosec || 0).padStart(9, '0')}`, world_model_update_time: null, plan_invalidation_time: null, new_plan_time: after?.timestamp || null, route_execution_time: later?.timestamp || null, event_before_detection: true, detection_before_world_update: false, world_update_before_invalidation: false, invalidation_before_new_plan: false, new_plan_before_execution: Boolean(after && later) }
write('replan-causality-simple.json', {
  generated_at: new Date().toISOString(), mission_id: 'interactive-1791422306472',
  before_event: { path_count: triggerPathCount, path: before, obstacle_region: obstacle, path_intersects_obstacle: oldPathIntersectsObstacle },
  physical_event: { private_event: simpleEvent.event_type_private, created_at: simpleEvent.physical_event_created_at, agent_notified: simpleEvent.agent_notified, gazebo_response: simpleEvent.gazebo_response },
  onboard_detection: { lidar_before: 'artifacts/indoor-rescue-upgrade/simple-causal-run-20261008-3/imported-lidar-before.json', lidar_after: 'artifacts/indoor-rescue-upgrade/simple-causal-run-20261008-3/imported-lidar-after.json', local_costmap_before: simpleEvent.local_costmap_before, local_costmap_after: simpleEvent.local_costmap_after, local_costmap_changed: localCostmapChanged, global_event_cell_marked: simpleEvent.costmap_after?.event_cell_value > 0 },
  world_model_update: { present: true, source: 'real Agnes world_memory_update', direct_scenario_write: false },
  replan: { old_path_continued_after_sensing: oldPathContinuedAfterSensing, later_path: later, measurable_route_change: Boolean(later && after && later.path_hash !== after.path_hash), causal_route_change: false },
  real_execution: { mission_status: simpleMission.status, pose_history: 'artifacts/indoor-rescue-upgrade/simple-causal-run-20261008-03/imported-pose-history.json', final_report: simpleMission.final_report || null },
  strict_order: strictOrder,
  pass: false,
  blocker: 'Local sensing evidence exists, but global event cell remained unmarked and the Nav2 plan continued through the physical obstacle before any later route change. Causal invalidation is not proven.'
})

const oldLotus = read(path.join(OUT, 'lotus-dynamic-replan-validation.json'), { pass: false })
write('replan-causality-lotus.json', { ...oldLotus, generated_at: new Date().toISOString(), pass: false, blocker: 'Existing Lotus evidence has physical event and sensor timestamps but no strict old-path invalidation/new-route causal chain.', strict_order: oldLotus.strict_order || { pass: false } })

const backup = read(path.join(ROOT, 'backups/post-nav2-baseline-before-imported-map/backup-verification.json'), {})
const debug = [
  { attempt: 1, failure: 'Dynamic blocker did not affect old route', root_cause: 'Event at prior location was outside the effective planner collision window', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs'], test: 'simple real full rescue, event x=8.0,y=0.8', result: 'FAILED strict causal gate; old path continued', next_action: 'move event to trigger-adjacent route region' },
  { attempt: 2, failure: 'local sensing changed but old route still continued', root_cause: 'Event at x=5.3,y=1.05 was seen by LiDAR/local costmap but global event cell remained free', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs','simulation/final_rescue/imported_runtime_controller.py'], test: 'simple real full rescue, event x=5.3,y=1.05', result: 'FAILED strict causal gate', next_action: 'use a full-width physical blocker and inspect Nav2 global marking' },
  { attempt: 3, failure: 'full-width blocker was physically sensed but old Nav2 plan remained valid', root_cause: 'global costmap event cell still 0; controller followed old path through obstacle before later Agent route changes', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs'], test: 'simple real full rescue, event x=6.0,y=0.0,size=0.9x3.8', result: 'FAILED strict causal gate; no fake PASS', next_action: 'fix global obstacle-layer frame/marking and prove planner invalidation before re-running Lotus' }
]
write('final-two-blockers-debug.json', { generated_at: new Date().toISOString(), attempts: debug, no_fake_pass: true, backup_pass: backup.pass === true })
const jamPass = jamPhysicalFailure && jamCameraPrecondition && jamAlternateTerminal
const simplePass = false
const lotusPass = false
write('final-decision.json', { status: 'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED', backup_pass: backup.pass === true, jammed_door_pass: jamPass, simple_causal_replan_pass: simplePass, lotus_causal_replan_pass: lotusPass, blockers: ['jammed door fresh Camera-observation -> DOOR_JAMMED -> alternate terminal chain is not complete in one run', 'simple global Nav2 marking/planner invalidation causal chain is not proven', 'Lotus strict causal replan remains unproven'], no_mock: true, no_fixture: true, no_teleport: true, no_scripted_sequence: true, robot_mcp_tools: 8, wawa: 'WAWA_ASSET_PENDING' })
fs.writeFileSync(path.join(OUT, 'final-summary.md'), `# Final two-blocker status\n\nDecision: **IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED**\n\n- Backup: ${backup.pass === true ? 'PASS and recoverable' : 'FAIL'}.\n- Jammed door: real zero-limit Gazebo joint failure and alternate navigation were observed, but no single fresh managed run proves successful Camera observation before DOOR_JAMMED_OR_UNAVAILABLE; not claimed PASS.\n- Simple causal replan: physical entity, LiDAR change, and local-costmap change are real; global event cell stayed unmarked and old Nav2 path continued, so causal invalidation is not claimed.\n- Lotus causal replan: existing evidence remains insufficient for the strict chain.\n- No mock, fixture, teleport, fake event, or scripted sequence was used. WAWA_ASSET_PENDING remains non-blocking.\n`)
console.log(JSON.stringify({ jam_pass: jamPass, simple_pass: simplePass, lotus_pass: lotusPass, backup_pass: backup.pass === true }, null, 2))
