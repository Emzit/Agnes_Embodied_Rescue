#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/interactive-live');
const SCENARIO_DIR = path.join(OUT, 'scenarios');
const RUNTIME_ENV = path.join(OUT, 'current-scenario.env');
const CURRENT = path.join(OUT, 'current-scenario.json');
const PRIVATE_CURRENT = path.join(OUT, 'scenario-controller', 'current-private.json');

// This is the only runtime random entry point. Layout assets are reviewed, finite
// templates; the PRNG only selects and parameterizes those assets.
const LAYOUTS = [
  { id: 'layout_a', label: 'Baseline rescue topology', world: 'simulation/scenarios/layout_a/world.sdf', map: 'simulation/scenarios/layout_a/map.yaml', nav2: 'simulation/scenarios/layout_a/nav2_params.yaml', bridge: 'simulation/scenarios/layout_a/bridge.yaml', registry: 'simulation/scenarios/layout_a/world_registry.json', alternate_route: true },
  { id: 'layout_b', label: 'Offset corridor topology', world: 'simulation/scenarios/layout_b/world.sdf', map: 'simulation/scenarios/layout_b/map.yaml', nav2: 'simulation/scenarios/layout_b/nav2_params.yaml', bridge: 'simulation/scenarios/layout_b/bridge.yaml', registry: 'simulation/scenarios/layout_b/world_registry.json', alternate_route: true },
  { id: 'layout_c', label: 'Crossing corridor topology', world: 'simulation/scenarios/layout_c/world.sdf', map: 'simulation/scenarios/layout_c/map.yaml', nav2: 'simulation/scenarios/layout_c/nav2_params.yaml', bridge: 'simulation/scenarios/layout_c/bridge.yaml', registry: 'simulation/scenarios/layout_c/world_registry.json', alternate_route: true },
];
const PERSON_ROOMS = ['Room_A', 'Room_B', 'Room_C'];
const OBJECT_LABELS = ['fire_extinguisher', 'toolbox', 'hazard_marker'];
const OBSTACLE_EVENTS = [
  { type: 'cabinet_block', route: 'Corridor_A', trigger: 'after_room_inspection' },
  { type: 'crate_block', route: 'Side_Corridor', trigger: 'after_navigation_observation' },
  { type: 'door_closes', route: 'Corridor_B', trigger: 'after_target_area_entry' },
];

