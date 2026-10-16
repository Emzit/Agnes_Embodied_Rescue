import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const requestedLayout = process.argv[2] || 'simple'
const jammed = requestedLayout === 'jammed'
const layout = jammed ? 'simple' : requestedLayout
const seed = Number(process.argv[3] || (Date.now() % 0xffffffff)) >>> 0
const source = layout === 'lotus' ? 'maps/imported/lotus_a_greybox/map_skeleton.json' : 'maps/imported/simple_rescue/map_skeleton.json'
const compiled = layout === 'lotus' ? 'maps/imported/lotus_a_greybox/compiled' : 'maps/imported/simple_rescue/compiled'
const skeleton = JSON.parse(fs.readFileSync(path.join(ROOT, source), 'utf8'))
let runtimeSource = source
let runtimeCompiled = compiled
if (jammed) {
  // Build a separate validation-only skeleton.  The canonical simple map and
  // all normal door cases remain untouched; only this real Gazebo scenario
  // carries a zero-opening hinge limit for D_c_entry.
  const jammedSkeleton = JSON.parse(JSON.stringify(skeleton))
  jammedSkeleton.metadata = { ...jammedSkeleton.metadata, id: 'simple_rescue_import_jammed_validation' }
  jammedSkeleton.doors = jammedSkeleton.doors.map(door => door.id === 'D_c_entry' ? { ...door, runtime_jammed: true } : door)
  runtimeSource = 'artifacts/interactive-live/imported-runtime/jammed-map-skeleton.json'
  runtimeCompiled = 'artifacts/interactive-live/imported-runtime/compiled-jammed'
  fs.mkdirSync(path.join(ROOT, path.dirname(runtimeSource)), { recursive: true })
  fs.writeFileSync(path.join(ROOT, runtimeSource), JSON.stringify(jammedSkeleton, null, 2) + '\n')
  const compile = spawnSync('python3', [path.join(ROOT, 'scripts/map-import/map_import.py'), 'activate', path.join(ROOT, runtimeSource), '--out', path.join(ROOT, runtimeCompiled)], { cwd: ROOT, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error(`jammed validation compile failed: ${compile.stderr || compile.stdout}`)
}
const activeCompiled = runtimeCompiled
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, activeCompiled, 'world_registry.json'), 'utf8'))
if (layout === 'lotus') {
  // Start is a waypoint, not a semantic region covering the entire map.
  // Keep authoritative room/corridor bounds from the static map prior.
  for (const location of registry.locations || []) {
    if (location.type === 'start') delete location.bounds
  }
  fs.writeFileSync(path.join(ROOT, activeCompiled, 'world_registry.json'), JSON.stringify(registry, null, 2) + '\n')
}
const byId = new Map((registry.locations || []).map(item => [item.id, item]))
const room = layout === 'lotus' ? byId.get('A_Site') : byId.get('Room_B')
const victim = layout === 'lotus' ? { x: 5.8, y: 3.35, yaw: 0.2, room: 'A_Site' } : { x: 10.8, y: 0.55, yaw: 0.1, room: 'Room_B' }
const event = layout === 'lotus'
  // The map-prior door is already loaded in Gazebo and starts open.  Closing
  // that real hinge after A_Tree entry makes the event visible to the running
  // gpu_lidar/costmaps without inserting a post-start render entity.
  // The carrier starts just off the lower-corridor centerline and moves a
  // short, real prismatic-joint distance into the route after the old plan
  // exists.  Keeping the requested displacement short avoids the Gazebo
  // joint-controller settling error seen with the former near-boundary
  // target, while the final collision footprint still crosses the path.
  ? { type: 'carrier_block', route: 'A_Link_future_segment', trigger: 'on_region_entry', x: 9.5, y: -6.5, yaw: 0, size: [1.4, 1.2, 1.6], carrier_axis: 'y', carrier_start: [9.5, -3.0] }
  : jammed
  ? { type: 'jammed_door', route: 'Start_to_Room_C_via_D_c_entry', trigger: 'on_d_c_approach', x: 2.0, y: -2.1, yaw: 0, size: [1.35, 0.7, 1.8] }
  : { type: 'carrier_block', door_id: 'D_main', route: 'Main_Corridor_to_Room_B', trigger: 'on_region_entry', x: 5.0, y: 1.05, yaw: 0, size: [1.4, 1.0, 1.6], carrier_axis: 'x', carrier_start: [-12, 1.05] }

