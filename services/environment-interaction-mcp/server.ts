import { Server } from "../robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "../robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "../robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";
import { z } from "../robot-mcp/node_modules/zod/index.js";
import { appendFileSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JsonlBridge } from "../robot-mcp/src/transport/jsonl-bridge.ts";
import { doorState, nearDoor, visibleAgnesDoors, doorInspectionFailure, FULLY_OPEN_ANGLE } from "./door-policy.ts";
import { environmentToolResult } from "./tool-result.ts";
import { readInteractionMap } from "./interaction-map.ts";
import { animateDoorOpening } from "./door-actuation.ts";
import { createGazeboDoorDriver } from "./door-transport.ts";
import { freshStoppedDoorSample, postDoorReads, cameraAfterDoorStop } from "./door-verification.ts";

const exec = promisify(execFile);
const ROOT = "/data-ssd/zhongchengkai/agnes";
const GZ = `${ROOT}/runtime/ros2-jazzy/.pixi/envs/default/bin/gz`;
const registryPath = process.env.ENV_INTERACTION_REGISTRY || (process.env.IMPORTED_MAP_DIR ? `${process.env.IMPORTED_MAP_DIR}/interaction-registry.json` : "");
const configuredWorld = process.env.SCENARIO_WORLD_NAME || "imported_building";
const bridge = new JsonlBridge("/bin/bash", [`${ROOT}/services/robot-mcp/ros2_bridge/launch_bridge.sh`]);
const observed = new Map<string, { at: string; pose: any; evidence: any }>();
const trace = (event: any) => { if (process.env.ROBOT_TRACE_DIR) appendFileSync(`${process.env.ROBOT_TRACE_DIR}/environment-events.jsonl`, JSON.stringify({ time: Date.now(), ...event }) + "\n"); };
function doors() { try { return JSON.parse(readFileSync(registryPath, "utf8")).doors || []; } catch { return []; } }
function door(id: string) { return doors().find((x: any) => x.id === id); }
function unknownDoor(id: string) {
  return { status: "FAILED", code: "UNKNOWN_DOOR", door_id: id,
    available_doors: doors().map((d: any) => ({ id: d.id, connects: d.connects, interaction_location: d.id + "_interaction" })),
    recovery: "Call get_map and select a current door ID; do not guess or reuse an old map ID." };
}
function getMap() {
  try { return readInteractionMap(registryPath, process.env.ROBOT_WORLD_REGISTRY, configuredWorld); }
  catch (error: any) { return { status: "FAILED", code: "MAP_PRIOR_UNAVAILABLE", message: String(error?.message || error) }; }
}
async function inspectDoor(id: string) {
  const d = door(id); if (!d) return unknownDoor(id);
  const started = Date.now();
  const state = await bridge.request("get_robot_state", {}, 10000);
  // Reject an unconfirmed approach before paying for image inference.
  if (!nearDoor(state.pose, d)) {
    observed.delete(id);
    const result = { status: "FAILED", code: "DOOR_OUT_OF_REACH", door_id: id,
      runtime_state: "UNKNOWN", robot_pose: state.pose, camera_observation: [],
      recovery: "Finish navigation to the current door interaction_location before inspect_door." };
    trace({ tool: "inspect_door", input: { door_id: id }, result }); return result;
  }
  // Every positive observation must come from Agnes vision on a real current
  // camera frame. Orange flames must never become door evidence through the
  // former demo-color fallback.
  const inspectStarted = Date.now();
  const [observation, panel]: any[] = await Promise.all([
    bridge.request("get_observation", { focus: "door" }, 65000), linkPose(id),
  ]);
  const currentState = await bridge.request("get_robot_state", {}, 10000);
  const pose = currentState.pose || observation.robot_pose || state.pose;
  const visual = visibleAgnesDoors(observation);
  const near = nearDoor(pose, d);
  const runtimeState = doorState(d, panel);
  const failure = doorInspectionFailure(observation, near, runtimeState);
  const result = {
    status: failure ? "FAILED" : "SUCCEEDED", ...(failure ? { code: failure } : {}),
    door_id: id, runtime_state: failure ? "UNKNOWN" : runtimeState,
    robot_pose: pose, interaction_pose: d.interaction_pose || null,
    camera_observation: visual,
    _camera_image: observation._camera_image,
    camera: observation.camera,
    perception: { status: observation.perception_status, focus: "door",
      error: observation.perception_error || null, error_stage: observation.perception_error_stage || null },
    evidence: { source: "real Camera observation + Agnes VLM + ROS2 pose + Gazebo panel pose",
      frame_hashes: visual.map((x: any) => x.evidence?.frame_sha256).filter(Boolean),
      frame_timestamp: observation.vision_observation?.frame_timestamp,
      frame_pose: observation.robot_pose, observed_at: new Date().toISOString(),
      near_interaction_pose: near, panel_pose: panel },
    map_prior: { exists: true, connects: d.connects },
    timings_ms: { approach_check: inspectStarted - started, camera_and_panel: Date.now() - inspectStarted,
      total: Date.now() - started },
    ...(failure ? { recovery: failure === "DOOR_PERCEPTION_UNAVAILABLE"
      ? "Agnes image perception failed; retry inspect_door. Do not infer door visibility from the map."
      : failure === "DOOR_NOT_VISUALLY_OBSERVED"
      ? "Camera and Agnes inference succeeded but no door was visually supported. Adjust the view through an approved robot action, then retry inspect_door."
      : "Check the indicated sensor, approach pose or Gazebo panel before retrying." } : {}),
  };
  if (result.status === "SUCCEEDED") observed.set(id, { at: result.evidence.observed_at, pose, evidence: result });
  else observed.delete(id);
  trace({ tool: "inspect_door", input: { door_id: id }, result }); return result;
}
async function linkPose(id: string) {
  try {
    const r = await exec(GZ, ["model", "-m", `door_${id}`, "-l", "panel"], { timeout: 5000 });
    const text = `${r.stdout}\n${r.stderr}`;
    const matches = [...text.matchAll(/\[\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\]\s*$/gm)];
    const last = matches.at(-1);
    return { raw: text.slice(-2000), yaw_rad: last ? Number(last[3]) : null };
  } catch (error: any) { return { raw: String(error?.stdout || error?.message || error), yaw_rad: null }; }
}
async function openDoor(id: string) {
  const prior = observed.get(id); const d = door(id); if (!d) return unknownDoor(id);
  if (!prior) return { status: "FAILED", code: "DOOR_NOT_VISUALLY_OBSERVED", door_id: id, runtime_state: "UNKNOWN" };
  const started = Date.now();
  const currentState = await bridge.request("get_robot_state", {}, 10000);
  if (!nearDoor(currentState.pose, d)) return { status: "FAILED", code: "DOOR_OUT_OF_REACH", door_id: id, runtime_state: "UNKNOWN" };
  if (Date.now() - Date.parse(prior.at) > 120000) return { status: "FAILED", code: "DOOR_OBSERVATION_EXPIRED", door_id: id, runtime_state: "UNKNOWN" };
  const currentPanel = await linkPose(id);
  if (doorState(d, currentPanel) === "UNKNOWN") return { status: "FAILED", code: "PANEL_POSE_UNAVAILABLE", door_id: id, runtime_state: "UNKNOWN" };
  if (doorState(d, currentPanel) === "OPEN") {
    const result = { status: "SUCCEEDED", code: "ALREADY_OPEN", door_id: id, runtime_state: "OPEN", command: null,
      verification: { source: "prior Agnes Camera observation + fresh Gazebo panel pose", panel_pose: currentPanel, observed_at: new Date().toISOString() }, no_fake_world_write: true };
    trace({ tool: "open_door", input: { door_id: id }, result }); return result;
  }
  const joint = `${id}_hinge`;
  const beforeLinkPose = currentPanel;
  const timings: Record<string, number> = { preparation: Date.now() - started };
  const animationStarted = Date.now();
  const velocityTopic = `/model/door_${id}/joint/${joint}/cmd_vel`;
  // Drive real articulated parts through one transport process. Each phase
  // follows measured joint angles; the hinge is never commanded closed.
  let animation: any;
  let stoppedSample: any = null;
  let driver: Awaited<ReturnType<typeof createGazeboDoorDriver>> | null = null;
  try {
    driver = await createGazeboDoorDriver(id);
    animation = await animateDoorOpening(driver);
    timings.animation = Date.now() - animationStarted;
    const stopStarted = Date.now();
    if (!animation.command?.code && !animation.stop?.code)
      stoppedSample = await freshStoppedDoorSample(driver, animation.final_sample);
    timings.stopped_sample = Date.now() - stopStarted;
  } catch (error: any) {
    animation = { command: { code: 1, stderr: String(error?.message || error) }, stop: { code: 1, stderr: "Transport unavailable; cleanup attempted" }, stages: [] };
  } finally {
    if (driver) await driver.close();
  }
  const { command, stop } = animation;
  // The subscribed /model/door_<id>/joint_state is the same real telemetry
  // driving the animation. The former /world/.../joint/.../state endpoint did
  // not exist and cost a fixed five-second timeout on every opening.
  const verification = { topic: `/model/door_${id}/joint_state`, angle_rad: stoppedSample?.hinge_angle ?? null,
    stopped_sample: stoppedSample, source: "fresh measured Gazebo joint telemetry after both zero commands" };
  const readsStarted = Date.now();
  const { panel: afterLinkPose, camera: after } = await postDoorReads(
    async () => {
      const t = Date.now(); const value = await linkPose(id); timings.post_panel = Date.now() - t; return value;
    },
    async () => {
      const t = Date.now();
      const value = await bridge.request("get_observation", {}, 65000).catch((error: any) => ({ status: "FAILED", error: String(error?.message || error) }));
      timings.post_camera_vlm = Date.now() - t; return value;
    },
  );
  const cameraAfterMotion = Boolean(cameraAfterDoorStop(after, stoppedSample));
  // A delayed camera subscriber may still expose pre-motion pixels. Preserve
  // them in the raw trace but never authorize a post-door semantic conclusion.
  if (!cameraAfterMotion && after?.perception_status === "AVAILABLE") {
    after.perception_status = "POST_MOTION_FRAME_UNVERIFIED";
    after.perception_error = "CAMERA_FRAME_NOT_AFTER_MEASURED_STOP";
    after.perception_error_stage = "POST_MOTION_FRESHNESS";
  }
  timings.post_reads = Date.now() - readsStarted;
  timings.total = Date.now() - started;
  const jointOpened = Number.isFinite(verification.angle_rad) && verification.angle_rad >= FULLY_OPEN_ANGLE;
  const poseOpened = doorState(d, afterLinkPose) === "OPEN";
  const stopConfirmed = stop !== null && !stop.code;
  const moved = jointOpened && poseOpened && stopConfirmed && !command?.code;
  const result = { status: moved ? "SUCCEEDED" : "FAILED", code: moved ? "DOOR_OPEN_VERIFIED" : "DOOR_JAMMED_OR_UNAVAILABLE", door_id: id, runtime_state: moved ? "OPEN" : "UNKNOWN", command: { topic: velocityTopic, max_velocity_rad_s: 1.0, animation_profile: animation.profile, animation_stages: animation.stages, auto_close: false, returncode: command?.code || 0, stdout: String(command?.stdout || "").slice(-1000), stderr: String(command?.stderr || "").slice(-1000), stop_returncode: stop?.code || 0, stop_stderr: String(stop?.stderr || "").slice(-1000) }, verification: { joint_state: verification, measured_animation_final: stoppedSample, animation_last_sample: animation.final_sample, camera_after_motion: cameraAfterMotion, panel_link_pose_before: beforeLinkPose, panel_link_pose_after: afterLinkPose, fresh_camera_observation: after, source: "real Gazebo stopped joint/panel pose + post-motion Camera observation", observed_at: new Date().toISOString() }, no_fake_world_write: true, timings_ms: timings };
  if (!moved) result.runtime_state = "UNKNOWN";
  trace({ tool: "open_door", input: { door_id: id }, result }); return result;
}
const server = new Server({ name: "environment-interaction-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
const empty = z.object({}).strict(); const doorInput = z.object({ door_id: z.string().min(1) }).strict();
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "get_map", description: "Read the active map locations, door IDs, room connections and registered door approach waypoints. ALWAYS call this before a door task; IDs from earlier maps are invalid. The map is only a prior, not visual evidence of door state.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "inspect_door", description: "After get_map and confirmed arrival at the selected door interaction_location, inspect that current door using a real current Camera frame and focused Agnes door vision, including transparent glass doors. Returns separate camera, perception and no-visible-door errors. Never guess door IDs.", annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, inputSchema: { type: "object", properties: { door_id: { type: "string", enum: doors().map((d: any) => d.id) } }, required: ["door_id"], additionalProperties: false } },
  { name: "open_door", description: "Open the current-map door only AFTER navigate_to interaction_location has finished and inspect_door succeeded. Never parallelize these dependent steps; use the ID returned by get_map and leave it open. The result includes one general Agnes observation after the measured zero-speed opening; use verification.fresh_camera_observation directly to assess the visible room when its perception_status is AVAILABLE and camera_after_motion is true. Do not immediately repeat get_world_state for the same unchanged view; request a new observation after further motion or on unavailable post-motion evidence.", inputSchema: { type: "object", properties: { door_id: { type: "string", enum: doors().map((d: any) => d.id) } }, required: ["door_id"], additionalProperties: false } },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const name = request.params.name; let input: any;
  try { input = (name === "get_map" ? empty : doorInput).parse(request.params.arguments || {}); } catch (error: any) { throw new McpError(ErrorCode.InvalidParams, error.message); }
  const result = name === "get_map" ? getMap() : name === "inspect_door" ? await inspectDoor(input.door_id) : name === "open_door" ? await openDoor(input.door_id) : null;
  if (!result) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  return environmentToolResult(result);
});
process.on("SIGTERM", () => { bridge.close().finally(() => process.exit(0)); });
process.on("SIGINT", () => { bridge.close().finally(() => process.exit(0)); });
await server.connect(new StdioServerTransport());
