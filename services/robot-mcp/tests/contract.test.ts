import assert from "node:assert/strict";
import test from "node:test";
import {
  getRobotToolContracts,
  McpRobotGateway,
  ROBOT_TOOL_SCHEMAS,
} from "../src/index.ts";

test("robot contract exposes only high-level tools", () => {
  const contracts = getRobotToolContracts();
  const names = contracts.map((item) => item.tool_name);
  assert.deepEqual(names, [
    "get_robot_state",
    "get_world_state",
    "get_observation",
    "navigate_to",
    "inspect_room",
    "inspect_object",
    "stop_robot",
    "list_known_locations",
  ]);
  assert.equal(contracts.every((item) => item.input_type.length > 0), true);
  assert.equal(Object.prototype.hasOwnProperty.call(ROBOT_TOOL_SCHEMAS, "navigate_to"), true);
  assert.equal(names.some((name) => name.includes("cmd_vel")), false);
  assert.equal(names.some((name) => name.includes("joint")), false);
});

test("MCP gateway is explicit about unavailable transport", () => {
  const gateway = new McpRobotGateway();
  const state = gateway.getState();
  assert.equal("status" in state && state.status, "UNAVAILABLE");
  assert.equal("error_code" in state && state.error_code, "NOT_CONFIGURED");
  assert.deepEqual(gateway.navigateTo("Room_B"), {
    status: "FAILED",
    target: "Room_B",
    reason: "UNKNOWN",
    error_code: "UNAVAILABLE",
  });
});
