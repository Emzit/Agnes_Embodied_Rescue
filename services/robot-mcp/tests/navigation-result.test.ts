import assert from "node:assert/strict";
import test from "node:test";
import { nav2TerminalDetails, normalizeNavigationTerminalResult } from "../src/transport/navigation-result.ts";
import { RuntimeWorldState } from "../src/transport/runtime-world-state.ts";
import { Ros2RobotGateway } from "../src/transport/ros2-gateway.ts";

test("native controller104 retains message without claiming system death or a collision", () => {
  const result = normalizeNavigationTerminalResult({
    status: "FAILED", action_status: "ABORTED", error_code: 104,
    error_msg: "Controller patience exceeded", reason: "NAVIGATION_SYSTEM_UNHEALTHY",
  });
  assert.equal(result.error_code, 104);
  assert.equal(result.error_msg, "Controller patience exceeded");
  assert.equal(result.reason, "CONTROLLER_PATIENCE_EXCEEDED");
  assert.equal(JSON.stringify(result).includes("PATH_BLOCKED"), false);
  assert.equal(JSON.stringify(result).includes("NAVIGATION_SYSTEM_UNHEALTHY"), false);
});

test("other aborts preserve native code/message and do not invent hardware failure", () => {
  assert.deepEqual(nav2TerminalDetails("ABORTED", 105, "Failed to make progress"),
    { error_code: 105, error_msg: "Failed to make progress", reason: "NAVIGATION_ABORTED" });
  assert.equal(nav2TerminalDetails("ABORTED", 102, "Transform unavailable", "TF_UNAVAILABLE").reason, "TF_UNAVAILABLE");
  assert.equal(nav2TerminalDetails("CANCELED", 104, "Canceled").reason, "ROBOT_STOPPED");
  assert.deepEqual(nav2TerminalDetails("SUCCEEDED", 0, ""), { error_code: 0, error_msg: "" });
});

test("separate obstacle evidence may keep PATH_BLOCKED but104 alone cannot create it", () => {
  const evidence = { source: "live_nav2_costmap_and_lidar", goal_occupancy: 100 };
  const result = normalizeNavigationTerminalResult({
    status: "FAILED", action_status: "ABORTED", reason: "PATH_BLOCKED",
    result: { error_code: 104, error_msg: "Controller patience exceeded" }, evidence,
  });
  assert.equal(result.reason, "PATH_BLOCKED");
  assert.equal(result.error_code, 104);
  assert.equal(result.error_msg, "Controller patience exceeded");
  assert.equal(result.evidence, evidence);
});

test("late controller failure folds once and only into its owning operation", () => {
  const runtime = new RuntimeWorldState();
  const attempt = runtime.begin("Room_A");
  runtime.finish(attempt, { status: "PENDING", accepted: true, operation_id: "op-a", goal_id: "goal-a" });
  runtime.updateNavigation({ terminal_known: true, active: false, status: "ABORTED",
    last_terminal: { operation_id: "op-old", goal_id: "goal-old", terminal_status: "ABORTED", error_code: 104, error_msg: "old" } });
  assert.equal(runtime.snapshot().navigation_attempts[0].status, "PENDING");
  const snapshot = { terminal_known: true, active: false, status: "ABORTED",
    last_terminal: { operation_id: "op-a", goal_id: "goal-a", terminal_status: "ABORTED", error_code: 104, error_msg: "Controller patience exceeded" } };
  runtime.updateNavigation(snapshot);
  runtime.updateNavigation(snapshot);
  const actual = runtime.snapshot();
  assert.equal(actual.navigation_attempts[0].error_code, 104);
  assert.equal(actual.navigation_attempts[0].error_msg, "Controller patience exceeded");
  assert.equal(actual.navigation_attempts[0].reason, "CONTROLLER_PATIENCE_EXCEEDED");
  assert.equal(actual.navigation_failures.length, 1);
  assert.deepEqual(actual.visited_locations, []);
  assert.deepEqual(actual.blocked_routes, []);
});

test("state polling exposes late native diagnostics without recovery or motion", async () => {
  const calls: string[] = [];
  const bridge = {
    async request(method: string) {
      calls.push(method);
      if (method === "navigate_to") return { status: "PENDING", accepted: true,
        target: "Room_A", operation_id: "op-a", goal_id: "goal-a",
        action_status: "EXECUTING", terminal_known: false };
      if (method === "get_robot_state") return { pose: { x: 0, y: 0, frame_id: "map" } };
      if (method === "navigation_status") return { status: "ABORTED", active: false, terminal_known: true,
        last_terminal: { operation_id: "op-a", goal_id: "goal-a", terminal_status: "ABORTED",
          error_code: 104, error_msg: "Controller patience exceeded" } };
      throw new Error("Unexpected motion/recovery call: " + method);
    },
  };
  const gateway = new Ros2RobotGateway({ bridge: bridge as any, waypoints: { Room_A: { x: 2, y: 1 } } });
  const pending = await gateway.navigateTo("Room_A");
  assert.equal(pending.status, "PENDING");
  const state = await gateway.getState();
  assert.equal(state.navigation_error_code, 104);
  assert.equal(state.navigation_error_message, "Controller patience exceeded");
  assert.equal(state.navigation_reason, "CONTROLLER_PATIENCE_EXCEEDED");
  assert.deepEqual(calls, ["navigate_to", "get_robot_state", "navigation_status"]);
  assert.equal(gateway.runtime.snapshot().navigation_failures.length, 1);
});