// The event carrier is part of the activated Gazebo world from startup, but
// its body begins outside the map and outside the robot sensor range.  A real
// prismatic joint later moves it into the selected route; no pose-setting or
// post-start EntityFactory render insertion is used.
const carrierModel = (event.carrier_start || []).length === 2 ? `
<model name="runtime_event_carrier"><static>false</static><pose>${event.carrier_start[0]} ${event.carrier_start[1]} 0 0 0 0</pose>
<link name="anchor"><gravity>false</gravity><inertial><mass>1</mass><inertia><ixx>0.01</ixx><iyy>0.01</iyy><izz>0.01</izz></inertia></inertial></link>
<link name="body"><pose>0 0 ${Number(event.size[2]) / 2} 0 0 0</pose><gravity>false</gravity><inertial><mass>20</mass><inertia><ixx>1</ixx><iyy>1</iyy><izz>1</izz></inertia></inertial><collision name="collision"><geometry><box><size>${event.size[0]} ${event.size[1]} ${event.size[2]}</size></box></geometry></collision><visual name="visual"><geometry><box><size>${event.size[0]} ${event.size[1]} ${event.size[2]}</size></box></geometry><material><diffuse>.52 .28 .08 1</diffuse></material></visual></link>
<joint name="event_slide" type="prismatic"><parent>anchor</parent><child>body</child><axis><xyz>${event.carrier_axis === 'x' ? 1 : 0} ${event.carrier_axis === 'y' ? 1 : 0} 0</xyz><limit><lower>-30</lower><upper>30</upper><effort>1000</effort><velocity>10</velocity></limit><dynamics><damping>0.1</damping></dynamics></axis></joint><plugin filename="gz-sim-joint-controller-system" name="gz::sim::systems::JointController"><joint_name>event_slide</joint_name></plugin>${layout === 'lotus' ? '<plugin filename="gz-sim-pose-publisher-system" name="gz::sim::systems::PosePublisher"><publish_link_pose>true</publish_link_pose><publish_model_pose>true</publish_model_pose><use_pose_vector_msg>true</use_pose_vector_msg><update_frequency>100</update_frequency></plugin>' : ''}</model>` : ''
const carrierAnchorJoint = carrierModel ? '<joint name="runtime_event_carrier_anchor" type="fixed"><parent>world</parent><child>runtime_event_carrier::anchor</child></joint>' : ''
const compiledWorldPath = path.join(ROOT, activeCompiled, 'world.sdf')
let compiledWorld = fs.readFileSync(compiledWorldPath, 'utf8')
compiledWorld = compiledWorld.replace(/<model name="runtime_event_carrier">[\s\S]*?<\/model>/g, '')
compiledWorld = compiledWorld.replace(/<joint name="runtime_event_carrier_anchor"[^>]*>[\s\S]*?<\/joint>/g, '')
if (carrierModel) compiledWorld = compiledWorld.replace('</world></sdf>', `${carrierModel}${carrierAnchorJoint}</world></sdf>`)
if (event.type === 'carrier_block' && event.door_id) {
  // Runtime-only initial state: the map prior still says only that the door
  // exists.  Start the already-loaded hinge at its upper joint limit so the
  // event can later close it through the real controller without first
  // driving a collision-locked panel.
  const axis = `<joint name="${event.door_id}_hinge" type="revolute"><parent>frame</parent><child>panel</child><axis><xyz>0 0 1</xyz>`
  if (compiledWorld.includes(axis) && !compiledWorld.includes(`<initial_position>1.57</initial_position>`)) compiledWorld = compiledWorld.replace(axis, `${axis}<initial_position>1.57</initial_position>`)
  const openYaw = event.door_id === 'D_c_entry' ? '1.5708' : '3.1416'
  const closedYaw = event.door_id === 'D_c_entry' ? '0' : '1.5708'
  const panelClosed = `<model name="door_${event.door_id}">`
  const start = compiledWorld.indexOf(panelClosed)
  if (start >= 0) {
    const end = compiledWorld.indexOf('</model>', start)
    const segment = compiledWorld.slice(start, end)
    const replaced = segment.replace(`<pose>0 0 1.1 0 0 ${closedYaw}</pose>`, `<pose>0 0 1.1 0 0 ${openYaw}</pose>`)
    const runtimeSegment = event.door_id === 'D_c_entry'
      ? replaced.replace('<limit><lower>0</lower><upper>1.57</upper></limit>', '<limit><lower>1.57</lower><upper>1.57</upper></limit>')
      : replaced
    compiledWorld = compiledWorld.slice(0, start) + runtimeSegment + compiledWorld.slice(end)
  }
}
fs.writeFileSync(compiledWorldPath, compiledWorld)
if (layout === 'lotus') {
  const paramsPath = path.join(ROOT, activeCompiled, 'nav2_params.yaml')
  let params = fs.readFileSync(paramsPath, 'utf8')
  params = params.replace(/xy_goal_tolerance: [\d.]+/, 'xy_goal_tolerance: 0.08')
  // Keep both Nav2 stateful switches explicit.  The goal checker and RPP
  // must use the same XY convergence semantics after an AMCL correction.
  params = params.replace(/(FollowPath:\n\s+plugin:[^\n]+\n)(?!\s+stateful:)/,
    '$1      stateful: false\n')
  params = params.replace(/^    default_nav_to_pose_bt_xml:.*\n/gm, '')
  params = params.replace('    bt_loop_duration: 10', `    default_nav_to_pose_bt_xml: ${ROOT}/simulation/final_rescue/lotus_managed_navigation.xml\n    bt_loop_duration: 10`)
  params = params.replace(/node_names: \[[^\]]*\]/, 'node_names: [map_server, amcl, planner_server, controller_server, behavior_server, bt_navigator]')
  params = params.replace(/\namcl:\n[\s\S]*$/, '')
  params += `\namcl:
  ros__parameters:
    use_sim_time: true
    base_frame_id: base_link
    odom_frame_id: odom
    global_frame_id: map
    scan_topic: /scan
    tf_broadcast: true
    transform_tolerance: 0.5
    set_initial_pose: true
    initial_pose:
      x: ${Number(skeleton.start_poses?.[0]?.x || 0).toFixed(8)}
      y: ${Number(skeleton.start_poses?.[0]?.y || 0).toFixed(8)}
      z: 0.0
      yaw: ${Number(skeleton.start_poses?.[0]?.yaw || 0).toFixed(8)}
    robot_model_type: nav2_amcl::DifferentialMotionModel
    laser_model_type: likelihood_field_prob
    laser_max_range: 12.0
    laser_min_range: 0.1
    laser_likelihood_max_dist: 2.0
    max_beams: 90
    # The imported Lotus prior leaves the D_A_Link doorway open in the
    # occupancy map while the physical panel can be closed.  Skip only beams
    # whose live return is inconsistent with the prior; this keeps AMCL from
    # translating map->odom by the door panel footprint.
    do_beamskip: true
    beam_skip_distance: 0.5
    beam_skip_threshold: 0.3
    beam_skip_error_threshold: 0.9
    min_particles: 500
    max_particles: 2000
    update_min_d: 0.05
    update_min_a: 0.05
    alpha1: 0.2
    alpha2: 0.2
    alpha3: 0.2
    alpha4: 0.2
    sigma_hit: 0.2
    z_hit: 0.8
    z_rand: 0.2
    recovery_alpha_slow: 0.001
    recovery_alpha_fast: 0.1
`
  fs.writeFileSync(paramsPath, params)
}
const privateScenario = { schema_version: 1, seed, layout_id: layout === 'lotus' ? 'lotus_a_greybox' : 'simple_rescue_imported', runtime_case: jammed ? 'jammed_door_validation' : 'dynamic_event_validation', generated_at: new Date().toISOString(), map_prior_source: runtimeSource, victim, event, objects: [], hidden_ground_truth: { person_target_room: victim.room, person_pose: victim, dynamic_obstacle_event: event }, runtime_controller: 'simulation/final_rescue/imported_runtime_controller.py' }
const privateDir = path.join(ROOT, 'artifacts/interactive-live/imported-runtime')
fs.mkdirSync(privateDir, { recursive: true })
fs.writeFileSync(path.join(privateDir, 'private-scenario.json'), JSON.stringify(privateScenario, null, 2) + '\n')
const publicScenario = { schema_version: 1, seed, layout_id: privateScenario.layout_id, generated_at: privateScenario.generated_at, layout: { id: privateScenario.layout_id, world: `${activeCompiled}/world.sdf`, map: `${activeCompiled}/map.yaml`, registry: `${activeCompiled}/world_registry.json`, alternate_route: true }, robot_start: skeleton.start_poses?.[0] || { x: 0, y: 0, yaw: 0, frame_id: 'map' }, semantic_locations: (registry.locations || []).map(item => ({ id: item.id, type: item.type, pose: item.pose, adjacency: item.adjacency })), observed_facts: [], hidden_ground_truth_leak: false, runtime_visibility: 'pre-run-safe-public-view' }
fs.writeFileSync(path.join(ROOT, 'artifacts/interactive-live/current-scenario.json'), JSON.stringify(publicScenario, null, 2) + '\n')
const envFile = path.join(ROOT, 'artifacts/interactive-live/imported-map.env')
let env = fs.readFileSync(envFile, 'utf8')
  .split('\n')
  .filter(line => !/^(export (IMPORTED_MAP_|SCENARIO_LOCALIZATION=|SCENARIO_WORLD=|SCENARIO_MAP=|SCENARIO_NAV2_PARAMS=|SCENARIO_BRIDGE=|SCENARIO_REGISTRY=|ENV_INTERACTION_REGISTRY=|SCENARIO_WORLD_NAME=|SCENARIO_PRIVATE_FILE=|SCENARIO_DYNAMIC_CONTROLLER=))/.test(line))
  .join('\n')
