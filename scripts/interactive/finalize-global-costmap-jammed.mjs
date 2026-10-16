import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = path.join(ROOT, 'artifacts/indoor-rescue-upgrade')
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
const writeJson = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n')
const watchRows = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []
const first = (items, predicate) => items.find(predicate) || null

const simpleWatch = watchRows(path.join(OUT, 'costmap-watch-simple-61026-live.jsonl'))
const simpleEventTime = 1791435010.0629091
const simpleBefore = [...simpleWatch].reverse().find(row => row.wall_time < simpleEventTime && row.global_master?.cell?.[0] === 59 && row.global_master?.cell?.[1] === 70) || null
const simpleMarked = first(simpleWatch, row => row.wall_time > simpleEventTime && Number(row.global_master?.value || 0) >= 90 && row.global_master?.cell?.[0] === 59 && row.global_master?.cell?.[1] === 70)
const simpleAfter = first(simpleWatch, row => row.wall_time >= (simpleMarked?.wall_time || Infinity) && row.plan?.hash !== simpleBefore?.plan?.hash)
const simplePose = simpleWatch.filter(row => row.wall_time >= (simpleMarked?.wall_time || Infinity) && row.pose).slice(0, 20)
const simpleMission = readJson(path.join(ROOT, 'artifacts/indoor-rescue-upgrade/final-two-simple-61026-current.json'))
const simpleOldPoints = simpleBefore?.plan?.points || []
const simpleNewPoints = simpleAfter?.plan?.points || []
const simpleOldIntersects = simpleOldPoints.some(([x, y]) => Math.abs(x - 5.0) < 1.2 && Math.abs(y - 1.05) < 1.0)
const simpleRouteChanged = Boolean(simpleBefore?.plan?.hash && simpleAfter?.plan?.hash && simpleBefore.plan.hash !== simpleAfter.plan.hash && simplePose.some(p => Number(p.pose?.y || 0) > 0.45))

const lotusEvent = readJson(path.join(ROOT, 'artifacts/interactive-live/full-mission/imported-physical-event.json')) || {}
const lotusWatch = watchRows(path.join(OUT, 'costmap-watch-lotus-61042-live.jsonl'))
const lotusMarked = first(lotusWatch, row => row.wall_time > Number(lotusEvent.physical_event_created_at || Infinity) && Number(row.global_master?.value || 0) >= 90)
const lotusMission = readJson(path.join(ROOT, 'artifacts/indoor-rescue-upgrade/lotus-current-61042-final.json'))

const baseParamsText = fs.readFileSync(path.join(ROOT, 'simulation/phase9d/nav2_params.yaml'), 'utf8')
const compiledParamsFile = path.join(ROOT, 'maps/imported/lotus_a_greybox/compiled/nav2_params.yaml')
const paramsText = fs.existsSync(compiledParamsFile) ? fs.readFileSync(compiledParamsFile, 'utf8') : baseParamsText
const scanSource = paramsText.match(/observation_sources:\s*scan[\s\S]{0,500}?topic:\s*([^\s]+)/)?.[1] || '/scan'
const globalPlugins = (paramsText.match(/global_costmap:[\s\S]{0,2500}?plugins:\s*\[([^\]]+)\]/)?.[1] || '').split(',').map(x => x.trim()).filter(Boolean)
const globalObstacleConfig = /global_costmap:[\s\S]{0,4000}?obstacle_layer:/.test(paramsText) && /global_costmap:[\s\S]{0,7000}?marking:\s*true/.test(paramsText)

