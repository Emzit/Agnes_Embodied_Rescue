import assert from "node:assert/strict";
import test from "node:test";
import { NavigationLifecycle } from "../src/transport/navigation-lifecycle.ts";

test("transport timeout keeps ownership until late Nav2 terminal", () => {
  const op = new NavigationLifecycle("op-1", "Room_A");
  op.accepted("goal-1", 2); op.feedback(3); op.timeout(4); op.cancelRequested("timeout", 5);
  assert.equal(op.terminalKnown, false);
  assert.equal(op.canStartAnotherGoal(), false);
  op.terminal("CANCELED", 6);
  assert.equal(op.terminalKnown, true);
  assert.equal(op.canStartAnotherGoal(), true);
});

test("late success is recorded as success, never as timeout success", () => {
  const op = new NavigationLifecycle("op-2", "__MISSION_ORIGIN__:m");
  op.accepted("goal-2"); op.timeout(); op.cancelRequested("transport");
  op.terminal("SUCCEEDED");
  assert.equal(op.state, "SUCCEEDED");
  assert.equal(op.terminalKnown, true);
  assert.throws(() => op.terminal("CANCELED"), /DUPLICATE_TERMINAL/);
});

test("goal busy is represented by unresolved ownership, not a second goal", () => {
  const op = new NavigationLifecycle("op-3", "Room_C");
  op.accepted("goal-3");
  assert.equal(op.canStartAnotherGoal(), false);
  assert.equal(op.snapshot().goalId, "goal-3");
});

test("unknown terminal never proves success", () => {
  const op = new NavigationLifecycle("op-4", "Start");
  op.accepted("goal-4"); op.timeout(); op.terminal("UNKNOWN");
  assert.equal(op.state, "UNKNOWN");
  assert.equal(op.terminalKnown, false);
  assert.equal(op.canStartAnotherGoal(), false);
});
