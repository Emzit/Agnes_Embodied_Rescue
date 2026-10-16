import assert from "node:assert/strict";
import test from "node:test";
import { createMockRescueScenario, InProcessRobotGateway } from "../src/index.ts";
import { createInitialMissionState } from "../../../packages/embodied-rescue-plugin/src/backend/mission-state.ts";
import { updateWorldMemory } from "../../../packages/embodied-rescue-plugin/src/backend/world-memory.ts";

test("active perception upgrades object_17 only after explicit inspection", () => {
  const { robot } = createMockRescueScenario();
  const gateway = new InProcessRobotGateway(robot);
  let memory = createInitialMissionState().world_memory;

  assert.equal(gateway.navigateTo("Room_A").status, "SUCCEEDED");
  const passive = gateway.getObservation();
  assert.equal(passive.status, "SUCCEEDED");
  const passiveObject = passive.object_observations[0];
  assert.equal(passiveObject.labels[0].confidence, 0.55);
  assert.equal(Math.max(...passiveObject.labels.map((label) => label.confidence)) < 0.8, true);

  const active = gateway.inspectObject("object_17");
  assert.equal(active.status, "SUCCEEDED");
  assert.equal(active.labels[0].name, "fire_extinguisher");
  assert.equal(active.labels[0].confidence, 0.94);
  memory = updateWorldMemory(memory, {
    active_perception: true,
    last_observation: "object:object_17",
    known_object: { object_id: "object_17", labels: active.labels },
  });
  assert.equal(memory.active_perception_count, 1);
  assert.equal(memory.known_objects[0].labels[0].confidence, 0.94);
});
