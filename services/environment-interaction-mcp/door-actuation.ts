/** Always attempts the zero command, including an interrupted/failed pulse. */
export async function boundedDoorPulse(
  drive: (velocity: number) => Promise<any>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  let command: any = null;
  let stop: any = null;
  const failure = (error: any) => ({ stdout: error?.stdout || "", stderr: error?.stderr || String(error), code: error?.code || 1 });
  try {
    command = await drive(1.0);
    await wait(1800);
  } catch (error: any) {
    command = failure(error);
  } finally {
    try { stop = await drive(0.0); }
    catch (error: any) { stop = failure(error); }
  }
  return { command, stop };
}

export type DoorJoint = "hinge" | "handle";
export type DoorSample = { hinge_angle: number; handle_angle: number; hinge_velocity?: number; handle_velocity?: number; sim_time: number; received_at: number };
export type DoorAnimationDriver = {
  setVelocity(joint: DoorJoint, velocity: number): Promise<any>;
  sample(): DoorSample | null;
};

/** Real measured joints drive each stage; the hinge is never commanded closed. */
export async function animateDoorOpening(
  driver: DoorAnimationDriver,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => number = Date.now,
) {
  const stages: any[] = [];
  let command: any = { code: 0, stdout: "", stderr: "" };
  let stop: any = null;
  const snapshot = () => {
    const sample = driver.sample();
    if (!sample || now() - sample.received_at > 500
      || ![sample.hinge_angle, sample.handle_angle, sample.sim_time].every(Number.isFinite)) {
      throw new Error("DOOR_JOINT_TELEMETRY_UNAVAILABLE");
    }
    return sample;
  };
  async function move(joint: DoorJoint, target: number, maxSpeed: number, budgetMs: number) {
    let state = snapshot();
    const start = now();
    let lastSim = state.sim_time;
    let speed = 0;
    const angle = (s: DoorSample) => joint === "hinge" ? s.hinge_angle : s.handle_angle;
    const acceleration = joint === "hinge" ? 2.8 : 4.5;
    while (now() - start < budgetMs) {
      state = snapshot();
      const error = target - angle(state);
      if (Math.abs(error) <= .012 || (joint === "hinge" && error < 0)) {
        const stopped = await driver.setVelocity(joint, 0);
        if (stopped?.code || stopped?.published === false) throw new Error("DOOR_STAGE_STOP_NOT_PUBLISHED");
        stages.push({ joint, target_rad: target, measured_rad: angle(state), elapsed_ms: now() - start });
        return;
      }
      const dt = Math.min(.08, Math.max(0, state.sim_time - lastSim));
      lastSim = state.sim_time;
      // Slows continuously near the target; acceleration uses simulation time.
      const desired = Math.sign(error) * Math.min(maxSpeed, Math.abs(error) * 5,
        Math.sqrt(2 * acceleration * Math.abs(error)));
      speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, desired - speed));
      if (joint === "hinge") speed = Math.max(0, speed);
      const published = await driver.setVelocity(joint, speed);
      if (published?.code || published?.published === false) throw new Error("DOOR_VELOCITY_NOT_PUBLISHED");
      await wait(25);
    }
    throw new Error("DOOR_ANIMATION_STAGE_TIMEOUT:" + joint);
  }
  try {
    const initial = snapshot();
    if (initial.hinge_angle < 1.45) {
      await move("handle", .46, 1.4, 4000);
      await move("hinge", Math.PI / 2 - .005, 1.0, 10000);
      // Only the handle returns; the door hinge stays at zero velocity.
      await move("handle", 0, 1.4, 4000);
    }
    const measured = snapshot();
    if (measured.hinge_angle < 1.45) throw new Error("DOOR_OPEN_ANGLE_NOT_REACHED");
    command.stdout = "Measured handle press, eased opening and handle return completed";
  } catch (error: any) {
    command = { code: 1, stdout: "", stderr: String(error?.message || error) };
  } finally {
    const failures: string[] = [];
    for (const joint of ["hinge", "handle"] as const) {
      try {
        const result = await driver.setVelocity(joint, 0);
        if (result?.code || result?.published === false) failures.push(joint + ": zero not published");
      } catch (error: any) { failures.push(joint + ": " + String(error?.message || error)); }
    }
    stop = { code: failures.length ? 1 : 0, stderr: failures.join("; ") };
  }
  return { command, stop, stages, final_sample: driver.sample(), profile: "measured-handle-and-eased-hinge", auto_close: false };
}
