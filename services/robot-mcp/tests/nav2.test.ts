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
import { ROBOT_TOOL_CONTRACTS } from "../src/contract/tools.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = `${root}artifacts/phase9d`;
const logs = `${root}logs/phase9d`;
const pixi = `${root}tools/pixi/bin/pixi`;
const prefix = `${root}runtime/ros2-jazzy/.pixi/envs/default`;
const runArgs = ["run", "--locked", "-m", `${root}runtime/ros2-jazzy/pixi.toml`];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const save = (file: string, data: unknown) => writeFile(`${artifacts}/${file}`, JSON.stringify(data, null, 2) + "\n");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function descendants(pid: number): Promise<number[]> {
  let children: number[] = [];
  try {
    const threads = await readdir(`/proc/${pid}/task`);
    const lists = await Promise.all(threads.map(async tid => {
      try { return (await readFile(`/proc/${pid}/task/${tid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean).map(Number); }
      catch { return []; }
    }));
    children = [...new Set(lists.flat())];
  } catch {}
  return [pid, ...(await Promise.all(children.map(descendants))).flat()];
}
const errorTo = (state: any, x: number, y: number) => Math.hypot(state.position.x - x, state.position.y - y);

test("official Nav2 NavigateToPose → real headless Gazebo, ROS2 and MCP", {
  skip: process.env.PHASE9D_NAV2_TEST !== "1", timeout: 300000,
}, async () => {
  assert.equal(process.env.HOME, `${root}.phase9d-home`);
  await mkdir(artifacts, { recursive: true });
  const processes: ReturnType<typeof spawn>[] = [];
  const streams: ReturnType<typeof createWriteStream>[] = [];
  const start = (name: string, args: string[]) => {
    const stream = createWriteStream(`${logs}/${name}.log`); streams.push(stream);
    const child = spawn(args[0], args.slice(1), {
      detached: true, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.pipe(stream); child.stderr!.pipe(stream); processes.push(child); return child;
  };
  const command = async (args: string[]) => (await promisify(execFile)(pixi, [...runArgs, ...args], {
    env: process.env, timeout: 20000, maxBuffer: 4000000,
  })).stdout;
  const acceptance: any = { real_ros2_middleware: false, real_gazebo: false, real_nav2: false,
    phase9b_fixture_used: false, fake_scan_used: false, custom_navigation_controller_used: false,
    nav2_meta_packages_used: false, rviz_installed_by_phase9d: false,
    slam_toolbox_installed_by_phase9d: false,
    localization_assumption: "Fixed map origin: static identity map→odom; real Gazebo odom→base_link, not final localization",
    mcp_contract_changed: false, passed: false };
  let observer: JsonlBridge | undefined;
  let direct: JsonlBridge | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  const trace: any[] = [];
  let owned: number[] = [];
  let stackStarted = false;
  try {
    const records = await readdir(`${prefix}/conda-meta`);
    const packages = await Promise.all(records.filter(f => f.endsWith(".json")).map(async f => {
      const r = JSON.parse(await readFile(`${prefix}/conda-meta/${f}`, "utf8"));
      return { name: r.name, version: r.version, url: r.url };
    }));
    assert.ok(packages.every(p => /^https:\/\/prefix.dev\/(conda-forge|robostack-jazzy)\//.test(p.url)));
    assert.ok(!packages.some(p => /^(ros-jazzy|ros2)-(rviz2|nav2-rviz-plugins|slam-toolbox|desktop)$/.test(p.name)));
    await save("packages.json", { packages, meta_packages_installed: false,
      reason: "navigation2/nav2-bringup require forbidden RViz/SLAM packages; official runtime components installed instead" });
    start("stack", ["/bin/bash", `${root}scripts/phase9d/start-stack.sh`]);
    let started = false;
    for (let i = 0; i < 100; i++) {
      try { started = (await readFile(`${logs}/stack.log`, "utf8")).includes("PHASE9D_STACK_STARTED"); } catch {}
      if (started) break;
      assert.ok(processes[0].exitCode === null, "stack supervisor exited during startup");
      await sleep(100);
    }
    assert.ok(started, "stack supervisor startup timeout");
    const registry = JSON.parse(await readFile(`${root}.runtime-phase9d/processes.json`, "utf8"));
    assert.ok((await descendants(processes[0].pid!)).includes(
      registry.entries.find((e: any) => e.name === "supervisor").pid), "must own the registered supervisor");
    stackStarted = true;
    const register = async (pid: number | undefined, group = true) => {
      if (pid) await promisify(execFile)("/usr/bin/python3", [`${root}scripts/phase9d/stack.py`,
        "register", String(pid), group ? "group" : "pid"], { env: process.env });
    };
    observer = new JsonlBridge(pixi, [...runArgs, "python", `${root}simulation/phase9d/observer.py`]);
    await register(observer.child.pid);
    let lifecycle: any;
    for (let i = 0; i < 25; i++) {
      lifecycle = await observer.request("lifecycle", {}, 15000);
      if (Object.values(lifecycle).every(v => v === "active")) break;
      assert.ok(processes.every(p => p.exitCode === null), "a ROS/Gazebo process exited during startup");
      await sleep(500);
    }
    await save("lifecycle.json", lifecycle);
    assert.ok(Object.values(lifecycle).every(v => v === "active"), "Nav2 lifecycle not active");
    acceptance.lifecycle_active = true;
    const check = JSON.parse((await promisify(execFile)("/bin/bash", [`${root}scripts/phase9d/check-stack.sh`],
      { env: process.env, timeout: 40000 })).stdout);
    assert.equal(check.ready, true);
    await writeFile(`${artifacts}/clock-check.txt`, JSON.stringify(check, null, 2) + "\n");
    await writeFile(`${artifacts}/nav2-lifecycle.txt`, Object.entries(lifecycle).map(([n, s]) => `${n}: ${s}`).join("\n") + "\n");
    acceptance.clock_advancing = acceptance.tf_map_to_base_link = true;
    const graph: any = await observer.request("graph");
    assert.ok(graph.nav2_action_servers.some(([name]: any) => name === "/navigate_to_pose"));
    assert.ok(graph.plan_publishers.includes("planner_server"));
    assert.ok(graph.cmd_vel_publishers.includes("controller_server"));
    assert.ok(!graph.nodes.some(([name]: any) => name.includes("fixture")));
    assert.ok(!graph.topics.some(([name]: any) => name === "/scan"));
    await writeFile(`${artifacts}/nav2-nodes.txt`, graph.nodes.map(([n, ns]: any) => `${ns}${n}`).join("\n") + "\n");
    await writeFile(`${artifacts}/nav2-topics.txt`, graph.topics.map(([n, t]: any) => `${n} ${t}`).join("\n") + "\n");
    await writeFile(`${artifacts}/nav2-actions.txt`, graph.actions.map(([n, t]: any) => `${n} ${t}`).join("\n") + "\n");
    await writeFile(`${artifacts}/tf-tree.txt`, graph.tf_tree);
    await save("action-server.json", { node: "bt_navigator", endpoints: graph.nav2_action_servers });
    await save("graph-provenance.json", { plan_publishers: graph.plan_publishers,
      cmd_vel_publishers: graph.cmd_vel_publishers, map_to_base: graph.map_to_base });
    acceptance.nav2_action_server = "bt_navigator";
    acceptance.real_ros2_middleware = acceptance.real_gazebo = acceptance.real_nav2 = true;
    direct = new JsonlBridge("/bin/bash", [`${root}services/robot-mcp/ros2_bridge/launch_bridge.sh`], {
      ...process.env, ROBOT_ROS2_ENV: "phase9d",
    });
    await register(direct.child.pid);
    // Allow cold Python startup; this does not change navigation or goal tolerance.
    const initial: any = await direct.request("get_robot_state", {}, 25000);
    assert.ok(errorTo(initial, 0, 0) < 0.1);
    await assert.rejects(direct.request("unknown_method"), { code: "UNKNOWN_METHOD" });
    const malformed = new Promise<any>(resolve => {
      let buffer = "";
      const listener = (data: Buffer) => {
        buffer += data.toString();
        for (const line of buffer.split("\n").filter(Boolean)) {
          const reply = JSON.parse(line);
          if (reply.error?.code === "MALFORMED_REQUEST") {
            direct!.child.stdout.off("data", listener); resolve(reply); return;
          }
        }
      };
      direct!.child.stdout.on("data", listener);
    });
    direct.child.stdin.write("not-json\n");
    assert.equal((await Promise.race([malformed, sleep(5000).then(() => {
      throw new Error("live bridge malformed request timeout");
    })])).id, null);
    acceptance.phase9b_live_protocol_regression = true;
    await save("initial-odom.json", initial);
    const before: any = await observer.request("snapshot");
    const result: any = await direct.request("navigate_to", { target: "B", pose: { x: 2, y: 1 }, timeout_sec: 30 });
    const final: any = await direct.request("get_robot_state");
    const after: any = await observer.request("snapshot");
    await save("ros2-nav-result.json", { initial, result, final, distance_to_goal: errorTo(final, 2, 1), before, after });
    assert.equal(result.accepted, true); assert.equal(result.status, "SUCCEEDED");
    assert.ok(result.feedback.length > 0, "real Nav2 feedback must be received");
    assert.ok(errorTo(final, 2, 1) <= 0.25);
    assert.ok(after.path_count > before.path_count && after.max_path_size > 2);
    assert.ok(after.nonzero_commands > before.nonzero_commands);
    const entity = JSON.parse(await command(["gz", "topic", "-e", "--json-output", "-n", "1", "-t", "/world/phase9d/pose/info"]));
    const entityPose = entity.pose.find((p: any) => p.name === "phase9c_robot");
    assert.ok(entityPose && Math.hypot(entityPose.position.x, entityPose.position.y) > 1);
    await save("gazebo-entity.json", entityPose);
    acceptance.ros2_direct_navigation = true;
    const returnA: any = await direct.request("navigate_to", { target: "A", pose: { x: 0, y: 0 }, timeout_sec: 30 });
    assert.equal(returnA.status, "SUCCEEDED");
    if (direct.child.pid) owned.push(...await descendants(direct.child.pid));
    await direct.close(); direct = undefined;
    const waypointFile = `${root}simulation/phase9d/waypoints.json`;
    transport = new StdioClientTransport({ command: process.execPath,
      args: [`${root}services/robot-mcp/src/server.ts`], cwd: root, stderr: "pipe",
      env: { ...process.env as Record<string, string>, ROBOT_GATEWAY: "ros2", ROBOT_ROS2_ENV: "phase9d",
        ROBOT_WAYPOINTS_FILE: waypointFile } });
    const stream = createWriteStream(`${logs}/mcp-server.log`); streams.push(stream);
    client = new Client({ name: "phase9d-real-nav2-acceptance", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport); transport.stderr?.pipe(stream);
    await register(transport.pid ?? undefined, false);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name), ROBOT_TOOL_CONTRACTS.map(t => t.tool_name));
    const call = async (name: string, args: any = {}) => {
      const reply: any = await client!.callTool({ name, arguments: args });
      const result = reply.structuredContent ?? JSON.parse(reply.content.find((v: any) => v.type === "text").text);
      trace.push({ tool: name, input: args, result }); return result;
    };
    const mcpInitial = await call("get_robot_state");
    assert.ok(errorTo(mcpInitial, 0, 0) <= 0.25);
    const mcpResult = await call("navigate_to", { location: "B" });
    const mcpFinal = await call("get_robot_state");
    await save("mcp-nav-result.json", { initial: mcpInitial, result: mcpResult,
      final: mcpFinal, distance_to_goal: errorTo(mcpFinal, 2, 1) });
    assert.equal(mcpResult.status, "SUCCEEDED"); assert.ok(errorTo(mcpFinal, 2, 1) <= 0.25);
    await save("final-odom.json", mcpFinal); acceptance.mcp_navigation = true;
    const longNavigation = call("navigate_to", { location: "C" });
    let executing = false;
    for (let i = 0; i < 30; i++) {
      if ((await call("get_robot_state")).navigation_status === "EXECUTING") { executing = true; break; }
      await sleep(100);
    }
    assert.ok(executing);
    await sleep(1000);
    const beforeStop: any = await observer.request("snapshot");
    const stopped = await call("stop_robot");
    const canceled = await longNavigation;
    await sleep(700);
    const stop1 = await call("get_robot_state");
    await sleep(700);
    const stop2 = await call("get_robot_state");
    const afterStop: any = await observer.request("snapshot");
    await save("mcp-stop-result.json", { stopped, canceled, stop1, stop2, beforeStop, afterStop });
    assert.equal(stopped.cancel_status, "CANCELED"); assert.equal(stopped.stopped, true);
    assert.equal(canceled.reason, "ROBOT_STOPPED");
    assert.ok(Math.hypot(stop2.position.x - stop1.position.x, stop2.position.y - stop1.position.y) < 0.02);
    assert.ok(Math.abs(stop2.linear_velocity) + Math.abs(stop2.angular_velocity) < 0.02);
    assert.ok(afterStop.zero_commands > beforeStop.zero_commands);
    acceptance.cancel = acceptance.zero_twist = acceptance.mcp_stop = true;
    const sensorless = await call("get_observation");
    assert.equal(sensorless.source, "ros2_real_sensors");
    assert.equal(sensorless.lidar.available, false); assert.equal(sensorless.camera.available, false);
    assert.deepEqual(sensorless.semantic_objects, []);
    assert.equal((await call("get_world_state")).source,"ros2_gazebo_world_model");
    assert.ok((await call("list_known_locations")).items.length > 0);
    for (const [name, args] of [["inspect_room", { location: "B" }],
      ["inspect_object", { object_id: "not_supported" }]] as const) {
      const error=await call(name,args); assert.equal(error.status,"FAILED");
      assert.notEqual(error.code,"ROS2_MVP_NOT_IMPLEMENTED");
    }
    acceptance.unimplemented_tools = 0; acceptance.passed = true;
  } finally {
    if (transport?.pid) owned.push(...await descendants(transport.pid));
    for (const bridge of [observer, direct]) if (bridge?.child.pid) owned.push(...await descendants(bridge.child.pid));
    for (const child of processes) if (child.pid) owned.push(...await descendants(child.pid));
    await client?.close().catch(() => undefined);
    await direct?.close(); await observer?.close();
    if (stackStarted) await promisify(execFile)("/bin/bash", [`${root}scripts/phase9d/stop-stack.sh`],
      { env: process.env, timeout: 30000 });
    for (const child of processes) if (child.pid) { try { process.kill(-child.pid, "SIGINT"); } catch {} }
    for (let i = 0; i < 70 && owned.some(alive); i++) await sleep(100);
    for (const child of processes) if (child.pid && alive(child.pid)) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    for (let i = 0; i < 30 && owned.some(alive); i++) await sleep(100);
    const remaining = owned.filter(alive);
    acceptance.process_cleanup = remaining.length === 0;
    if (remaining.length) acceptance.passed = false;
    await save("process-cleanup.json", { tracked_pids: owned, remaining_pids: remaining, all_stopped: !remaining.length });
    await save("mcp-trace.json", { trace }); await save("acceptance.json", acceptance);
    for (const stream of streams) stream.end();
    assert.equal(remaining.length, 0, "owned Nav2/Gazebo process still running");
  }
});
