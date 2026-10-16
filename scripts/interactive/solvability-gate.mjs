#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/interactive-live');
const REQUIRED = ['Start', 'Room_A', 'Room_B', 'Room_C'];
const FOOTPRINT_RADIUS_M = 0.4;
const SENSOR_CLEARANCE_M = 1.0;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readText(file) { return fs.readFileSync(file, 'utf8'); }
function projectFile(value) {
  const resolved = path.resolve(ROOT, value);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error('SCENARIO_PATH_OUTSIDE_PROJECT');
  return resolved;
}
function parseMapYaml(file) {
  const text = readText(file);
  const image = text.match(/^image:\s*(.+)$/m)?.[1]?.trim() || 'map.pgm';
  const resolution = Number(text.match(/^resolution:\s*([0-9.]+)/m)?.[1] || 0);
  const origin = [...(text.match(/^origin:\s*\[([^\]]+)\]/m)?.[1] || '').split(',')].map(Number);
  return { image: projectFile(path.join(path.dirname(file), image)), resolution, origin: origin.slice(0, 2) };
}
function parsePgm(file) {
  const raw = fs.readFileSync(file);
  let cursor = 0;
  const token = () => {
    while (cursor < raw.length && /\s/.test(String.fromCharCode(raw[cursor]))) cursor++;
    if (raw[cursor] === 35) { while (cursor < raw.length && raw[cursor] !== 10) cursor++; return token(); }
    const start = cursor; while (cursor < raw.length && !/\s/.test(String.fromCharCode(raw[cursor]))) cursor++;
    return raw.subarray(start, cursor).toString();
  };
  if (token() !== 'P5') throw new Error(`UNSUPPORTED_PGM:${file}`);
  const width = Number(token()); const height = Number(token()); const max = Number(token());
  if (!width || !height || max !== 255) throw new Error(`INVALID_PGM:${file}`);
  while (cursor < raw.length && /\s/.test(String.fromCharCode(raw[cursor]))) cursor++;
  const pixels = raw.subarray(cursor, cursor + width * height);
  if (pixels.length !== width * height) throw new Error(`TRUNCATED_PGM:${file}`);
  return { width, height, pixels };
}
function cellFor(point, map) {
  const [ox, oy] = map.origin;
  return { i: Math.round((Number(point.x) - ox) / map.resolution), j: map.height - 1 - Math.round((Number(point.y) - oy) / map.resolution) };
}
function inflateOccupied(map, radius) {
  const occupied = new Set();
  for (let j = 0; j < map.height; j++) for (let i = 0; i < map.width; i++) if (map.pixels[j * map.width + i] < 127) occupied.add(`${i},${j}`);
  const radiusCells = Math.ceil(radius / map.resolution);
  const inflated = new Set(occupied);
  for (const key of occupied) {
    const [i, j] = key.split(',').map(Number);
    for (let dj = -radiusCells; dj <= radiusCells; dj++) for (let di = -radiusCells; di <= radiusCells; di++) {
      if (di * di + dj * dj <= radiusCells * radiusCells) inflated.add(`${i + di},${j + dj}`);
    }
  }
  return { occupied, inflated };
}
function inside(map, cell) { return cell.i >= 0 && cell.j >= 0 && cell.i < map.width && cell.j < map.height; }
function nearestFree(start, free, map) {
  if (inside(map, start) && free.has(`${start.i},${start.j}`)) return { ...start, distance_cells: 0 };
  const queue = [{ ...start, distance_cells: 0 }]; const seen = new Set([`${start.i},${start.j}`]);
  while (queue.length) {
    const current = queue.shift();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { i: current.i + di, j: current.j + dj, distance_cells: current.distance_cells + 1 };
      const key = `${next.i},${next.j}`;
      if (seen.has(key) || !inside(map, next)) continue;
      if (free.has(key)) return next;
      seen.add(key); queue.push(next);
    }
  }
  return null;
}
function reachable(from, to, free, map) {
  const start = nearestFree(from, free, map); const goal = nearestFree(to, free, map);
  if (!start || !goal) return { pass: false, reason: 'NO_FREE_CELL_NEAR_ENDPOINT' };
  const queue = [{ i: start.i, j: start.j, distance: 0 }]; const seen = new Set([`${start.i},${start.j}`]);
  while (queue.length) {
    const current = queue.shift();
    if (current.i === goal.i && current.j === goal.j) return { pass: true, distance_cells: current.distance, start, goal };
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { i: current.i + di, j: current.j + dj, distance: current.distance + 1 };
      const key = `${next.i},${next.j}`;
      if (!inside(map, next) || seen.has(key) || !free.has(key)) continue;
      seen.add(key); queue.push(next);
    }
  }
  return { pass: false, reason: 'NO_INFLATED_GRID_PATH', start, goal };
}
function graphPaths(registry, source, target) {
  const graph = new Map((registry.locations || []).map(item => [item.id, item.adjacency || []]));
  const paths = [];
  function walk(node, pathNodes) {
    if (paths.length >= 3) return;
    if (node === target) { paths.push(pathNodes); return; }
    for (const next of graph.get(node) || []) if (!pathNodes.includes(next)) walk(next, [...pathNodes, next]);
  }
  walk(source, [source]);
  return paths;
}
function validateFiles(spec) {
  const layout = spec.layout || {};
  const world = projectFile(layout.world); const mapYamlFile = projectFile(layout.map); const registryFile = projectFile(layout.registry);
  const mapYaml = parseMapYaml(mapYamlFile); const pgm = parsePgm(mapYaml.image); const registry = readJson(registryFile, null);
  if (!registry) throw new Error('REGISTRY_READ_FAILED');
  const map = { ...pgm, resolution: mapYaml.resolution, origin: mapYaml.origin };
  const files = { world, map_yaml: mapYamlFile, map_pgm: mapYaml.image, registry: registryFile };
  const ids = new Set((registry.locations || []).map(item => item.id));
  const legacyRequired = REQUIRED.every(id => ids.has(id));
  const importedRequired = ['Start', ...(registry.locations || [])
    .filter(item => item.id !== 'Start' && !String(item.id).toLowerCase().includes('interaction'))
    .map(item => item.id)];
  const required = legacyRequired ? REQUIRED : [...new Set(importedRequired)];
  const registryAligned = required.length >= 2 && required.every(id => ids.has(id)) && (registry.frame_id || 'map') === 'map';
  const { occupied, inflated } = inflateOccupied(map, FOOTPRINT_RADIUS_M);
  const free = new Set();
  for (let j = 0; j < map.height; j++) for (let i = 0; i < map.width; i++) if (!inflated.has(`${i},${j}`)) free.add(`${i},${j}`);
  const locations = Object.fromEntries((registry.locations || []).map(item => [item.id, item]));
  const clearance = Object.fromEntries(required.map(id => {
    const item = locations[id]; const raw = item ? cellFor(item.pose, map) : null; const nearest = raw ? nearestFree(raw, free, map) : null;
    return [id, { pose: item?.pose || null, raw_cell: raw, free: Boolean(raw && free.has(`${raw.i},${raw.j}`)), nearest_free_cell: nearest, clearance_m: nearest ? nearest.distance_cells * map.resolution : 0 }];
  }));
  const paths = {};
  const targets = required.filter(id => id !== 'Start');
  for (const target of targets) paths[`Start->${target}`] = reachable(cellFor(locations.Start.pose, map), cellFor(locations[target].pose, map), free, map);
  const semanticAdjacency = required.every(id => (locations[id]?.adjacency || []).every(next => ids.has(next)));
  const alternateSource = legacyRequired ? 'Room_A' : (targets[0] || 'Start');
  const alternateTarget = legacyRequired ? 'Room_B' : (targets[1] || targets[0] || 'Start');
  const alternatePaths = graphPaths(registry, alternateSource, alternateTarget);
  const anchors = Object.fromEntries(required.map(id => [id, locations[id]?.pose]));
  const placements = [{ id: 'person', ...(spec.person_pose_orientation || {}) }, ...(spec.object_placements || [])].map(item => {
    const anchor = anchors[item.room] || anchors[spec.person_target_room];
    return { id: item.id, room: item.room || spec.person_target_room, point: { x: Number(item.x), y: Number(item.y) }, distance_to_semantic_pose: anchor ? Math.hypot(Number(item.x) - Number(anchor.x), Number(item.y) - Number(anchor.y)) : null };
  });
  const placementClearancePass = placements.every(item => item.distance_to_semantic_pose === null || item.distance_to_semantic_pose >= SENSOR_CLEARANCE_M);
  const staticPass = Boolean(fs.existsSync(world) && fs.existsSync(mapYamlFile) && fs.existsSync(mapYaml.image) && registryAligned && mapYaml.resolution > 0 && Object.values(clearance).every(item => item.free) && Object.values(paths).every(item => item.pass) && semanticAdjacency && alternatePaths.length >= 2 && placementClearancePass);
  return {
    pass: staticPass,
    source: 'project world/map/registry + inflated footprint grid; no hidden scenario fields used',
    files,
    map: { width: map.width, height: map.height, resolution: map.resolution, origin: map.origin, occupied_cells: occupied.size, inflated_cells: inflated.size, robot_radius_m: FOOTPRINT_RADIUS_M },
    registry: { frame_id: registry.frame_id || 'map', required_locations: required, aligned: registryAligned, semantic_adjacency: semanticAdjacency, alternate_graph_paths: alternatePaths },
    clearance,
    runtime_placement_clearance: { minimum_m: SENSOR_CLEARANCE_M, pass: placementClearancePass, placements },
    paths,
    checks: { map_load_pass: fs.existsSync(mapYaml.image), world_exists: fs.existsSync(world), semantic_registry_aligned: registryAligned, start_reachable: Object.values(paths).some(item => item.pass === true), required_locations_reachable: Object.values(paths).every(item => item.pass), alternate_route_exists: alternatePaths.length >= 2 },
    failure_reasons: [
      ...(fs.existsSync(world) ? [] : ['WORLD_MISSING']), ...(fs.existsSync(mapYaml.image) ? [] : ['MAP_IMAGE_MISSING']), ...(registryAligned ? [] : ['REGISTRY_MISMATCH']), ...(Object.values(clearance).every(item => item.free) ? [] : ['TARGET_FOOTPRINT_CLEARANCE']), ...(placementClearancePass ? [] : ['RUNTIME_PLACEMENT_NEAR_REQUIRED_POSE']), ...(Object.values(paths).every(item => item.pass) ? [] : ['STATIC_PATH_UNREACHABLE']), ...(semanticAdjacency ? [] : ['SEMANTIC_ADJACENCY_MISMATCH']), ...(alternatePaths.length >= 2 ? [] : ['ALTERNATE_ROUTE_MISSING']),
    ],
  };
}
function runtimeEvidence(spec) {
  const preflight = readJson(path.join(OUT, 'system-preflight.json'), readJson(path.join(OUT, 'preflight.json'), null));
  const stack = readJson(path.join(ROOT, 'artifacts/final_rescue/stack-status.json'), null);
  const current = readJson(path.join(OUT, 'current-scenario.json'), null);
  const same = current?.seed === spec.seed && current?.layout_id === spec.layout_id;
  const lifecycle = preflight?.nav2?.lifecycle || preflight?.lifecycle || stack?.lifecycle || {};
  const active = ['map_server', 'planner_server', 'controller_server', 'behavior_server', 'bt_navigator'].every(name => {
    const value = lifecycle[name];
    return value === 'active' || value?.state === 'ACTIVE' || value?.state === 'active';
  });
  const action = Boolean(preflight?.nav2?.navigate_action_server || preflight?.nav2?.action_server || preflight?.nav2?.navigate_to_pose || preflight?.nav2?.graph?.nav2_action_servers?.some?.(item => item[0] === '/navigate_to_pose') || stack?.graph?.nav2_action_servers?.some?.(item => item[0] === '/navigate_to_pose'));
  return { scenario_selected: same, preflight_pass: preflight?.pass === true, nav2_lifecycle_active: active, navigate_to_pose_available: action, source: preflight ? 'interactive preflight artifact' : 'no live preflight artifact' };
}
export function validateScenario(spec, { runtime = false } = {}) {
  const staticResult = validateFiles(spec);
  const runtimeResult = runtime ? runtimeEvidence(spec) : { checked: false, reason: 'runtime probe not requested' };
  const pass = staticResult.pass && (!runtime || (runtimeResult.scenario_selected && runtimeResult.preflight_pass && runtimeResult.nav2_lifecycle_active && runtimeResult.navigate_to_pose_available));
  return { schema_version: 1, generated_at: new Date().toISOString(), seed: spec.seed, layout_id: spec.layout_id, static: staticResult, runtime: runtimeResult, pass, status: pass ? 'SOLVABLE' : 'UNSOLVABLE', evidence_boundary: 'private controller-only placement clearance checked; hidden facts are not exposed to the agent or public API' };
}
export function validateCurrent({ runtime = true } = {}) {
  const spec = readJson(path.join(OUT, 'current-scenario.json'), null);
  if (!spec) return { pass: false, status: 'UNSOLVABLE', failure_reasons: ['CURRENT_SCENARIO_MISSING'] };
  return validateScenario(spec, { runtime });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateCurrent({ runtime: process.argv.includes('--runtime') });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'solvability-validation.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.pass ? 0 : 2;
}
