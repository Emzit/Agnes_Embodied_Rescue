import test from "node:test";
import assert from "node:assert/strict";
import { boundedDoorPulse } from "./door-actuation.ts";

test("zero is attempted when the positive velocity command fails", async () => {
  const velocities: number[] = [];
  const result = await boundedDoorPulse(async velocity => {
    velocities.push(velocity);
    if (velocity) throw new Error("positive failed");
    return { stdout: "stopped" };
  }, async () => {});
  assert.deepEqual(velocities, [1, 0]);
  assert.equal(result.command.code, 1);
  assert.equal(result.stop.stdout, "stopped");
});

test("zero is attempted when the pulse wait fails", async () => {
  const velocities: number[] = [];
  const result = await boundedDoorPulse(async velocity => {
    velocities.push(velocity); return { stdout: "ok" };
  }, async () => { throw new Error("wait interrupted"); });
  assert.deepEqual(velocities, [1, 0]);
  assert.match(result.command.stderr, /wait interrupted/);
});

test("stop failures are retained and cannot look like a confirmed stop", async () => {
  const result = await boundedDoorPulse(async velocity => {
    if (!velocity) throw Object.assign(new Error("zero timeout"), { code: "ETIMEDOUT" });
    return { stdout: "started" };
  }, async () => {});
  assert.equal(result.stop.code, "ETIMEDOUT");
});

test("successful pulse uses the bounded wait then explicitly stops", async () => {
  const actions: number[] = [];
  const result = await boundedDoorPulse(async velocity => {
    actions.push(velocity); return { stdout: "ok" };
  }, async ms => { actions.push(ms); });
  assert.deepEqual(actions, [1, 1800, 0]);
  assert.equal(result.stop.stdout, "ok");
});
