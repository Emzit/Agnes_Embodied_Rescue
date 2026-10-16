import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = path.join(ROOT, 'artifacts/indoor-rescue-upgrade')
const read = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback } }
const rows = (p) => { try { return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) } catch { return [] } }
const write = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n')
const latest = rows(path.join(OUT, 'costmap-watch-lotus-61049-live.jsonl'))
const event = read(path.join(ROOT, 'artifacts/interactive-live/full-mission/imported-physical-event.json'), {})
const privateScenario = read(path.join(ROOT, 'artifacts/interactive-live/imported-runtime/private-scenario.json'), {})
const before = latest.filter(r => r.plan && r.wall_time < Number(event.physical_event_created_at || Infinity)).at(-1) || {}
const around = latest.filter(r => r.plan && r.wall_time >= Number(event.physical_event_created_at || 0))
const firstAfter = around[0] || {}
const firstMarked = around.find(r => (r.global_obstacle_layer?.patch_max || 0) > 0 || (r.global_obstacle_layer?.value || 0) > 0) || null
const oldPoints = before.plan?.points || []
const newPoints = firstAfter.plan?.points || []
const pathHash = points => crypto.createHash('sha256').update(JSON.stringify(points)).digest('hex')
const eventXY = [Number(privateScenario.event?.x), Number(privateScenario.event?.y)]
const eventCell = firstAfter.global_obstacle_layer?.cell || null
const previousPathArtifact = read(path.join(OUT, 'replan-causality-lotus.json'), null)

const rca = {
  generated_at: new Date().toISOString(),
  layout_id: 'lotus_a_greybox',
  event_entity: 'runtime_event_carrier',
  event_link: 'body',
  event_joint: 'event_slide',
  collision_geometry: { name: 'collision', type: 'box', size: [1.4, 1.2, 1.6] },
  visual_geometry: { name: 'visual', type: 'box', size: [1.4, 1.2, 1.6] },
  pose_before: { model: [5.5, -6.2, 0], collision_center: [5.5, -6.2, 0.8], source: 'compiled world.sdf' },
  pose_after: { model: [5.5, -6.2, 0], collision_center: [5.5, -7.642, 0.8], source: 'Gazebo pose/info after 61049 event; measured body relative y=-1.442' },
  old_path_points: oldPoints,
  min_distance_before: { value_m: null, reason: 'old path and pre-event carrier footprint were not captured in the same Gazebo pose sample' },
  min_distance_after: { value_m: null, reason: '61049 measured collision center did not enter the old path corridor; no strict intersection is claimed' },
  lidar_beam_before: firstAfter.scan?.event_beams || null,
  lidar_beam_after: latest.find(r => r.scan?.under_1m > 0 && r.wall_time >= Number(event.physical_event_created_at || 0))?.scan?.event_beams || null,
  scan_detected_event: false,
  global_costmap_origin: firstAfter.global_obstacle_layer?.origin || null,
  global_costmap_resolution: firstAfter.global_obstacle_layer?.resolution || null,
  expected_event_cells: eventCell ? [eventCell] : [],
  actual_marked_cells: firstMarked?.global_obstacle_layer?.region_nonzero || [],
  tf_valid: true,
  tf_calibration: { map_to_odom: { x: 0, y: -6.2 }, source: 'activated skeleton start pose' },
  marking_received: Boolean(firstMarked),
  clearing_behavior: 'Observed no event-cell marking in final 61049; no manual clearing was performed',
  root_cause: 'Lotus event actuation is open-loop and its Gazebo prismatic joint settles at a run-dependent displacement. The requested event target is therefore not guaranteed to place the collision footprint in the old Nav2 path corridor. The earlier Lotus runtime also had a map-to-odom spawn-frame offset; that calibration is now explicit, but the remaining event settling/boundary geometry problem prevents a strict causal replan claim.',
  evidence: [
    '61042/61043: event body moved but was outside the old path/costmap evidence',
    '61047: real scan changed and obstacle-layer cells appeared later, but not at the event cell before the robot passed; mission did not terminal SUCCEEDED',
    '61048/61049: near-range scan changed, while global event-cell marking remained zero',
    'compiled Lotus global costmap includes obstacle_layer, /scan, marking=true, clearing=true'
  ],
  minimal_fix: 'Make the Lotus controller observe the real Gazebo joint/body pose and only accept the event when the measured collision footprint intersects the already-recorded old Nav2 path with map-boundary clearance; then wait for global obstacle-layer marking before allowing the controller to continue. This must remain a physical joint action with no Agent notification or direct memory write.',
  pass: false
}
write('lotus-causal-replan-rca-final.json', rca)

write('lotus-event-lidar-validation.json', {
  generated_at: new Date().toISOString(), layout_id: 'lotus_a_greybox',
  physical_collision_in_old_path: false,
  lidar_detected: true,
  tf_valid: true,
  fresh_scans: true,
  evidence: { mission_id: 'interactive-1791442271749', event_time: event.physical_event_created_at || null,
    scan_before: firstAfter.scan || null,
    scan_after: latest.find(r => r.scan?.under_1m > 0 && r.wall_time >= Number(event.physical_event_created_at || 0))?.scan || null,
    caveat: 'near-range change is real but cannot be attributed to the event collision footprint because the measured joint pose did not intersect the recorded old path' },
  pass: false
})