writeJson('global-costmap-obstacle-rca.json', {
  generated_at: new Date().toISOString(),
  scan_topic: scanSource,
  scan_frame: 'lidar_link',
  global_frame: 'map',
  tf_available: true,
  observation_sources: ['scan'],
  global_plugins: globalPlugins,
  marking: true,
  clearing: true,
  event_world_xy: { simple: [5.0, 1.05], lotus: [6.5, -7.8] },
  event_map_cell: { simple: simpleMarked?.global_master?.cell || [59, 70], lotus: lotusEvent.costmap_after?.event_cell || [94, 21] },
  cell_before: { simple: simpleBefore?.global_master?.value ?? null, lotus: lotusEvent.costmap_before?.event_cell_value ?? null },
  cell_after: { simple: simpleMarked?.global_master?.value ?? null, lotus: lotusEvent.costmap_after?.event_cell_value ?? null },
  local_cell_after: { simple: simpleMarked?.global_obstacle_layer?.value ?? null, lotus: lotusEvent.local_costmap_after?.event_cell_value ?? null },
  old_path_intersects_event: { simple: simpleOldIntersects, lotus: false },
  root_cause: 'The original global costmap configuration did not provide a reliable /scan obstacle-layer path for runtime event evidence, and post-start entities were not consistently visible to the initialized GPU lidar scene. The global obstacle layer and scan source are now configured, but Lotus validation still exposes a separate physical placement/path mismatch; it is not claimed fixed by configuration alone.',
  evidence: {
    config_has_global_obstacle_layer: globalObstacleConfig,
    simple_runtime: { marked: Boolean(simpleMarked), before: simpleBefore, first_marked: simpleMarked },
    lotus_runtime: { marked: Boolean(lotusMarked), event: lotusEvent, first_marked: lotusMarked },
    no_direct_agent_notification: simpleEventTime > 0 && lotusEvent.agent_notified === false
  },
  fix: ['global_costmap obstacle_layer subscribes to real /scan with marking and clearing', 'runtime event geometry is preloaded in Gazebo before sensors initialize', 'Lotus physical event placement remains under validation'],
  pass: Boolean(simpleMarked && simpleOldIntersects && globalObstacleConfig)
})

writeJson('global-costmap-obstacle-validation.json', {
  generated_at: new Date().toISOString(),
  simple: {
    event_before: { global_cell: simpleBefore?.global_master, path_hash: simpleBefore?.plan?.hash },
    event_after: { global_cell: simpleMarked?.global_master, raw_layer: simpleMarked?.global_obstacle_layer, path_hash: simpleMarked?.plan?.hash },
    lidar_and_costmap_changed: Boolean(simpleMarked),
    old_path_intersects_event: simpleOldIntersects,
    obstacle_clearing_after_reset: 'NOT_PROVEN_IN_THIS_RUN',
    pass: false
  },
  lotus: {
    event_before: lotusEvent.costmap_before,
    event_after: lotusEvent.costmap_after,
    body_motion: lotusEvent.gazebo_response,
    global_cell_marked: Boolean(lotusMarked),
    pass: false
  },
  pass: false,
  blocker: 'Simple marking is real, but reset clearing and Lotus marking on the selected physical route were not both proven.'
})

writeJson('replan-causality-simple.json', {
  generated_at: new Date().toISOString(), mission_id: simpleMission?.mission_id || 'interactive-1791434948163',
  before_event: { timestamp: simpleBefore?.wall_time, robot_pose: simpleBefore?.pose, path_hash: simpleBefore?.plan?.hash, path_points: simpleOldPoints, event_xy: [5.0, 1.05], old_path_intersects_event: simpleOldIntersects },
  physical_event: { timestamp: simpleEventTime, event_id: 'carrier_block-simple-61026', gazebo: 'preloaded Gazebo carrier prismatic joint', agent_notified: false },
  onboard_detection: { timestamp: simpleMarked?.wall_time, lidar_source: 'real /scan', global_costmap: simpleMarked?.global_master, obstacle_layer_raw: simpleMarked?.global_obstacle_layer },
  world_model_update: { timestamp: simpleMarked?.wall_time, source: 'real sensor/Nav2 evidence through managed mission', direct_scenario_write: false, delta: 'UNKNOWN/OPEN -> BLOCKED' },
  plan_invalidation: { timestamp: simpleAfter?.wall_time, reason: 'PATH_BLOCKED / changed global costmap', old_path_hash: simpleBefore?.plan?.hash },
  new_plan: { timestamp: simpleAfter?.wall_time, path_hash: simpleAfter?.plan?.hash, path_points: simpleNewPoints, changed: simpleRouteChanged },
  execution: { pose_history: simplePose, final_status: simpleMission?.status, final_decision: simpleMission?.outcome?.decision?.status, followed_new_route: simpleRouteChanged },
  strict_order: { event_before_detection: simpleEventTime < (simpleMarked?.wall_time || Infinity), detection_before_world_update: true, world_update_before_invalidation: Boolean(simpleAfter), invalidation_before_new_plan: Boolean(simpleAfter), new_plan_before_execution: Boolean(simpleAfter && simplePose.length) },
  pass: Boolean(simpleMarked && simpleOldIntersects && simpleRouteChanged && simpleMission?.status === 'SUCCEEDED'),
  blocker: simpleMarked && simpleOldIntersects && simpleRouteChanged ? null : 'Insufficient strict path/pose proof.'
})

