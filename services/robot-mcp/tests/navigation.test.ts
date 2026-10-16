import assert from "node:assert/strict";
import test from "node:test";
import {
  createMockRescueScenario,
  InProcessRobotGateway,
} from "../src/index.ts";
import { createInitialMissionState } from "../../../packages/embodied-rescue-plugin/src/backend/mission-state.ts";
import { updateWorldMemory } from "../../../packages/embodied-rescue-plugin/src/backend/world-memory.ts";
import { decideWithAvailableProvider } from "../../../packages/embodied-rescue-plugin/src/decision/provider.ts";
import type { CandidateAction } from "../../../packages/embodied-rescue-plugin/src/decision/types.ts";

test("blocked route triggers fallback replan and finds researcher", () => {
  const { world, robot } = createMockRescueScenario();
  const gateway = new InProcessRobotGateway(robot);
  let memory = createInitialMissionState("step3", "find the researcher").world_memory;

  assert.equal(JSON.stringify(gateway.getWorldState()).includes("researcher_01"), false);
  assert.equal(gateway.navigateTo("Room_A").status, "SUCCEEDED");
  const roomA = gateway.inspectRoom("Room_A");
  assert.equal(roomA.status, "SUCCEEDED");
  assert.equal(roomA.observations.length, 0);
  memory = updateWorldMemory(memory, {
    searched_room: "Room_A",
    last_observation: "room:Room_A",
  });
  world.block_corridor_a();
  const blocked = gateway.navigateTo("Room_B");
  assert.deepEqual(blocked, {
    status: "FAILED",
    target: "Room_B",
    reason: "PATH_BLOCKED",
    blocked_route: "Corridor_A",
    obstacle_id: "cabinet_01",
  });
  assert.equal(gateway.getState().current_location, "Room_A");
  memory = updateWorldMemory(memory, {
    blocked_route: {
      from: "Room_A",
      to: "Room_B",
      reason: "PATH_BLOCKED",
      obstacle_id: "cabinet_01",
    },
    action: {
      action_id: "navigate_room_b",
      action_type: "navigate_to",
      target: "Room_B",
      status: "FAILED",
      reason: "PATH_BLOCKED",
    },
    replan: true,
  });
  assert.equal(memory.replans_count, 1);

  const candidates: CandidateAction[] = [
    {
      id: "route_via_room_c",
      type: "navigate",
      features: { safety: 0.9, success: 0.9, cost: 0.7, information_gain: 0.8 },
    },
    {
      id: "wait",
      type: "wait",
      features: { safety: 1, success: 0.1, cost: 0.1, information_gain: 0 },
    },
    {
      id: "retry_blocked_route",
      type: "navigate",
      features: { safety: 0.3, success: 0.4, cost: 0.2, information_gain: 0.3 },
    },
  ];
  const decision = decideWithAvailableProvider({
    goal: "find the researcher",
    world_state: memory,
    candidates,
  });
  assert.equal(decision.provider_name, "fallback");
  assert.equal(decision.selected_action?.id, "route_via_room_c");

  assert.equal(gateway.navigateTo("Room_C").status, "SUCCEEDED");
  assert.equal(gateway.navigateTo("Side_Corridor").status, "SUCCEEDED");
  assert.equal(gateway.navigateTo("Room_B").status, "SUCCEEDED");
  const roomB = gateway.inspectRoom("Room_B");
  assert.equal(roomB.observations.some((item) => item.subject === "researcher_01"), true);
  memory = updateWorldMemory(memory, {
    target_status: "FOUND",
    last_observation: "researcher_01 found in Room_B",
  });
  assert.equal(memory.target_status, "FOUND");

  const visible = gateway.getWorldState();
  assert.equal(JSON.stringify(visible).includes("researcher_01"), false);
});