write('lotus-global-costmap-validation.json', {
  generated_at: new Date().toISOString(), layout_id: 'lotus_a_greybox',
  event_before: { cell: firstAfter.global_obstacle_layer?.cell || null, value: firstAfter.global_obstacle_layer?.value ?? null, region_nonzero: [] },
  event_after: { cell: firstAfter.global_obstacle_layer?.cell || null, value: firstAfter.global_obstacle_layer?.value ?? null, region_nonzero: firstMarked?.global_obstacle_layer?.region_nonzero || [] },
  obstacle_layer_configured: true, scan_topic: '/scan', marking: true, clearing: true,
  old_path_intersects_blocked_region: false,
  root_cause: rca.root_cause,
  pass: false
})

const causal = {
  generated_at: new Date().toISOString(), layout_id: 'lotus_a_greybox', mission_id: 'interactive-1791442271749',
  chronology: {
    T0_old_plan_created: { timestamp: before.wall_time || null, path_hash: before.plan?.hash || pathHash(oldPoints), point_count: oldPoints.length, points: oldPoints },
    T1_physical_event: { timestamp: event.physical_event_created_at || null, event_id: 'carrier-block-lotus-61049', agent_notified: false },
    T2_onboard_detection: { timestamp: firstAfter.wall_time || null, source: 'real /scan', scan_changed: Boolean(firstAfter.scan?.under_1m), global_costmap_marked: Boolean(firstMarked) },
    T3_live_world_update: { timestamp: null, source: null, valid: false },
    T4_old_plan_invalidated: { timestamp: null, reason: null, geometric_conflict: false },
    T5_new_plan_requested: { timestamp: null, source: null },
    T6_new_plan_created: { timestamp: null, path_hash: newPoints.length ? pathHash(newPoints) : null, point_count: newPoints.length, changed: false, points: newPoints },
    T7_execution: { timestamp: null, final_goal_succeeded: false, followed_new_route: false }
  },
  ordering: { required: 'T1 < T2 <= T3 <= T4 <= T5 <= T6 <= T7', satisfied: false },
  physical_event: { entity: 'runtime_event_carrier', link: 'body', joint: 'event_slide', collision: 'collision', visual: 'visual' },
  route_change: { changed: false, causal: false, reason: 'Planner continued with the existing route; no strict event-caused new route was observed' },
  hidden_truth_leak: false,
  previous_artifact_preserved: Boolean(previousPathArtifact),
  pass: false
}
if (previousPathArtifact) causal.previous_artifact_summary = { mission_id: previousPathArtifact.mission_id, pass: previousPathArtifact.pass }
write('replan-causality-lotus-final.json', causal)

write('lotus-final-blocker-debug.json', [
  { attempt: 1, failure: 'event at y=-7.8 not in old route', root_cause_hypothesis: 'target outside path', files_changed: [], test: '61042/61043', result: 'BLOCKED', next_action: 'align Lotus map and odom frames' },
  { attempt: 2, failure: 'Lotus map/world frame offset', root_cause_hypothesis: 'spawn pose not represented in map->odom', files_changed: ['simulation/phase9d/odom_tf.py', 'services/robot-mcp/ros2_bridge/bridge.py'], test: '61045/61047', result: 'TF aligned; navigation API regression remained', next_action: 'calibrate event collision footprint' },
  { attempt: 3, failure: 'event body settled short of old path', root_cause_hypothesis: 'open-loop joint pulse', files_changed: ['scripts/interactive/prepare-imported-runtime.mjs'], test: '61047/61048/61049', result: 'LiDAR changes real; strict global/path causal chain still absent', next_action: 'closed-loop measured joint displacement and path intersection' }
])

const decision = {
  generated_at: new Date().toISOString(), status: 'BLOCKED',
  blocker: 'Lotus causal replan remains unproven: the physical carrier did not produce a measured collision footprint that both intersects the pre-event old path and is marked in the corresponding global costmap cells before a real Nav2 route change.',
  root_cause: rca.root_cause,
  evidence: ['lotus-causal-replan-rca-final.json', 'lotus-event-lidar-validation.json', 'lotus-global-costmap-validation.json', 'replan-causality-lotus-final.json'],
  backup: read(path.join(ROOT, 'backups/pre-nav2-baseline-before-imported-map/backup-verification.json'), read(path.join(ROOT, 'backups/post-nav2-baseline-before-imported-map/backup-verification.json'), null)),
  minimal_fix: rca.minimal_fix,
  no_fake_pass: true
}
write('lotus-causal-final-decision.json', decision)
fs.writeFileSync(path.join(OUT, 'lotus-causal-final-summary.md'), `# Lotus causal replan\n\nStatus: **BLOCKED**\n\nThe Lotus carrier produced real joint motion and real LiDAR changes in the captured runs, but no run proves the required ordered chain through old-path invalidation, a new Nav2 plan, and execution on that new route. Existing failures were retained.\n\nRoot cause: ${rca.root_cause}\n\nMinimal fix: ${rca.minimal_fix}\n`)
