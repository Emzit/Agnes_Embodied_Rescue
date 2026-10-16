import assert from "node:assert/strict";
import test from "node:test";
import { navigationRetryWithinBudget } from "../src/transport/ros2-gateway.ts";

test("navigation recovery cannot start when the MCP request budget cannot settle a retry", () => {
  const started = 1_000;
  // 15 s recovery + 10 s minimum retry + 2 s safety margin are required.
  assert.equal(navigationRetryWithinBudget(started, started + 27_000, 55_000), true);
  assert.equal(navigationRetryWithinBudget(started, started + 28_000, 55_000), false);
});

test("navigation request budget is independent from the Nav2 action budget", () => {
  // A 45 s bridge/Nav2 action is allowed inside the explicit 55 s MCP budget,
  // while a late recovery cannot create a second in-flight goal.
  assert.equal(navigationRetryWithinBudget(0, 0, 55_000), true);
  assert.equal(navigationRetryWithinBudget(0, 45_000, 55_000), false);
});