function hashSeed(seed) {
  let value = Number(seed) >>> 0;
  if (!value) value = 1;
  return value;
}
function rng(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function pick(random, values) { return values[Math.floor(random() * values.length)]; }
function round(value) { return Math.round(value * 1000) / 1000; }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function stamp() { return new Date().toISOString(); }
function template(id) { return LAYOUTS.find(item => item.id === id) || LAYOUTS[0]; }
function registryFor(layout) { return readJson(path.resolve(ROOT, layout.registry), { locations: [] }); }
function safeRoomPose(room, random, anchor = null) {
  const center = room.pose || { x: 0, y: 0 };
  const bounds = room.bounds || { min_x: center.x - 0.8, max_x: center.x + 0.8, min_y: center.y - 0.8, max_y: center.y + 0.8 };
  let candidates = [
    [-0.75, -0.9], [0.75, -0.9], [-0.75, 0.9], [0.75, 0.9],
    [-0.9, 0], [0.9, 0], [0, -1.0], [0, 1.0],
  ].map(([dx, dy]) => ({ x: Number(center.x) + dx, y: Number(center.y) + dy }))
    .filter(point => point.x > bounds.min_x + 0.25 && point.x < bounds.max_x - 0.25 && point.y > bounds.min_y + 0.25 && point.y < bounds.max_y - 0.25)
    .filter(point => !anchor || Math.hypot(point.x - anchor.x, point.y - anchor.y) >= 1.0);
  // Compact rooms may fit a safe horizontal placement while the diagonal
  // candidates do not. Keep the existing one-metre anchor clearance.
  if (!candidates.length && anchor) candidates = [[-1.1, 0], [1.1, 0], [0, -1.1], [0, 1.1]]
    .map(([dx, dy]) => ({ x: Number(center.x) + dx, y: Number(center.y) + dy }))
    .filter(point => point.x > bounds.min_x + 0.25 && point.x < bounds.max_x - 0.25 && point.y > bounds.min_y + 0.25 && point.y < bounds.max_y - 0.25)
    .filter(point => Math.hypot(point.x - anchor.x, point.y - anchor.y) >= 1.0);
  const point = candidates.length ? pick(random, candidates) : { x: Number(center.x), y: Number(center.y) };
  const jittered = { x: round(point.x + (random() - 0.5) * 0.18), y: round(point.y + (random() - 0.5) * 0.18) };
  const inside = jittered.x > bounds.min_x + 0.25 && jittered.x < bounds.max_x - 0.25 && jittered.y > bounds.min_y + 0.25 && jittered.y < bounds.max_y - 0.25;
  return inside && (!anchor || Math.hypot(jittered.x - anchor.x, jittered.y - anchor.y) >= 1.0) ? jittered : { x: round(point.x), y: round(point.y) };
}

export function scenarioForSeed(seedInput, { layout: requestedLayout } = {}) {
  const seed = hashSeed(seedInput ?? Math.floor(Math.random() * 0xffffffff));
  const random = rng(seed);
  const chosen = pick(random, LAYOUTS);
  const layout = requestedLayout || chosen;
  const registry = registryFor(layout);
  const rooms = (registry.locations || []).filter(item => item.type === 'room');
  if(requestedLayout && !rooms.length)throw Error('SELECTED_MAP_HAS_NO_ROOMS');
  const roomIds = requestedLayout ? rooms.map(item=>item.id) : rooms.length >= 3 ? rooms.map(item => item.id) : PERSON_ROOMS;
  const personRoom = pick(random, roomIds);
  const person = rooms.find(item => item.id === personRoom) || { pose: { x: 0, y: 0 } };
  const personPoint = safeRoomPose(person, random, person.pose);
  const personPose = {
    x: personPoint.x,
    y: personPoint.y,
    yaw: round((random() * 2 - 1) * Math.PI),
    frame_id: 'map',
  };
  const objectRooms = [...roomIds].sort(() => random() - 0.5).slice(0, 3);
  const objectPlacements = OBJECT_LABELS.map((label, index) => {
    const target = rooms.find(item => item.id === objectRooms[index % objectRooms.length]) || person;
    const point = safeRoomPose(target, random, target.pose);
    return { id: `${label}_${index + 1}`, label, room: target.id, x: point.x, y: point.y, yaw: round((random() * 2 - 1) * Math.PI), orientation: 'runtime physical placement' };
  });
  const selectedObstacle = pick(random, OBSTACLE_EVENTS);
  // Reviewed classic events have fixed coordinates. Do not spawn them into unrelated imported geometry.
  const obstacle = requestedLayout?.imported ? {type:'none',route:null,trigger:'disabled_for_imported_geometry'} : selectedObstacle;
  const activeChallenge = { initial_visibility: random() < 0.5 ? 'low_confidence' : 'sufficient', occlusion: round(0.1 + random() * 0.55), edge_fraction: round(random() * 0.35), range_m: round(1.2 + random() * 3.5) };
  const spec = {
    schema_version: 1,
    seed,
    layout_id: layout.id,
    generated_at: stamp(),
    layout: { id: layout.id, label: layout.label, world: layout.world, map: layout.map, registry: layout.registry, nav2: layout.nav2, bridge: layout.bridge, imported: Boolean(layout.imported), alternate_route: layout.alternate_route, ...(layout.localization === 'amcl' ? {localization:'amcl'} : {}) },
    robot_start: requestedLayout ? (registry.locations.find(x=>x.id==='Start')?.pose || { x:0,y:0,yaw:0,frame_id:'map' }) : { x: 0, y: 0, yaw: 0, frame_id: 'map' },
    semantic_locations: (registry.locations || []).map(item => ({ id: item.id, type: item.type, pose: item.pose, adjacency: item.adjacency })),
    person_target_room: personRoom,
    person_pose_orientation: personPose,
    object_placements: objectPlacements,
    hazard_placements: objectPlacements.filter(item => item.label === 'hazard_marker'),
    dynamic_obstacle_event: { type: obstacle.type, route: obstacle.route },
    dynamic_obstacle_trigger: { kind: obstacle.trigger, mission_observed_only: true },
    active_perception_challenge: activeChallenge,
    solvability_metadata: { start_reachable: 'requires solvability-gate', required_locations_reachable: 'requires solvability-gate', alternate_route_exists: layout.alternate_route, prechecked: false, validation_source: 'candidate template; runtime solvability-gate required before pool admission' },
    // This field is written for the scenario controller and post-run evaluator only.
    hidden_ground_truth: { person_target_room: personRoom, person_pose: personPose, object_placements: objectPlacements, dynamic_obstacle_event: obstacle, active_perception_challenge: activeChallenge },
  };
  return spec;
}

function publicSpec(spec) {
  const { hidden_ground_truth: _hidden, person_target_room: _person, person_pose_orientation: _pose, object_placements: _objects, hazard_placements: _hazards, dynamic_obstacle_event: _event, dynamic_obstacle_trigger: _trigger, active_perception_challenge: _challenge, ...safe } = spec;
  return { ...safe, observed_facts: [], hidden_ground_truth_leak: false, runtime_visibility: 'pre-run-safe-public-view' };
}

export function writeScenario(spec) {
  fs.mkdirSync(SCENARIO_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(PRIVATE_CURRENT), { recursive: true });
  // The controller/evaluator copy is deliberately separate from the public
  // selection.  Runtime consumers must opt into this path explicitly; the
  // Dashboard and Robot MCP only ever receive the public copy below.
  fs.writeFileSync(path.join(SCENARIO_DIR, `${spec.seed}.json`), JSON.stringify(spec, null, 2) + '\n');
  fs.writeFileSync(PRIVATE_CURRENT, JSON.stringify(spec, null, 2) + '\n');
  fs.writeFileSync(CURRENT, JSON.stringify(publicSpec(spec), null, 2) + '\n');
  const layout = spec.layout?.nav2 && spec.layout?.bridge ? spec.layout : template(spec.layout_id);
  for(const key of ['world','map','nav2','bridge','registry']){const p=path.resolve(ROOT,layout[key]);if(!p.startsWith(ROOT+path.sep))throw Error('SCENARIO_PATH_OUTSIDE_PROJECT');}
  if(!/^[A-Za-z0-9_-]+$/.test(spec.layout_id))throw Error('INVALID_SCENARIO_ID');
  const envLines = [
    `export SCENARIO_SEED=${spec.seed}`,
    `export SCENARIO_ID=${spec.layout_id}`,
    `export SCENARIO_WORLD=${layout.world}`,
    `export SCENARIO_MAP=${layout.map}`,
    `export SCENARIO_NAV2_PARAMS=${layout.nav2}`,
    `export SCENARIO_BRIDGE=${layout.bridge}`,
    `export SCENARIO_REGISTRY=${layout.registry}`,
    `export SCENARIO_WORLD_NAME=${spec.layout_id}`,
    `export SCENARIO_PRIVATE_FILE=${PRIVATE_CURRENT}`,
    'export SCENARIO_DYNAMIC_CONTROLLER=simulation/final_rescue/dynamic_scenario.py',
    'export IMPORTED_MAP_DIR='+(layout.imported ? path.dirname(path.resolve(ROOT,layout.world)) : ''),
    'export ENV_INTERACTION_REGISTRY='+(layout.imported ? path.join(path.dirname(path.resolve(ROOT,layout.world)),'interaction-registry.json') : ''),
    'export IMPORTED_MAP_SKELETON=',
    'export SCENARIO_MAP_ODOM_X='+(layout.imported ? spec.robot_start.x : 0),
    'export SCENARIO_MAP_ODOM_Y='+(layout.imported ? spec.robot_start.y : 0),
    'export SCENARIO_MAP_ODOM_YAW='+(layout.imported ? spec.robot_start.yaw : 0),
    'export SCENARIO_LOCALIZATION='+(layout.localization === 'amcl' ? 'amcl' : ''),
  ];
  fs.writeFileSync(RUNTIME_ENV, envLines.join('\n') + '\n');
  return spec;
}

export function currentScenario() {
  const value = readJson(CURRENT, null);
  if (!value || !('hidden_ground_truth' in value || 'person_target_room' in value || 'object_placements' in value)) return value;
  // One-time migration for older stable artifacts: preserve the controller
  // copy, then replace the public file in place so a stale file cannot leak via
  // a direct dashboard/static-file read.
  fs.mkdirSync(path.dirname(PRIVATE_CURRENT), { recursive: true });
  if (!fs.existsSync(PRIVATE_CURRENT)) fs.writeFileSync(PRIVATE_CURRENT, JSON.stringify(value, null, 2) + '\n');
  const safe = publicSpec(value); fs.writeFileSync(CURRENT, JSON.stringify(safe, null, 2) + '\n'); return safe;
}
export function privateScenario() { return readJson(PRIVATE_CURRENT, null); }
export function publicCurrentScenario() { return currentScenario(); }
export function layouts() { return LAYOUTS.map(item => ({ ...item, world: item.world, map: item.map, registry: item.registry })); }
export { publicSpec };

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = process.argv[2] ? Number(process.argv[2]) : undefined;
  const value = writeScenario(scenarioForSeed(seed));
  process.stdout.write(JSON.stringify(publicSpec(value)) + '\n');
}
