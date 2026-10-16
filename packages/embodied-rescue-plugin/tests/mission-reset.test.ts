import assert from "node:assert/strict";
import test from "node:test";
import { createCognitiveBackendTools } from "../src/backend/tools.ts";

test("active mission reset is allowed for a new evaluation", () => {
  const tools = createCognitiveBackendTools({ missionId: "active-run" });
  tools.world_memory_update({ searched_room: "initial-location" });

  const reset = tools.mission_reset();
  assert.ok("world_memory" in reset);
  assert.deepEqual(reset.world_memory.searched_rooms, []);
  assert.equal(reset.world_memory.target_status, "unknown");
});

test("completed mission reset is rejected and preserves state", () => {
  const tools = createCognitiveBackendTools({ missionId: "completed-run" });
  tools.world_memory_update({
    target_status: "FOUND",
    replan: true,
    active_perception: true,
  });
  const before = tools.mission_get_state();

  assert.deepEqual(tools.mission_reset(), {
    ok: false,
    code: "MISSION_ALREADY_COMPLETE",
    message: "The current mission is complete. Reset is only valid when starting a new evaluation or a new mission.",
  });
  assert.deepEqual(tools.mission_get_state(), before);
  assert.equal(tools.world_memory_get().replans_count, 1);
  assert.equal(tools.world_memory_get().active_perception_count, 1);
});

test("a fresh backend instance provides controlled new-run initialization", () => {
  const previousRun = createCognitiveBackendTools({ missionId: "previous-run" });
  previousRun.world_memory_update({ target_status: "FOUND" });

  const newRun = createCognitiveBackendTools({ missionId: "new-run" });
  const reset = newRun.mission_reset();
  assert.ok("world_memory" in reset);
  assert.equal(reset.mission_id, "new-run");
  assert.equal(reset.world_memory.target_status, "unknown");
});
