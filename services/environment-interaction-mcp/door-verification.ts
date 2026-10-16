import type { DoorAnimationDriver, DoorSample } from "./door-actuation.ts";

/** Read-only proof after both stop publications; never infer a stop from a command ACK. */
export async function freshStoppedDoorSample(
  driver: DoorAnimationDriver,
  previous: DoorSample | null,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => number = Date.now,
  budgetMs = 1000,
): Promise<DoorSample | null> {
  if (!previous || !Number.isFinite(previous.sim_time)) return null;
  const end = now() + budgetMs;
  while (now() < end) {
    const sample = driver.sample();
    if (sample && [sample.hinge_angle, sample.handle_angle, sample.hinge_velocity,
      sample.handle_velocity, sample.sim_time, sample.received_at].every(Number.isFinite)
      && sample.sim_time > previous.sim_time && sample.received_at >= previous.received_at
      && now() - sample.received_at <= 500 && now() >= sample.received_at
      && Math.abs(sample.hinge_velocity!) < .02 && Math.abs(sample.handle_velocity!) < .02) {
      return { ...sample };
    }
    await wait(25);
  }
  return null;
}

/** Independent post-motion reads start together, after the real zero-speed sample. */
export async function postDoorReads(
  readPanel: () => Promise<any>,
  readCamera: () => Promise<any>,
) {
  const [panel, camera] = await Promise.all([readPanel(), readCamera()]);
  return { panel, camera };
}

/** Sensor and joint headers share the Gazebo simulation clock. */
export function cameraAfterDoorStop(observation: any, sample: DoorSample | null) {
  const stamp=observation?.camera?.frame_timestamp;
  return observation?.camera?.available===true && sample && Number.isFinite(sample.sim_time)
    && Number.isInteger(stamp?.sec) && stamp.sec>=0 && Number.isInteger(stamp?.nanosec)
    && stamp.nanosec>=0 && stamp.nanosec<1e9 && stamp.sec+stamp.nanosec/1e9>sample.sim_time;
}
