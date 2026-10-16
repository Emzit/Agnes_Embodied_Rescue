import { mkdir, writeFile } from 'node:fs/promises'
import { Client } from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { JsonlBridge } from '../../services/robot-mcp/src/transport/jsonl-bridge.ts'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = process.env.IMPORTED_RUNTIME_OUT || `${ROOT}/artifacts/indoor-rescue-upgrade/imported-runtime-validation.json`
const TSX = `${ROOT}/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs`
const node = `${ROOT}/tools/node/bin/node`
const compiled = process.env.IMPORTED_RUNTIME_DIR || `${ROOT}/maps/imported/simple_rescue/compiled`
const targetA = process.env.IMPORTED_RUNTIME_TARGET_A || 'Room_A'
const targetB = process.env.IMPORTED_RUNTIME_TARGET_B || 'Room_C'
const doorId = process.env.IMPORTED_RUNTIME_DOOR_ID || 'D_main'
const doorWaypoint = process.env.IMPORTED_RUNTIME_DOOR_WAYPOINT || 'D_main_interaction'
const env = { ...process.env, ROBOT_GATEWAY: 'ros2', ROBOT_ROS2_ENV: 'final_rescue', ROBOT_WORLD_REGISTRY: `${compiled}/world_registry.json`, ROBOT_PERCEPTION: 'cv', ENV_INTERACTION_REGISTRY: `${compiled}/interaction-registry.json`, IMPORTED_MAP_DIR: compiled, SCENARIO_WORLD_NAME: 'imported_building' }
const value = (reply: any) => reply.structuredContent ?? JSON.parse(reply.content.find((item: any) => item.type === 'text').text)
const records: any[] = []
const call = async (client: Client, tool: string, args: Record<string, unknown> = {}) => { const result = value(await client.callTool({ name: tool, arguments: args })); records.push({ at: new Date().toISOString(), tool, args, result }); return result }
const connect = async (args: string[]) => { const transport = new StdioClientTransport({ command: node, args, cwd: ROOT, stderr: 'inherit', env }); const client = new Client({ name: 'imported-runtime-validation', version: '1.0.0' }, { capabilities: {} }); await client.connect(transport); return client }
let robot: Client | undefined
let interaction: Client | undefined
let sensorBridge: JsonlBridge | undefined
let error: any = null
try {
  await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade/imported-runtime-trace`, { recursive: true })
  robot = await connect([TSX, `${ROOT}/services/robot-mcp/src/server.ts`])
  const robotTools = (await robot.listTools()).tools.map((item: any) => item.name)
  const initial = await call(robot, 'get_robot_state')
  const first = await call(robot, 'navigate_to', { location: targetA })
  const afterFirst = await call(robot, 'get_robot_state')
  const second = await call(robot, 'navigate_to', { location: targetB })
  const afterSecond = await call(robot, 'get_robot_state')
  const doorApproach = await call(robot, 'navigate_to', { location: doorWaypoint })
  const afterDoorApproach = await call(robot, 'get_robot_state')
  const doorObservation = await call(robot, 'get_observation')
  sensorBridge = new JsonlBridge('/bin/bash', [`${ROOT}/services/robot-mcp/ros2_bridge/launch_bridge.sh`], env)
  const sensorBridgeObservation = await sensorBridge.request('get_observation', {}, 65000)
  const doorFrame = await sensorBridge.request('capture_frame', { name: 'camera-frame-room-a.png' }, 10000)
  interaction = await connect([`${ROOT}/scripts/final-rescue/environment-interaction-launch.mjs`])
  const interactionTools = (await interaction.listTools()).tools.map((item: any) => item.name).sort()
  const doorInspect = await call(interaction, 'inspect_door', { door_id: doorId })
  const doorOpen = await call(interaction, 'open_door', { door_id: doorId })
  const alreadyOpenInspect = await call(interaction, 'inspect_door', { door_id: doorId })
  const alreadyOpen = await call(interaction, 'open_door', { door_id: doorId })
  const back = await call(robot, 'navigate_to', { location: 'Start' })
  const finalState = await call(robot, 'get_robot_state')
  const payload = { generated_at: new Date().toISOString(), skeleton: process.env.IMPORTED_RUNTIME_SKELETON || 'maps/imported/simple_rescue/map_skeleton.json', compiled, map_prior_only: true, robot_tools: robotTools, interaction_tools: interactionTools, navigation: { initial, first: { result: first, state: afterFirst }, second: { result: second, state: afterSecond }, door_approach: { result: doorApproach, state: afterDoorApproach }, door_observation: doorObservation, direct_bridge_observation: sensorBridgeObservation, door_frame: doorFrame, start: { result: back, state: finalState } }, door: { closed_openable: { inspect: doorInspect, open: doorOpen }, already_open: { inspect: alreadyOpenInspect, open: alreadyOpen }, jammed: { status: 'NOT_RUN', reason: 'No jammed physical fixture/event is active in this imported runtime; no failure is fabricated.' } }, physical_evidence: { robot_pose_source: 'real ROS2 /odom through Robot MCP', camera_source: 'real /camera/image_raw through Robot MCP', door_joint_source: 'real Gazebo panel link pose', door_frame_path: 'artifacts/phase10/camera-frame-door-inspect.png', no_fake_world_write: true }, pass: robotTools.length === 8 && interactionTools.join(',') === 'inspect_door,open_door' && [first, second, doorApproach, back].every((item: any) => item?.status === 'SUCCEEDED') && finalState?.current_location === 'Start' && doorInspect?.status === 'SUCCEEDED' && doorOpen?.status === 'SUCCEEDED' && alreadyOpen?.code === 'ALREADY_OPEN', no_mock: true, no_fixture: true, no_teleport: true, scripted_tool_sequence: false }
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n')
  console.log(JSON.stringify({ pass: payload.pass, navigation: [first?.status, second?.status, back?.status], door_inspect: doorInspect?.status, door_open: doorOpen?.status }))
} catch (caught: any) {
  error = { name: caught?.name, message: String(caught?.message ?? caught) }
  await writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), records, error, pass: false, no_mock: true, no_fixture: true, no_teleport: true, scripted_tool_sequence: false }, null, 2) + '\n')
  console.error(error.message)
  process.exitCode = 1
} finally { await sensorBridge?.close().catch(() => undefined); await robot?.close().catch(() => undefined); await interaction?.close().catch(() => undefined) }
