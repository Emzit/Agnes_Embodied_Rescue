import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/lotus-a-site-104-repro/direct-run`;
const node = `${ROOT}/tools/node/bin/node`;
const tsx = `${ROOT}/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs`;
const exec = promisify(execFile);
const { ROBOT_WAYPOINTS_FILE: _ignoredWaypoints, ...baseEnv } = process.env;
const env = {
  ...baseEnv,
  ROBOT_GATEWAY: 'ros2',
  ROBOT_ROS2_ENV: 'final_rescue',
  ROBOT_PERCEPTION: 'cv',
  ROBOT_TRACE_DIR: OUT,
  ROBOT_WORLD_REGISTRY: `${ROOT}/maps/imported/lotus_a_greybox/compiled/world_registry.json`,
  SCENARIO_WORLD_NAME: 'lotus_a_greybox',
  ENV_INTERACTION_REGISTRY: `${ROOT}/maps/imported/lotus_a_greybox/compiled/interaction-registry.json`,
  IMPORTED_MAP_DIR: `${ROOT}/maps/imported/lotus_a_greybox/compiled`,
  ROS_DOMAIN_ID: '106',
  RMW_IMPLEMENTATION: 'rmw_cyclonedds_cpp',
  GZ_PARTITION: 'agnes_final_rescue',
  GZ_SIM_RESOURCE_PATH: `${ROOT}/maps/imported/lotus_a_greybox/compiled`,
  CYCLONEDDS_URI: `file://${ROOT}/runtime/ros2-jazzy/cyclonedds.xml`,
  ROS_HOME: `${ROOT}/.final-rescue-home/.ros`,
  ROS_LOG_DIR: `${ROOT}/.final-rescue-home/logs/final_rescue/ros`,
};
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function ros(args: string[]) { try { const r = await exec(`${ROOT}/runtime/ros2-jazzy/.pixi/envs/default/bin/ros2`, args, { env, timeout: 10000 }); return `${r.stdout}\n${r.stderr}`.slice(-5000); } catch (e: any) { return String(e?.stdout || e?.message || e); } }
async function doorwayProbe(pose: any) {
  try {
    const r = await exec(`${ROOT}/runtime/ros2-jazzy/.pixi/envs/default/bin/python`,
      [`${ROOT}/scripts/interactive/lotus-doorway-probe.py`, String(pose?.x ?? 9.25), String(pose?.y ?? 2.5)],
      { env, timeout: 10000 });
    return JSON.parse(r.stdout.trim());
  } catch (e: any) { return { available: false, error: String(e?.stdout || e?.message || e) }; }
}
async function call(client: Client, name: string, args: any, trace: any[]) {
  const r: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 70000 });
  const value = r.structuredContent ?? JSON.parse(r.content.find((v: any) => v.type === 'text').text);
  trace.push({ at: new Date().toISOString(), tool: name, args, result: value });
  return value;
}
async function main() {
  await mkdir(OUT, { recursive: true });
  const robotTransport = new StdioClientTransport({ command: node, args: [tsx, `${ROOT}/services/robot-mcp/src/server.ts`], cwd: ROOT, env, stderr: 'pipe' });
  const doorTransport = new StdioClientTransport({ command: node, args: [tsx, `${ROOT}/services/environment-interaction-mcp/server.ts`], cwd: ROOT, env, stderr: 'pipe' });
  const robot = new Client({ name: 'lotus-a-site-104-repro', version: '1' }, { capabilities: {} });
  const door = new Client({ name: 'lotus-a-site-104-repro-door', version: '1' }, { capabilities: {} });
  const trace: any[] = [];
  try {
    await robot.connect(robotTransport); await door.connect(doorTransport);
    const names = (await robot.listTools()).tools.map((x: any) => x.name);
    const known = await call(robot, 'list_known_locations', {}, trace);
    const initial = await call(robot, 'get_robot_state', {}, trace);
    for (const location of ['A_Main', 'A_Tree', 'A_Link']) {
      if (location === 'A_Main' && initial.current_location === 'A_Main') continue;
      await call(robot, 'navigate_to', { location }, trace);
    }
    // The interaction contract requires a real navigation to the registered
    // door pose before inspection/opening; this is still a generic semantic
    // location, not a teleport or scripted pose injection.
    await call(robot, 'navigate_to', { location: 'D_A_Link_interaction' }, trace);
    const before = await call(robot, 'get_observation', {}, trace);
    const inspect = await call(door, 'inspect_door', { door_id: 'D_A_Link' }, trace);
    let open: any = null;
    if (inspect.status === 'SUCCEEDED' && inspect.runtime_state !== 'OPEN') open = await call(door, 'open_door', { door_id: 'D_A_Link' }, trace);
    await wait(2000);
    const afterDoor = await call(robot, 'get_observation', {}, trace);
    const stateBefore = await call(robot, 'get_robot_state', {}, trace);
    const doorwayCostmap = await doorwayProbe(afterDoor?.robot_pose);
    const pathReady = await ros(['action', 'list']);
    const lifecycle = await ros(['lifecycle', 'get', '/controller_server']);
    const path = await call(robot, 'navigate_to', { location: 'A_Site' }, trace);
    const stateAfter = await call(robot, 'get_robot_state', {}, trace);
    const world = await call(robot, 'get_world_state', {}, trace);
    const payload = { generated_at: new Date().toISOString(), run_id: 'lotus-a-site-104-direct-20261008', sequence: ['A_Main', 'A_Tree', 'A_Link', 'D_A_Link_interaction', 'inspect_door', 'open_door', 'wait_2s', 'A_Site'], mcp_tools: names, known, initial, before, inspect, open, afterDoor, stateBefore, doorwayCostmap, pathReady, lifecycle, path, stateAfter, world, trace, pass: path?.status === 'SUCCEEDED', primary_root_cause: path?.error_code === 104 ? 'NAVIGATION_SYSTEM_UNHEALTHY: see doorway pose/costmap and recovery health' : null, no_teleport: true, no_fake_success: true };
    await writeFile(`${OUT}/trace.json`, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify({ pass: payload.pass, status: path?.status, error_code: path?.error_code, reason: path?.reason }));
  } finally { await robot.close().catch(() => undefined); await door.close().catch(() => undefined); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
