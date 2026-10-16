import assert from "node:assert/strict";
import test from "node:test";
import { createInitialMissionState } from "../src/backend/mission-state.ts";
import { updateWorldMemory } from "../src/backend/world-memory.ts";

test("world memory updates are structured and do not duplicate rooms", () => {
  const initial = createInitialMissionState().world_memory;
  const once = updateWorldMemory(initial, { searched_room: "Room C" });
  const twice = updateWorldMemory(once, { searched_room: "Room C" });
  const updated = updateWorldMemory(twice, {
    robot_location: "Room C",
    last_observation: "door visible",
    active_perception: true,
  });

  assert.deepEqual(updated.searched_rooms, ["Room C"]);
  assert.equal(updated.robot_location, "Room C");
  assert.equal(updated.active_perception_count, 1);
  assert.equal(updated.last_observation, "door visible");
});
