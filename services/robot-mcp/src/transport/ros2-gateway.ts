import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BridgeError, JsonlBridge } from "./jsonl-bridge.ts";
import type { Ros2SensorObservation } from "./sensor-observation.ts";
import { WorldRegistry } from "./world-registry.ts";
import { RuntimeWorldState } from "./runtime-world-state.ts";
import { compactRobotToolResult } from "./tool-result.ts";
import { nav2TerminalDetails, normalizeNavigationTerminalResult } from "./navigation-result.ts";

export type Ros2PoseGoal = { x: number; y: number; yaw?: number; frame_id?: string };
// Managed MCP clients have a 60 s request deadline.  Production therefore
// waits briefly for the real terminal result on short routes, then observes
// longer routes via get_robot_state; the ROS action keeps a separate budget.
const DEFAULT_NAVIGATION_RPC_BUDGET_MS = 180_000;
const RECOVERY_BUDGET_MS = 15_000;
const MIN_RETRY_ACTION_BUDGET_MS = 10_000;
const RPC_SAFETY_MARGIN_MS = 2_000;
const DEFAULT_NAVIGATION_ACTION_BUDGET_SEC = 180;
const DEFAULT_ASYNC_CONFIRMATION_MS = 20_000;
const navigationRpcBudgetMs = () => {
  const configured = Number(process.env.ROBOT_NAVIGATION_RPC_BUDGET_MS ?? DEFAULT_NAVIGATION_RPC_BUDGET_MS);
  return Number.isFinite(configured) ? Math.max(20_000, Math.min(900_000, configured)) : DEFAULT_NAVIGATION_RPC_BUDGET_MS;
};
const navigationActionBudgetSec = () => {
  const configured = Number(process.env.ROBOT_NAVIGATION_ACTION_BUDGET_SEC ?? DEFAULT_NAVIGATION_ACTION_BUDGET_SEC);
  return Number.isFinite(configured) ? Math.max(10, Math.min(900, configured)) : DEFAULT_NAVIGATION_ACTION_BUDGET_SEC;
};
const asyncNavigation = () => process.env.ROBOT_NAVIGATION_ASYNC === "1";
const asyncConfirmationMs = () => {
  const configured = Number(process.env.ROBOT_NAVIGATION_CONFIRMATION_MS ?? DEFAULT_ASYNC_CONFIRMATION_MS);
  return Number.isFinite(configured) ? Math.max(2_000, Math.min(30_000, configured)) : DEFAULT_ASYNC_CONFIRMATION_MS;
};
export function navigationRetryWithinBudget(startedAt: number, now: number, budgetMs = navigationRpcBudgetMs()): boolean {
  return now - startedAt + RECOVERY_BUDGET_MS + MIN_RETRY_ACTION_BUDGET_MS + RPC_SAFETY_MARGIN_MS < budgetMs;
}
const MISSION_ORIGIN_ALIAS = "__MISSION_ORIGIN__";
const MISSION_ORIGIN_PREFIX = `${MISSION_ORIGIN_ALIAS}:`;
const missionOriginFile = () => process.env.ROBOT_MISSION_ORIGIN_FILE ??
  `${process.env.FINAL_ROOT ?? "/data-ssd/zhongchengkai/agnes"}/runtime/interactive-mission-origin.json`;
