import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeWorldState } from "../src/transport/runtime-world-state.ts";

test("pending navigation is correlated only by operation id and folds late terminal", () => {
  const state = new RuntimeWorldState();
  const attempt = state.begin("Room_A");
  state.finish(attempt, {
    status: "PENDING", accepted: true, operation_id: "op-a",
    goal_id: "goal-a", terminal_known: false,
  });

  // A status for another operation must not complete this attempt.
  state.updateNavigation({
    active: false, terminal_known: true, status: "SUCCEEDED",
    last_terminal: { operation_id: "op-old", goal_id: "goal-old",
      terminal_status: "SUCCEEDED" },
  });
  let snapshot = state.snapshot();
  assert.equal(snapshot.navigation_attempts[0].status, "PENDING");
  assert.deepEqual(snapshot.visited_locations, []);

  state.updateNavigation({
    active: true, terminal_known: false, status: "EXECUTING",
    operation: { operation_id: "op-a", goal_id: "goal-a", state: "EXECUTING" },
  });
  snapshot = state.snapshot();
  assert.equal(snapshot.navigation_attempts[0].terminal_known, false);

  state.updateNavigation({
    active: false, terminal_known: true, status: "SUCCEEDED",
    last_terminal: { operation_id: "op-a", goal_id: "goal-a",
      terminal_status: "SUCCEEDED" },
  });
  snapshot = state.snapshot();
  assert.equal(snapshot.navigation_attempts[0].status, "SUCCEEDED");
  assert.equal(snapshot.navigation_attempts[0].terminal_known, true);
  assert.deepEqual(snapshot.visited_locations, ["Room_A"]);
});

test("accepted pending is not recorded as a navigation failure", () => {
  const state = new RuntimeWorldState();
  const attempt = state.begin("Room_B");
  state.finish(attempt, {
    status: "PENDING", accepted: true, operation_id: "op-b",
    goal_id: "goal-b", terminal_known: false,
  });
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.navigation_failures, []);
  assert.equal(snapshot.navigation_attempts[0].status, "PENDING");
});
