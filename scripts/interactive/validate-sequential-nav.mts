import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/sequential-nav-validation.json`;
const registry = `${ROOT}/simulation/scenarios/layout_b/world_registry.json`;
const tsx = `${ROOT}/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs`;
const server = `${ROOT}/services/robot-mcp/src/server.ts`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const distance = (state: any, target: any) => Math.hypot(state.position.x - target.x, state.position.y - target.y);
const targets: Record<string, { x: number; y: number }> = {
  Start: { x: 0, y: 0 }, Room_A: { x: 2.2, y: 1.1 }, Room_C: { x: 2, y: -4 },
};

const transport = new StdioClientTransport({
  command: `${ROOT}/tools/node/bin/node`,
  args: [tsx, server],
  cwd: ROOT,
  stderr: 'pipe',
  env: {
    ...process.env,
    ROBOT_GATEWAY: 'ros2',
    ROBOT_ROS2_ENV: 'final_rescue',
    ROBOT_WORLD_REGISTRY: registry,
    ROBOT_PERCEPTION: 'cv',
    ROBOT_TRACE_DIR: `${ROOT}/artifacts/indoor-rescue-upgrade/sequential-nav-trace`,
  },
});
const client = new Client({ name: 'nav2-sequential-real-validation', version: '1.0.0' }, { capabilities: {} });
const records: any[] = [];
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const reply: any = await client.callTool({ name, arguments: args });
  const value = reply.structuredContent ?? JSON.parse(reply.content.find((v: any) => v.type === 'text').text);
  records.push({ at: new Date().toISOString(), tool: name, input: args, result: value });
  return value;
};

let error: any = null;
try {
  await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade/sequential-nav-trace`, { recursive: true });
  await client.connect(transport);
  const tools: any = await client.listTools();
  const names = tools.tools.map((item: any) => item.name);
  if (names.length !== 8) throw new Error(`MCP_TOOL_COUNT:${names.length}`);
  let state: any = await call('get_robot_state');
  const initial = { location: state.current_location, pose: state.position };
  const steps = [
    ['Start_to_Room_C', 'Room_C'],
    ['Room_C_to_Room_A', 'Room_A'],
    ['Room_A_to_Start', 'Start'],
    ['Start_to_Room_C_again', 'Room_C'],
    ['Room_C_to_Start', 'Start'],
  ] as const;
  const navigation: any[] = [];
  const inspectIndex = 1;
  for (let i = 0; i < steps.length; i += 1) {
    const [label, location] = steps[i];
    const result: any = await call('navigate_to', { location });
    await sleep(250);
    state = await call('get_robot_state');
    navigation.push({ label, target: location, result, state, distance_to_target: distance(state, targets[location]) });
    if (i === inspectIndex) {
      const inspection: any = await call('inspect_room', { location: 'Room_A' });
      navigation[navigation.length - 1].inspection = inspection;
    }
  }
  const finalState = await call('get_robot_state');
  const active = records.filter(item => item.tool === 'get_robot_state' && item.result.navigation_status === 'EXECUTING');
  const failures = navigation.filter(item => item.result?.status !== 'SUCCEEDED' || item.distance_to_target > 0.35);
  const inspections = navigation.flatMap(item => item.inspection ? [item.inspection] : []);
  const inspectionFailures = inspections.filter(item => item.status !== 'SUCCEEDED');
  const payload = {
    generated_at: new Date().toISOString(),
    backend: 'real_ros2_robot_mcp',
    mcp_tools: names,
    mcp_tool_count: names.length,
    initial,
    navigation,
    inspections,
    final_state: finalState,
    active_goal_samples: active,
    failures,
    inspection_failures: inspectionFailures,
    pass: names.length === 8 && failures.length === 0 && inspectionFailures.length === 0 &&
      finalState.current_location === 'Start' && Math.hypot(finalState.position.x, finalState.position.y) <= 0.35,
    no_teleport: true,
    no_fake_navigation: true,
    validation_sequence_is_acceptance_only: true,
  };
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify({ pass: payload.pass, failures: failures.length, inspection_failures: inspectionFailures.length }));
} catch (caught: any) {
  error = { name: caught?.name, message: String(caught?.message ?? caught) };
  await writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), backend: 'real_ros2_robot_mcp', error, pass: false }, null, 2) + '\n');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
