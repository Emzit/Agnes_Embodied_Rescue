import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export class JsonlBridge {
  readonly child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private closed = false;
  private eventListeners = new Set<(event: any) => void>();
  onEvent(listener: (event: any) => void) { this.eventListeners.add(listener); }
  private pending = new Map<string, {
    resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>;
  }>();
  constructor(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
    this.child = spawn(command, args, { env, stdio: "pipe", detached: true });
    this.child.stderr.on("data", (data) => process.stderr.write(data));
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      let reply: any;
      try { reply = JSON.parse(line); } catch { this.failAll("BRIDGE_PROTOCOL_ERROR"); return; }
      if (reply.event === "onboard_path_conflict") {
        for (const listener of this.eventListeners) listener(reply);
        return;
      }
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(reply.id);
      if (reply.ok === true && "result" in reply) entry.resolve(reply.result);
      else entry.reject(new BridgeError(typeof reply.error?.code === "string" ? reply.error.code : "BRIDGE_PROTOCOL_ERROR"));
    });
    this.child.on("error", () => this.failAll("BRIDGE_UNAVAILABLE"));
    this.child.on("exit", () => { this.closed = true; this.failAll("BRIDGE_EXITED"); lines.close(); });
  }
  private failAll(code: string) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new BridgeError(code)); }
    this.pending.clear();
  }
  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 35000): Promise<any> {
    if (this.closed) return Promise.reject(new BridgeError("BRIDGE_CLOSED"));
    const id = `ros2-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new BridgeError("BRIDGE_TIMEOUT")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n", (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new BridgeError("BRIDGE_WRITE_FAILED")); }
      });
    });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll("BRIDGE_CLOSED");
    this.child.stdin.end();
    const wait = (ms: number) => new Promise<boolean>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve(true);
      const timer = setTimeout(() => { this.child.off("exit", done); resolve(false); }, ms);
      const done = () => { clearTimeout(timer); resolve(true); };
      this.child.once("exit", done);
    });
    if (await wait(4000)) return;
    if (this.child.pid) { try { process.kill(-this.child.pid, "SIGTERM"); } catch {} }
    if (await wait(4000)) return;
    if (this.child.pid) { try { process.kill(-this.child.pid, "SIGKILL"); } catch {} }
    await wait(2000);
  }
}