function readMissionOrigin(alias: string): Ros2PoseGoal | null {
  try {
    const missionToken = alias.startsWith(MISSION_ORIGIN_PREFIX) ? alias.slice(MISSION_ORIGIN_PREFIX.length) : null;
    if (missionToken && !/^[A-Za-z0-9_-]+$/.test(missionToken)) return null;
    const value = JSON.parse(readFileSync(missionOriginFile(), "utf8"));
    if (value?.state !== "captured") return null;
    if (missionToken && String(value?.mission_id ?? '').replace(/[^A-Za-z0-9_-]/g, '_') !== missionToken) return null;
    const pose = value?.pose;
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return null;
    return { x: Number(pose.x), y: Number(pose.y), yaw: Number.isFinite(pose.yaw) ? Number(pose.yaw) : 0,
      frame_id: typeof pose.frame_id === "string" ? pose.frame_id : "map" };
  } catch { return null; }
}
const failed=(error:unknown)=>{
  const code=error instanceof BridgeError?error.code:"ROS2_INSPECTION_ERROR";
  const reason=code === "MOTION_CONTROL_BUSY" ? "MOTION_CONTROL_BUSY" :
    code === "INSPECTION_BUSY" ? "INSPECTION_BUSY" :
    code === "ROBOT_STOPPED" ? "ROBOT_STOPPED" : "UNAVAILABLE";
  return {ok:false,status:"FAILED",code,reason};
};