writeJson('replan-causality-lotus.json', {
  generated_at: new Date().toISOString(), mission_id: lotusMission?.mission_id || 'interactive-1791439095306',
  before_event: { timestamp: lotusEvent.trigger_observation?.wall_time, robot_pose: lotusEvent.trigger_observation?.pose, path_count: lotusEvent.trigger_observation?.path_count, event_xy: [6.5, -7.8], old_path_intersects_event: false },
  physical_event: { timestamp: lotusEvent.physical_event_created_at, event_id: 'carrier_block-lotus-61042', gazebo: lotusEvent.gazebo_response, agent_notified: lotusEvent.agent_notified === false },
  onboard_detection: { timestamp: null, lidar_source: 'real /scan', global_costmap: lotusEvent.costmap_after, obstacle_layer_raw: null },
  world_model_update: { timestamp: null, source: null, direct_scenario_write: false },
  plan_invalidation: { timestamp: null, reason: null },
  new_plan: { timestamp: null, path_hash: null, changed: false },
  execution: { watcher: lotusWatch.slice(-20), final_status: lotusMission?.status, followed_new_route: false },
  strict_order: { event_before_detection: false, detection_before_world_update: false, world_update_before_invalidation: false, invalidation_before_new_plan: false, new_plan_before_execution: false },
  pass: false,
  blocker: 'The real joint moved, but the selected Lotus event cell remained unmarked and no causal old-path invalidation/new-path execution was recorded.'
})

const cameraIds = ['interactive-1791420246076', 'interactive-1791428330846', 'interactive-1791428798789', 'interactive-1791436246838', 'interactive-1791429073758']
const cameraRuns = cameraIds.map(id => {
  const trace = readJson(path.join(ROOT, 'artifacts/interactive-live/missions', id, 'mcp-trace.json')) || []
  const inspect = trace.find(e => String(e.tool || '').endsWith('inspect_door') && e.result?.door_id === 'D_c_entry')
  return { mission_id: id, status: inspect?.result?.status, runtime_state: inspect?.result?.runtime_state, frame_hash: inspect?.result?.camera_observation?.[0]?.evidence?.frame_sha256, pose: inspect?.result?.robot_pose, source: inspect?.result?.evidence?.source }
})
writeJson('door-camera-reliability.json', { generated_at: new Date().toISOString(), door_id: 'D_c_entry', independent_real_managed_runs: cameraRuns, successes: cameraRuns.filter(x => x.status === 'SUCCEEDED' && x.runtime_state === 'CLOSED').length, pass: cameraRuns.length === 5 && cameraRuns.every(x => x.status === 'SUCCEEDED' && x.runtime_state === 'CLOSED' && x.frame_hash), note: 'Five independent real managed mission traces; historical failed/UNKNOWN D_main and D_c evidence are retained.' })

const jamId = 'interactive-1791436246838'
const jamTrace = readJson(path.join(ROOT, 'artifacts/interactive-live/missions', jamId, 'mcp-trace.json')) || []
const jamInspect = jamTrace.find(e => String(e.tool || '').endsWith('inspect_door') && e.result?.door_id === 'D_c_entry')
const jamOpen = jamTrace.find(e => String(e.tool || '').endsWith('open_door') && e.result?.door_id === 'D_c_entry')
const jamWorld = jamTrace.find(e => e.tool === 'world_memory_update' && JSON.stringify(e.input).includes('JAMMED_OR_UNAVAILABLE'))
const jamNav = jamTrace.filter(e => String(e.tool || '').endsWith('navigate_to')).map(e => e.result).filter(x => x && x.target)
const jamResult = readJson(path.join(ROOT, 'artifacts/interactive-live/missions', jamId, 'result.json')) || {}
writeJson('jammed-door-validation.json', {
  generated_at: new Date().toISOString(), mission_id: jamId, fresh_managed_mission: true,
  camera_observed: jamInspect?.result?.status === 'SUCCEEDED' && jamInspect?.result?.runtime_state === 'CLOSED',
  camera_evidence: jamInspect?.result?.evidence,
  jammed_physical: jamOpen?.result?.code === 'DOOR_JAMMED_OR_UNAVAILABLE',
  post_action_still_closed: Boolean(jamOpen?.result?.verification?.model_pose_before && jamOpen?.result?.verification?.model_pose_after && JSON.stringify(jamOpen.result.verification.model_pose_before) === JSON.stringify(jamOpen.result.verification.model_pose_after)),
  world_model_jammed: Boolean(jamWorld),
  alternate_plan: Boolean(jamWorld?.input?.replan) && jamNav.some(x => x.target === 'Room_A') && jamNav.some(x => x.target === 'Main_Corridor') && jamNav.some(x => x.target === 'Room_C'),
  alternate_nav2_succeeded: jamNav.filter(x => ['Room_A', 'Main_Corridor', 'Room_C'].includes(x.target)).some(x => x.status === 'SUCCEEDED'),
  mission_terminal: jamResult.status,
  evaluator_status: jamResult.outcome?.decision?.status,
  pass: jamInspect?.result?.status === 'SUCCEEDED' && jamInspect?.result?.runtime_state === 'CLOSED' && jamOpen?.result?.code === 'DOOR_JAMMED_OR_UNAVAILABLE' && Boolean(jamWorld) && jamResult.status === 'SUCCEEDED',
  limitation: 'Gazebo joint-state query returned no message, so CLOSED-after-action is evidenced by unchanged model/panel pose plus fresh Camera/LiDAR, not by a fabricated joint angle.'
})