const worldName = skeleton.metadata?.id || (layout === 'lotus' ? 'lotus_a_greybox' : 'simple_rescue_import')
env += `export IMPORTED_MAP_SKELETON=${path.join(ROOT, runtimeSource)}\n`
env += `export IMPORTED_MAP_DIR=${path.join(ROOT, activeCompiled)}\n`
env += `export SCENARIO_WORLD=${path.join(ROOT, activeCompiled, 'world.sdf')}\n`
env += `export SCENARIO_MAP=${path.join(ROOT, activeCompiled, 'map.yaml')}\n`
env += `export SCENARIO_NAV2_PARAMS=${path.join(ROOT, activeCompiled, 'nav2_params.yaml')}\n`
env += `export SCENARIO_BRIDGE=${path.join(ROOT, activeCompiled, 'bridge.yaml')}\n`
env += `export SCENARIO_REGISTRY=${path.join(ROOT, activeCompiled, 'world_registry.json')}\n`
env += `export ENV_INTERACTION_REGISTRY=${path.join(ROOT, activeCompiled, 'interaction-registry.json')}\n`
env += `export SCENARIO_WORLD_NAME=${worldName}\n`
if (layout === 'lotus') env += 'export SCENARIO_LOCALIZATION=amcl\n'
const startPose = skeleton.start_poses?.[0] || { x: 0, y: 0 }
env += `export SCENARIO_MAP_ODOM_X=${Number(startPose.x || 0)}\n`
env += `export SCENARIO_MAP_ODOM_Y=${Number(startPose.y || 0)}\n`
env += `export SCENARIO_PRIVATE_FILE=${privateDir}/private-scenario.json\nexport SCENARIO_DYNAMIC_CONTROLLER=simulation/final_rescue/imported_runtime_controller.py\n`
fs.writeFileSync(envFile, env)
console.log(JSON.stringify({ layout: privateScenario.layout_id, seed, public_fields: ['layout', 'semantic_locations', 'observed_facts'], private_file: `${privateDir}/private-scenario.json`, controller: 'simulation/final_rescue/imported_runtime_controller.py' }))