/** Asynchronous ROS2 backend; the MCP wire names and input schemas stay unchanged. */
export class Ros2RobotGateway {
  readonly bridge: JsonlBridge;
  readonly registry: WorldRegistry;
  readonly runtime = new RuntimeWorldState();
  private recordedInspectionId: string | null = null;
  constructor(options: { waypoints?: Record<string, Ros2PoseGoal>; registry?: WorldRegistry; bridge?: JsonlBridge } = {}) {
    if(process.env.ROBOT_WORLD_REGISTRY && process.env.ROBOT_WAYPOINTS_FILE && !options.registry && !options.waypoints)
      throw new Error("AMBIGUOUS_COORDINATE_SOURCE");
    this.registry = options.registry ?? (options.waypoints ? WorldRegistry.historicalWaypoints(options.waypoints)
      : process.env.ROBOT_WORLD_REGISTRY ? WorldRegistry.load(process.env.ROBOT_WORLD_REGISTRY)
      : process.env.ROBOT_WAYPOINTS_FILE ? WorldRegistry.historicalWaypoints(JSON.parse(readFileSync(process.env.ROBOT_WAYPOINTS_FILE,"utf8")))
      : WorldRegistry.load(fileURLToPath(new URL("../../../../simulation/phase9f/world_registry.json",import.meta.url))));
    this.bridge = options.bridge ?? new JsonlBridge("/bin/bash", [
      fileURLToPath(new URL("../../ros2_bridge/launch_bridge.sh", import.meta.url)),
    ]);
    this.bridge.onEvent?.(event => {
      const updatedAt=this.runtime.recordPathConflict(event);
      // The exact old goal is canceled only after this live, externally
      // readable world model has accepted the onboard evidence.
      void this.bridge.request("ack_world_update", {goal_id:event.goal_id,
        gateway_updated_at:updatedAt,
        world_model_entry:this.runtime.snapshot().blocked_routes.at(-1)}, 10000).catch(error =>
          process.stderr.write(`Onboard world update acknowledgement failed: ${String(error)}\n`));
    });
  }
  async getState() {
    const state = await this.bridge.request("get_robot_state", {}, 10000);
    this.runtime.observePose(state.pose);
    const navigation = await this.bridge.request("navigation_status", {}, 5000).catch(() => null);
    if (navigation) {
      this.runtime.updateNavigation(navigation);
      const owner = navigation.operation ?? navigation.last_terminal ?? null;
      const details = nav2TerminalDetails(owner?.terminal_status ?? navigation.status,
        owner?.error_code, owner?.error_msg ?? owner?.error_message, owner?.reason);
      const inspection = navigation.inspection ?? null;
      if (inspection?.terminal_known === true && inspection.result &&
          inspection.inspection_id !== this.recordedInspectionId) {
        const region = this.registry.find(inspection.location);
        if (region) this.runtime.recordInspection({...inspection.result,
          inspected: region.type === "room" && inspection.result.inspected === true}, region.id);
        this.recordedInspectionId = inspection.inspection_id;
      }
      // Full scan evidence remains in bridge/tool traces. Bound the polling
      // response just like inspect_room so native Harness capture stays valid.
      const scan = inspection ? {...inspection, result: inspection.result
        ? compactRobotToolResult("inspect_room", inspection.result) : null} : null;
      return {...state, current_location:this.registry.locate(state.pose),
        navigation_status: navigation.status ?? state.navigation_status,
        navigation_active: navigation.active === true,
        navigation_operation_id: owner?.operation_id ?? null,
        navigation_goal_id: owner?.goal_id ?? null,
        navigation_terminal_known: navigation.terminal_known === true,
        navigation_terminal_status: owner?.terminal_status ?? (navigation.terminal_known ? navigation.status : null),
        navigation_error_code: details.error_code,
        navigation_error_message: details.error_msg,
        navigation_reason: details.reason ?? null,
        motion_owner: navigation.motion_owner ?? null,
        inspection_active: navigation.inspection_active === true, inspection: scan};
    }
    return {...state,current_location:this.registry.locate(state.pose)};
  }
  async getWorldState() {
    const robot = await this.getState();
    const observation: any = await this.getObservation();
    const locations = this.registry.list();
    return {source:"ros2_gazebo_world_model",robot:{...robot,pose:observation.robot_pose},
      current_location:this.registry.locate(observation.robot_pose),known_locations:locations,
      locations:locations.map(l=>({name:l.name,kind:l.kind,traversable:true,source:"static_map_only"})),
      routes:locations.flatMap(l=>l.adjacency.map(to=>({from:l.id,to,status:"OPEN",source:"static_map_only",dynamic_status:"UNKNOWN"}))),
      ...this.runtime.snapshot(),sensor_status:{lidar:observation.lidar.available,camera:observation.camera.available},
      lidar_obstacle_summary:observation.lidar,camera_status:observation.camera,
      current_observation:{
        timestamp:observation.camera?.frame_timestamp??observation.vision_observation?.frame_timestamp??null,
        frame_sha256:observation.vision_observation?.frame_sha256??observation.camera?.png_sha256??null,
        perception_status:observation.perception_status,
        perception_error:observation.perception_error??null,
        perception_error_stage:observation.perception_error_stage??null,
        semantic_objects:observation.semantic_objects??[],
      },
      semantic_objects:this.runtime.snapshot().observed_objects,inspected_regions:this.runtime.snapshot().inspected_rooms};
  }
  async getObservation(_input?: unknown): Promise<Ros2SensorObservation> {
    // Object filtering is not semantic perception: never synthesize object labels.
    const observation = await this.bridge.request("get_observation", {}, 65000);
    this.runtime.observe(observation.robot_pose, observation.timestamp);
    this.runtime.recordDetections(observation.semantic_objects??[],this.registry.locate(observation.robot_pose));
    return observation;
  }
  async inspectRoom(location: string) {
    const region=this.registry.find(location);
    if(!region)return {ok:false,status:"FAILED",room:location,code:"INVALID_LOCATION",reason:"INVALID_LOCATION"};
    location=region.id;
    try {
      const state=await this.getState();
      // Bounded rooms/corridors retain the exact region check. A named
      // waypoint such as Start may lie inside a corridor's bounds, so only
      // for unbounded waypoints accept its measured 0.35 m neighborhood.
      const atWaypoint = !region.bounds && state.pose?.frame_id === "map" &&
        Number.isFinite(state.pose?.x) && Number.isFinite(state.pose?.y) &&
        Math.hypot(state.pose.x-region.pose.x,state.pose.y-region.pose.y)<=0.35;
      if(state.current_location!==location && !atWaypoint)
        return {ok:false,status:"FAILED",room:location,code:"NOT_AT_LOCATION",reason:"NOT_AT_LOCATION"};
      if(state.navigation_active || ["ACCEPTED","EXECUTING","CANCELING","RUNNING"].includes(state.navigation_status) || state.motion_owner || state.inspection_active)
        return {ok:false,status:"FAILED",room:location,code:"MOTION_CONTROL_BUSY",reason:"MOTION_CONTROL_BUSY",
          inspection_id:state.inspection?.inspection_id??null,poll_via:"get_robot_state"};
      const result=await this.bridge.request("inspect_room",{
        room:location,region_type:region.type,async:true,expected_pose:{x:state.pose.x,y:state.pose.y},
      },10000);
      return {...result,region_type:region.type};
    }catch(error){return {...failed(error),room:location};}
  }
  async inspectObject(objectId: string) {
    try {
      const result=await this.bridge.request("inspect_object",{object_id:objectId},180000);
      this.runtime.recordInspection(result,this.registry.locate((await this.getState()).pose));return result;
    }catch(error){return {...failed(error),object_id:objectId};}
  }
  listKnownLocations() { return this.registry.list(); }
  async navigateTo(location: string, recoveryAttempted = false) {
    const startedAt = Date.now();
    const rpcBudgetMs = navigationRpcBudgetMs();
    const remainingRequestMs = () => Math.max(1_000, rpcBudgetMs - (Date.now() - startedAt) - RPC_SAFETY_MARGIN_MS);
    const requestedLocation = location;
    location = this.registry.find(location)?.id ?? location;
    const id=this.runtime.begin(location);
    // Keep the fixed navigate_to schema and eight-tool contract.  This
    // mission-scoped alias is resolved from a real get_robot_state sample
    // captured after mission_reset; it never reads simulator ground truth.
    const pose = location === MISSION_ORIGIN_ALIAS || location.startsWith(MISSION_ORIGIN_PREFIX)
      ? readMissionOrigin(location) : this.registry.resolve(location);
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
      const result={ status: "FAILED", target: requestedLocation, accepted: false, code: "INVALID_LOCATION", reason: "INVALID_LOCATION", known_locations: this.registry.list().map(l=>({id:l.id,name:l.name})), recovery: "Call list_known_locations or get_map and use a current registered location ID. No navigation goal was sent." };
      this.runtime.finish(id,result);
      return result.status === "SUCCEEDED" ? { status: "SUCCEEDED", target: location } : result;
    }
    try {
      // In managed mode short routes can finish within this bounded MCP wait. The
      // Python bridge keeps the real Nav2 goal and its ownership; subsequent
      // get_robot_state calls expose the operation and terminal result.  This
      // avoids the SDK's fixed 60s request deadline without cancelling a goal.
      const requestBudget = asyncNavigation() ? asyncConfirmationMs() : remainingRequestMs();
      let result: any;
      try {
        result = await this.bridge.request("navigate_to", {
          target: location, pose,
          timeout_sec: navigationActionBudgetSec(),
        }, requestBudget);
      } catch (error) {
        if (!(asyncNavigation() && error instanceof BridgeError && error.code === "BRIDGE_TIMEOUT")) throw error;
        const snapshot = await this.bridge.request("navigation_status", {}, 5000).catch(() => null);
        const owner = snapshot?.operation;
        const terminal = snapshot?.last_terminal;
        if (snapshot?.terminal_known === true && terminal) {
          const terminalStatus = terminal.terminal_status ?? snapshot.status;
          result = { accepted: true, status: terminalStatus === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
            target: location, goal_id: terminal.goal_id ?? null,
            operation_id: terminal.operation_id ?? null, action_status: terminalStatus,
            terminal_known: true,
            ...nav2TerminalDetails(terminalStatus, terminal.error_code,
              terminal.error_msg ?? terminal.error_message, terminal.reason) };
        } else if (!owner || snapshot?.active !== true || snapshot?.terminal_known === true) {
          throw error;
        } else result = { accepted: true, status: "PENDING", target: location,
            goal_id: owner.goal_id ?? null, operation_id: owner.operation_id ?? null,
            action_status: owner.state ?? "EXECUTING", terminal_known: false,
            reason: "NAVIGATION_IN_PROGRESS", poll_via: "get_robot_state" };
      }
      result = normalizeNavigationTerminalResult(result);
      // A failed goal is never promoted to success.  For a real Nav2 abort
      // caused by stale controller/costmap state, perform one bounded,
      // official recovery and submit one fresh goal.  This keeps the action
      // owner single-threaded while allowing a mission-local alternate route
      // to continue after a previous failed segment.
      if (result.status !== "PENDING" && result.evidence?.source !== "live_nav2_path_costmap_and_lidar" && result.status !== "SUCCEEDED" && result.terminal_known !== false &&
          (result.reason === "PATH_BLOCKED" || result.reason === "NAVIGATION_SYSTEM_UNHEALTHY" || Number(result.error_code) === 104 || Number(result.error_code) === 208)) {
        if (!navigationRetryWithinBudget(startedAt, Date.now(), rpcBudgetMs)) {
          result.recovery = { bounded: true, attempts: 0, skipped: "rpc_budget_exhausted",
            rpc_budget_ms: rpcBudgetMs, elapsed_ms: Date.now() - startedAt };
        } else {
          const recovery = await this.bridge.request("recover_navigation", {}, Math.min(RECOVERY_BUDGET_MS, remainingRequestMs())).catch((error: unknown) => ({ status: "FAILED", error: String(error) }));
        result.recovery = { bounded: true, attempts: 1, result: recovery };
        if (recovery?.pass === true) {
          result = await this.bridge.request("navigate_to", { target: location, pose, timeout_sec: 45 }, remainingRequestMs());
          result = normalizeNavigationTerminalResult(result);
          result.recovery = { bounded: true, attempts: 1, result: recovery };
        }
        }
      }
      if (result.status === "SUCCEEDED" && result.accepted === true && result.action_status === "SUCCEEDED") {
        try {
          const finalState = await this.getState();
          const finalPose = finalState.pose;
          const locationVerified = Number.isFinite(finalPose?.x) && Number.isFinite(finalPose?.y) &&
            Math.hypot(finalPose.x - pose.x, finalPose.y - pose.y) <= 0.35;
          if (!locationVerified) result.status = "FAILED";
        } catch { /* The unchanged MCP result contract does not expose verification metadata. */ }
      }
      if (result.status === "PENDING") {
        this.runtime.finish(id, { ...result, status: "PENDING", accepted: true });
      } else this.runtime.finish(id,result);
      // Preserve the real Nav2 correlation and terminal fields.  They are
      // additive to the fixed tool schema and are required to audit late
      // results, cancellations, and duplicate-goal ownership.
      return result.status === "SUCCEEDED" ? result : result;
    }
    catch (error) {
      // A transport timeout does not prove that the ROS2 goal stopped.  Query
      // the internal lifecycle record and report the ownership state; never
      // launch recovery or a duplicate goal from this catch path.
      let owner: any = null;
      if (error instanceof BridgeError && ['BRIDGE_TIMEOUT', 'ROS2_TIMEOUT', 'BRIDGE_EXITED'].includes(error.code)) {
        owner = await this.bridge.request("navigation_status", {}, Math.min(5000, remainingRequestMs())).catch(() => null);
      }
      const busy = error instanceof BridgeError && error.code === "ROS2_GOAL_BUSY";
      const result = { status: "FAILED", target: location, accepted: false,
        reason: busy ? "GOAL_BUSY" : error instanceof BridgeError && error.code.includes("TIMEOUT") ? "TIMEOUT" : error instanceof BridgeError && error.code === "NAVIGATION_SYSTEM_UNHEALTHY" ? "NAVIGATION_SYSTEM_UNHEALTHY" : "UNKNOWN",
        code: error instanceof BridgeError ? error.code : "ROS2_UNAVAILABLE",
        terminal_known: owner ? owner.terminal_known : false,
        owner_status: owner?.operation?.state ?? owner?.status ?? null,
        operation_id: owner?.operation?.operation_id ?? null,
        goal_id: owner?.operation?.goal_id ?? null };
      this.runtime.finish(id,result); return result;
    }
  }
  async stop() { return this.bridge.request("stop_robot", {}, 10000); }
  async close() { await this.bridge.close(); }
}
