import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JsonlBridge } from "../src/transport/jsonl-bridge.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = `${root}artifacts/phase9c`;
const logs = `${root}logs/phase9c`;
const pixi = `${root}tools/pixi/bin/pixi`;
const prefix = `${root}runtime/ros2-jazzy/.pixi/envs/default`;
const runArgs = ["run", "--locked", "-m", `${root}runtime/ros2-jazzy/pixi.toml`];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const save = (file: string, data: unknown) => writeFile(`${artifacts}/${file}`, JSON.stringify(data, null, 2) + "\n");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function descendants(pid: number): Promise<number[]> {
  let children: number[] = [];
  try { children = (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean).map(Number); } catch {}
  return [pid, ...(await Promise.all(children.map(descendants))).flat()];
}

test("real headless Gazebo Harmonic ↔ ROS-GZ ↔ ROS2 ↔ Robot MCP", {
  skip: process.env.PHASE9C_GAZEBO_TEST !== "1", timeout: 150000,
}, async () => {
  assert.equal(process.env.HOME, `${root}.phase9c-home`);
  assert.equal(process.env.DISPLAY, undefined);
  await mkdir(artifacts, { recursive: true });
  const streams: ReturnType<typeof createWriteStream>[] = [];
  const processes: ReturnType<typeof spawn>[] = [];
  const start = (name: string, args: string[]) => {
    const stream = createWriteStream(`${logs}/${name}.log`); streams.push(stream);
    const child = spawn(pixi, [...runArgs, ...args], {
      detached: true, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.pipe(stream); child.stderr!.pipe(stream); processes.push(child); return child;
  };
  const command = async (args: string[]) => (await promisify(execFile)(pixi, [...runArgs, ...args], {
    env: process.env, timeout: 20000, maxBuffer: 4000000,
  })).stdout;
  const acceptance: Record<string, unknown> = {
    real_ros2_middleware: false, real_gazebo: false, headless: true, real_nav2: false,
    phase9b_fixture_used: false, mcp_contract_changed: false, passed: false,
  };
  let probe: JsonlBridge | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  const trace: unknown[] = [];
  let owned: number[] = [];
  try {
    const packageFiles = await readdir(`${prefix}/conda-meta`);
    const packages = await Promise.all(packageFiles.filter(f => f.endsWith(".json")).map(async f => {
      const record = JSON.parse(await readFile(`${prefix}/conda-meta/${f}`, "utf8"));
      return { name: record.name, version: record.version, channel: record.channel, url: record.url };
    }));
    assert.ok(packages.every(p => /^https:\/\/prefix.dev\/(conda-forge|robostack-jazzy)\//.test(p.url)));
    assert.ok(!packages.some(p => /^(ros-jazzy|ros2)-(navigation2|nav2-bringup|rviz2|desktop)$/.test(p.name)));
    assert.ok(packages.some(p => p.name === "gz-sim8" && p.version.startsWith("8.")));
    await save("packages.json", { packages });
    await save("environment.json", { home: process.env.HOME, tmp: process.env.TMPDIR,
      cache: process.env.XDG_CACHE_HOME, ros_domain_id: process.env.ROS_DOMAIN_ID,
      gz_partition: process.env.GZ_PARTITION, display: null, real_nav2: false, pixi, prefix });
    const version = await command(["gz", "sim", "--version"]);
    await writeFile(`${artifacts}/gz-version.txt`, version);
    assert.match(version, /8\.\d+\.\d+/);
    const gz = start("gz-server", ["gz", "sim", "-s", "-r", "-v", "3", `${root}simulation/phase9c/world.sdf`]);
    start("ros-gz-bridge", ["ros2", "run", "ros_gz_bridge", "parameter_bridge", "--ros-args",
      "-p", `config_file:=${root}simulation/phase9c/bridge.yaml`]);
    probe = new JsonlBridge(pixi, [...runArgs, "python", `${root}simulation/phase9c/ros_probe.py`]);
    const initial: any = await probe.request("sample", {}, 20000);
    assert.equal(gz.exitCode, null);
    assert.ok(initial.samples.length >= 3);
    assert.ok(Math.abs(initial.samples[0].x) < 0.1);
    await save("initial-odom.json", initial);
    await writeFile(`${artifacts}/gz-topics.txt`, await command(["gz", "topic", "-l"]));
    await writeFile(`${artifacts}/ros2-topics.txt`, await command(["ros2", "topic", "list", "--no-daemon"]));
    await save("bridge-mapping.json", { cmd_vel: { ros: "/cmd_vel", gz: "/cmd_vel", direction: "ROS_TO_GZ",
      ros_type: "geometry_msgs/msg/Twist", gz_type: "gz.msgs.Twist" }, odom: { ros: "/odom", gz: "/odom",
      direction: "GZ_TO_ROS", ros_type: "nav_msgs/msg/Odometry", gz_type: "gz.msgs.Odometry" } });
    acceptance.real_ros2_middleware = acceptance.real_gazebo = acceptance.odom_bridge = true;
    const entityPose = async () => {
      const message = JSON.parse(await command(["gz", "topic", "-e", "--json-output", "-n", "1",
        "-t", "/world/phase9c/pose/info"]));
      const pose = message.pose?.find((p: any) => p.name === "phase9c_robot");
      assert.ok(pose?.position, "real Gazebo model pose must be present");
      return pose;
    };
    const initialEntity = await entityPose();
    const motion: any = await probe.request("drive", {}, 10000);
    assert.ok(motion.samples.at(-1).x - initial.samples.at(-1).x > 0.3);
    await save("motion-odom.json", motion);
    const movedEntity = await entityPose();
    assert.ok(movedEntity.position.x - (initialEntity.position.x ?? 0) > 0.3,
      "the physical model, not only wheel odometry, must move");
    await save("entity-motion.json", { initial: initialEntity, moved: movedEntity });
    acceptance.real_entity_motion = true;
    acceptance.robot_moved = acceptance.cmd_vel_bridge = true;
    const zero: any = await probe.request("zero", {}, 10000);
    assert.ok(Math.abs(zero.samples.at(-1).linear_velocity) < 0.02);
    const stationary: any = await probe.request("sample", {}, 10000);
    assert.ok(Math.abs(stationary.samples.at(-1).x - zero.samples.at(-1).x) < 0.02);
    await save("stop-odom.json", { zero, stationary });
    acceptance.zero_twist_stopped = true;
    const waypointFile = `${artifacts}/waypoints.json`;
    await writeFile(waypointFile, JSON.stringify({ B: { x: 2, y: 1 } }));
    transport = new StdioClientTransport({ command: process.execPath,
      args: [`${root}services/robot-mcp/src/server.ts`], cwd: root, stderr: "pipe",
      env: { ...process.env as Record<string, string>, ROBOT_GATEWAY: "ros2", ROBOT_ROS2_ENV: "phase9c",
        ROBOT_WAYPOINTS_FILE: waypointFile } });
    const stream = createWriteStream(`${logs}/mcp-server.log`); streams.push(stream);
    client = new Client({ name: "phase9c-gazebo-acceptance", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport); transport.stderr?.pipe(stream);
    assert.equal((await client.listTools()).tools.length, 8);
    const call = async (name: string, args = {}) => {
      const reply: any = await client!.callTool({ name, arguments: args });
      const result = reply.structuredContent ?? JSON.parse(reply.content.find((v: any) => v.type === "text").text);
      trace.push({ tool: name, input: args, result }); return result;
    };
    const state = await call("get_robot_state");
    assert.ok(Math.abs(state.position.x - stationary.samples.at(-1).x) < 0.1);
    await save("mcp-get-robot-state.json", state); acceptance.mcp_real_odom = true;
    const unavailable = await call("navigate_to", { location: "B" });
    assert.equal(unavailable.code, "NAV2_NOT_AVAILABLE");
    acceptance.navigate_to = "NAV2_NOT_AVAILABLE";
    await probe.request("drive", {}, 10000);
    const stopped = await call("stop_robot");
    assert.equal(stopped.stopped, true);
    await sleep(600);
    const stop1: any = await probe.request("sample", {}, 10000);
    await sleep(500);
    const stop2: any = await probe.request("sample", {}, 10000);
    assert.ok(Math.abs(stop2.samples.at(-1).linear_velocity) < 0.02);
    assert.ok(Math.abs(stop2.samples.at(-1).x - stop1.samples.at(-1).x) < 0.02);
    await save("mcp-stop-robot.json", { stopped, stop1, stop2 });
    acceptance.mcp_stop_robot = true;
    acceptance.passed = true;
  } finally {
    if (transport?.pid) owned.push(...await descendants(transport.pid));
    if (probe?.child.pid) owned.push(...await descendants(probe.child.pid));
    for (const child of processes) if (child.pid) owned.push(...await descendants(child.pid));
    await client?.close().catch(() => undefined);
    await probe?.close();
    for (const child of processes) if (child.pid) { try { process.kill(-child.pid, "SIGINT"); } catch {} }
    for (let i = 0; i < 50 && owned.some(alive); i++) await sleep(100);
    for (const child of processes) if (child.pid && alive(child.pid)) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    for (let i = 0; i < 30 && owned.some(alive); i++) await sleep(100);
    const remaining = owned.filter(alive);
    acceptance.process_cleanup = remaining.length === 0;
    if (remaining.length) acceptance.passed = false;
    await save("process-cleanup.json", { tracked_pids: owned, remaining_pids: remaining, all_stopped: !remaining.length });
    await save("mcp-trace.json", { trace }); await save("acceptance.json", acceptance);
    for (const stream of streams) stream.end();
    assert.equal(remaining.length, 0, "owned simulation process still running");
  }
});
