import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DoorAnimationDriver, DoorJoint, DoorSample } from "./door-actuation.ts";

const ROOT = "/data-ssd/zhongchengkai/agnes";
/** Single transport process avoids the seconds of overhead of each gz CLI. */
export async function createGazeboDoorDriver(id: string): Promise<DoorAnimationDriver & { close(): Promise<void> }> {
  const child = spawn(ROOT + "/runtime/ros2-jazzy/.pixi/envs/default/bin/python",
    ["-B", fileURLToPath(new URL("./door-transport.py", import.meta.url)), id],
    { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let sample: DoorSample | null = null;
  let nextId = 0;
  let error = "";
  let exited = false;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  child.stderr.on("data", chunk => { error = (error + chunk).slice(-2000); });
  const fail = (message: string) => {
    error = message;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
  };
  child.on("error", cause => fail(String(cause)));
  child.on("exit", () => { exited = true; fail(error || "DOOR_TRANSPORT_EXITED"); });
  createInterface({ input: child.stdout }).on("line", line => {
    try {
      const message = JSON.parse(line);
      if (message.event === "sample") sample = { ...message, received_at: Date.now() };
      const request = pending.get(message.id);
      if (request) { clearTimeout(request.timer); pending.delete(message.id); request.resolve(message); }
    } catch { fail("INVALID_DOOR_TRANSPORT_RESPONSE"); }
  });
  async function setVelocity(joint: DoorJoint, velocity: number) {
    if (exited || !child.stdin.writable) throw new Error(error || "DOOR_TRANSPORT_CLOSED");
    const messageId = ++nextId;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(messageId); reject(new Error("DOOR_COMMAND_TIMEOUT")); }, 1500);
      pending.set(messageId, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id: messageId, joint, velocity }) + "\n", error => {
        if (error) { clearTimeout(timer); pending.delete(messageId); reject(error); }
      });
    });
  }
  async function close() {
    for (const joint of ["hinge", "handle"] as const) {
      try { await setVelocity(joint, 0); } catch { /* Python EOF/finally repeats both stops. */ }
    }
    child.stdin.end();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!exited) child.kill("SIGTERM");
  }
  const deadline = Date.now() + 4500;
  while (!sample && !exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (!sample || exited) { await close(); throw new Error(error || "DOOR_JOINT_TELEMETRY_UNAVAILABLE"); }
  return { setVelocity, sample: () => sample, close };
}