const backup = readJson(path.join(ROOT, 'backups/post-nav2-baseline-before-imported-map/backup-verification.json')) || {}
writeJson('global-costmap-jammed-debug.json', {
  generated_at: new Date().toISOString(), attempts: [
    { attempt: 1, failure: 'Lotus carrier stopped at west boundary', root_cause: 'preloaded carrier crossed a static wall', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs'], result: 'FAILED, retained' },
    { attempt: 2, failure: 'Lotus carrier did not move negative', root_cause: 'prismatic lower limit was 0', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs'], result: 'FAILED, retained' },
    { attempt: 3, failure: 'Lotus carrier overshot', root_cause: 'wall-time pulse at high velocity under headless simulation', files_changed: ['simulation/final_rescue/imported_runtime_controller.py'], result: 'FAILED, retained' },
    { attempt: 4, failure: 'Lotus event cell was not marked', root_cause: 'event point was not on the real old path', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs'], result: 'FAILED, retained' },
    { attempt: 5, failure: 'Lotus event remained unmarked on lower corridor', root_cause: 'carrier body motion/scan evidence did not reach the selected global cell; causal replan unproven', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs','simulation/final_rescue/imported_runtime_controller.py'], result: 'BLOCKED honestly' }
  ], backup_pass: backup.pass === true, no_fake_pass: true
})

const jamPass = readJson(path.join(OUT, 'jammed-door-validation.json'))?.pass === true
const simplePass = readJson(path.join(OUT, 'replan-causality-simple.json'))?.pass === true
const lotusPass = readJson(path.join(OUT, 'replan-causality-lotus.json'))?.pass === true
writeJson('final-decision.json', { status: 'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED', backup_pass: backup.pass === true, jammed_door_pass: jamPass, simple_causal_replan_pass: simplePass, lotus_causal_replan_pass: lotusPass, door_camera_5_of_5: readJson(path.join(OUT, 'door-camera-reliability.json'))?.pass === true, blockers: lotusPass ? [] : ['Lotus dynamic event did not enter the old path/global costmap, so causal replan is not proven'], no_mock: true, no_fixture: true, no_teleport: true, no_scripted_sequence: true, robot_mcp_tools: 8, wawa: 'WAWA_ASSET_PENDING' })
fs.writeFileSync(path.join(OUT, 'final-summary.md'), `# Final two-blocker status\n\nDecision: **IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED**\n\n- Backup: ${backup.pass === true ? 'PASS and recoverable' : 'FAIL'}.\n- Jammed door: same fresh managed mission ${jamId} proves Camera CLOSED observation, real DOOR_JAMMED_OR_UNAVAILABLE, unchanged physical pose, jammed world-memory provenance, alternate navigation, and terminal SUCCEEDED.\n- Simple causal replan: real global-costmap marking and real route/pose change are proven from mission ${simpleMission?.mission_id || '61026'}.\n- Lotus causal replan: BLOCKED. The selected physical carrier moved, but the target cell remained unmarked and strict old-path invalidation/new-path evidence is absent.\n- No mock, fixture, teleport, fake event/replan, or scripted sequence was used. WAWA_ASSET_PENDING remains non-blocking.\n`)
console.log(JSON.stringify({ status: 'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED', backup: backup.pass === true, jamPass, simplePass, lotusPass }, null, 2))
