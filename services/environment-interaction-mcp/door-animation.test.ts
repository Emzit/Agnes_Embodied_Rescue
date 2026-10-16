import test from "node:test";
import assert from "node:assert/strict";
import { animateDoorOpening, type DoorJoint, type DoorSample } from "./door-actuation.ts";

function rig(options: { jammed?: boolean; stale?: boolean; open?: boolean; failStop?: boolean } = {}) {
  let now = 0;
  const velocity = { hinge: 0, handle: 0 };
  const samples: DoorSample[] = [];
  const commands: { joint: DoorJoint; velocity: number; time: number }[] = [];
  const state = { hinge_angle: options.open ? Math.PI / 2 : 0, handle_angle: 0, hinge_velocity: 0, handle_velocity: 0, sim_time: 0, received_at: 0 };
  const driver = {
    sample: () => ({ ...state, received_at: options.stale ? -1000 : now }),
    async setVelocity(joint: DoorJoint, value: number) {
      commands.push({ joint, velocity: value, time: now });
      if (options.failStop && joint === "hinge" && value === 0 && state.hinge_angle > 1) return { published: false, code: 1 };
      velocity[joint] = value; return { published: true, code: 0 };
    },
  };
  const wait = async (ms: number) => {
    now += ms; state.sim_time += ms / 1000;
    if (!options.jammed) state.hinge_angle = Math.max(0, Math.min(Math.PI / 2, state.hinge_angle + velocity.hinge * ms / 1000));
    state.handle_angle = Math.max(0, Math.min(.48, state.handle_angle + velocity.handle * ms / 1000));
    state.hinge_velocity = options.jammed ? 0 : velocity.hinge;
    state.handle_velocity = velocity.handle;
    samples.push({ ...state, received_at: now });
  };
  return { driver, wait, now: () => now, commands, samples, state };
}

test("real-angle stages press the lever, ease the hinge, release only the lever, and hold open", async () => {
  const r = rig();
  const result = await animateDoorOpening(r.driver, r.wait, r.now);
  assert.equal(result.command.code, 0);
  assert.equal(result.stop.code, 0);
  assert.equal(result.auto_close, false);
  assert.deepEqual(result.stages.map(s => s.joint), ["handle", "hinge", "handle"]);
  assert.ok(r.state.hinge_angle >= 1.45);
  assert.ok(r.state.handle_angle < .02);
  assert.ok(Math.max(...r.samples.map(s => s.handle_angle)) > .44);
  const hinge = r.commands.filter(c => c.joint === "hinge");
  assert.ok(hinge.every(c => c.velocity >= 0 && c.velocity <= 1));
  assert.ok(hinge.some(c => c.velocity > 0 && c.velocity < .4));
  assert.ok(hinge.some(c => c.velocity > .9));
  assert.ok(hinge.findIndex(c => c.velocity > .9) < hinge.findLastIndex(c => c.velocity > 0 && c.velocity < .2));
  assert.deepEqual(r.commands.slice(-2).map(c => [c.joint, c.velocity]), [["hinge", 0], ["handle", 0]]);
  const angle = r.state.hinge_angle;
  await r.wait(10000);
  assert.equal(r.state.hinge_angle, angle);
});

test("a jammed hinge cannot be reported as success and both joints stop", async () => {
  const r = rig({ jammed: true });
  const result = await animateDoorOpening(r.driver, r.wait, r.now);
  assert.equal(result.command.code, 1);
  assert.match(result.command.stderr, /TIMEOUT/);
  assert.equal(result.stop.code, 0);
  assert.ok(r.commands.filter(c => c.joint === "hinge").every(c => c.velocity >= 0));
  assert.deepEqual(r.commands.slice(-2).map(c => [c.joint, c.velocity]), [["hinge", 0], ["handle", 0]]);
});

test("missing or stale telemetry prevents motion but still attempts both stops", async () => {
  const r = rig({ stale: true });
  const result = await animateDoorOpening(r.driver, r.wait, r.now);
  assert.equal(result.command.code, 1);
  assert.match(result.command.stderr, /TELEMETRY_UNAVAILABLE/);
  assert.deepEqual(r.commands.map(c => [c.joint, c.velocity]), [["hinge", 0], ["handle", 0]]);
});

test("stage stop failure is retained; handle return does not begin after failed hinge stop", async () => {
  const r = rig({ failStop: true });
  const result = await animateDoorOpening(r.driver, r.wait, r.now);
  assert.equal(result.command.code, 1);
  assert.equal(result.stop.code, 1);
  assert.ok(!r.commands.some(c => c.joint === "handle" && c.velocity < 0));
  assert.deepEqual(r.commands.slice(-2).map(c => [c.joint, c.velocity]), [["hinge", 0], ["handle", 0]]);
});

test("already-open door remains open without another motion cycle", async () => {
  const r = rig({ open: true });
  const result = await animateDoorOpening(r.driver, r.wait, r.now);
  assert.equal(result.command.code, 0);
  assert.deepEqual(result.stages, []);
  assert.ok(r.commands.every(c => c.velocity === 0));
});
