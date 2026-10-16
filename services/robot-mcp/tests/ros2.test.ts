import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JsonlBridge } from "../src/transport/jsonl-bridge.ts";
import { ROBOT_TOOL_CONTRACTS } from "../src/contract/tools.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = `${root}artifacts/phase9b`;
const logs = `${root}logs/phase9b`;
const pixi = `${root}tools/pixi/bin/pixi`;
const manifest = `${root}runtime/ros2-jazzy/pixi.toml`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const save = (name: string, value: any) => writeFile(`${artifacts}/${name}`, JSON.stringify(value, null, 2) + "\n");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function descendants(pid: number): Promise<number[]> {
  let children: number[] = [];
  try { children = (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean).map(Number); } catch {}
  return [pid, ...(await Promise.all(children.map(descendants))).flat()];
}

test("real MCP → rclpy → ROS2 fixture action/odom/cancel MVP", {
  skip: process.env.PHASE9B_ROS2_TEST !== "1", timeout: 120000,
}, async () => {
  assert.equal(process.env.HOME, `${root}.phase9b-home`);
  await mkdir(artifacts, { recursive: true });
  await mkdir(logs, { recursive: true });
  const eventFile = `${logs}/fixture-events.jsonl`;
  await writeFile(eventFile, "");
  const waypointFile = `${artifacts}/fixture-waypoints.json`;
  await writeFile(waypointFile, JSON.stringify({ A: { x: 0, y: 0 }, B: { x: 2, y: 1 }, long_goal: { x: 30, y: 1 } }));
  const fixtureLog = createWriteStream(`${logs}/fixture.log`);
  const fixture = spawn(pixi, ["run", "-m", manifest, "python", `${root}services/robot-mcp/ros2_bridge/phase9b_nav_fixture.py`, "--events", eventFile], {
    env: { ...process.env, RCUTILS_LOGGING_USE_STDOUT: "0" }, detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  fixture.stdout.pipe(fixtureLog); fixture.stderr.pipe(fixtureLog);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [`${root}services/robot-mcp/src/server.ts`],
    cwd: root, stderr: "pipe", env: {
      ...process.env as Record<string, string>, ROBOT_GATEWAY: "ros2", ROBOT_WAYPOINTS_FILE: waypointFile,
    },
  });
  const mcpLog = createWriteStream(`${logs}/mcp-server.log`);
  const client = new Client({ name: "phase9b-ros2-acceptance", version: "0.1.0" }, { capabilities: {} });
  const trace: any[] = [];
  let owned: number[] = [];
  const acceptance: any = { real_ros2_middleware: true, real_nav2: false, gazebo: false,
    robot_gateway: "ros2", mcp_contract_changed: false, passed: false };
  const call = async (name: string, args: any = {}) => {
    const reply: any = await client.callTool({ name, arguments: args });
    const result = reply.structuredContent ?? JSON.parse(reply.content.find((item: any) => item.type === "text").text);
    trace.push({ tool: name, input: args, result, is_error: reply.isError ?? false });
    return result;
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await readFile(eventFile, "utf8")).includes("fixture_ready")) break; } catch {}
      assert.ok(fixture.exitCode === null, "fixture unexpectedly exited"); await sleep(100);
    }
    // Exercise malformed requests against the actual Python JSONL implementation.
    const protocol = new JsonlBridge("/bin/bash", [`${root}services/robot-mcp/ros2_bridge/launch_bridge.sh`]);
    try {
      await assert.rejects(protocol.request("unknown_method"), { code: "UNKNOWN_METHOD" });
      const malformed = new Promise<any>((resolve) => {
        let buffer = "";
        const onData = (data: Buffer) => {
          buffer += data.toString();
          for (const line of buffer.split("\n").filter(Boolean)) {
            const value = JSON.parse(line);
            if (value.error?.code === "MALFORMED_REQUEST") {
              protocol.child.stdout.off("data", onData); resolve(value); return;
            }
          }
        };
        protocol.child.stdout.on("data", onData);
      });
      protocol.child.stdin.write("not-json\n");
      const bad = await Promise.race([malformed, sleep(5000).then(() => { throw new Error("malformed request timeout"); })]);
      assert.equal(bad.id, null);
    } finally {
      if (protocol.child.pid) owned.push(...await descendants(protocol.child.pid));
      await protocol.close();
    }
    acceptance.jsonl_malformed_request = true;
    await client.connect(transport);
    transport.stderr?.pipe(mcpLog);
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map((tool) => tool.name), ROBOT_TOOL_CONTRACTS.map((tool) => tool.tool_name));
    const initial = await call("get_robot_state");
    assert.ok(Math.abs(initial.position.x) < 0.05 && Math.abs(initial.position.y) < 0.05);
    const navigation = await call("navigate_to", { location: "B" });
    assert.equal(navigation.status, "SUCCEEDED"); assert.equal(navigation.accepted, true);
    const final = await call("get_robot_state");
    assert.ok(Math.hypot(final.position.x - 2, final.position.y - 1) < 0.1);
    await save("navigation-result.json", { initial, navigation, final, passed: true });
    acceptance.get_robot_state = acceptance.navigate_to = true;
    const longNavigation = call("navigate_to", { location: "long_goal" });
    let executing = false;
    for (let i = 0; i < 50; i++) {
      const state = await call("get_robot_state");
      if (state.navigation_status === "EXECUTING") { executing = true; break; }
      await sleep(100);
    }
    assert.ok(executing);
    await sleep(300);
    const zeroEventsBefore = (await readFile(eventFile, "utf8")).split('\n').filter(
      (line) => line.includes('"event": "zero_twist_received"'),
    ).length;
    const stopped = await call("stop_robot");
    const canceled = await longNavigation;
    assert.equal(stopped.cancel_status, "CANCELED"); assert.equal(stopped.stopped, true);
    assert.equal(canceled.reason, "ROBOT_STOPPED");
    await sleep(150);
    const stoppedPose = await call("get_robot_state");
    await sleep(500);
    const laterPose = await call("get_robot_state");
    assert.ok(Math.hypot(stoppedPose.position.x - laterPose.position.x, stoppedPose.position.y - laterPose.position.y) < 0.001);
    const events = await readFile(eventFile, "utf8");
    const zeroEventsAfter = events.split('\n').filter((line) => line.includes('"event": "zero_twist_received"')).length;
    assert.ok(zeroEventsAfter > zeroEventsBefore, "stop call must deliver a new zero Twist");
    assert.ok(events.includes('"event": "goal_canceled"'));
    await save("stop-result.json", { stopped, canceled, stoppedPose, laterPose,
      zero_twist_received: true, zero_events_before_stop: zeroEventsBefore, zero_events_after_stop: zeroEventsAfter });
    acceptance.stop_robot = acceptance.cancel = acceptance.zero_twist = true;
    for (const [tool, args] of [
      ["inspect_room", { location: "B" }],
      ["inspect_object", { object_id: "unimplemented" }],
    ] as const) {
      const unavailable = await call(tool, args);
      assert.equal(unavailable.status,"FAILED");assert.notEqual(unavailable.code,"ROS2_MVP_NOT_IMPLEMENTED");
      assert.equal(JSON.stringify(unavailable).includes("researcher"), false);
    }
    acceptance.unimplemented_tools = 0;
    for (const [file, kind] of [
      ["ros2-nodes.txt", "nodes"],
      ["ros2-topics.txt", "topics"],
      ["ros2-actions.txt", "actions"],
    ] as const) {
      const output = await promisify(execFile)(pixi, ["run", "-m", manifest, "python", `${root}services/robot-mcp/ros2_bridge/graph_snapshot.py`, kind], { env: process.env, timeout: 15000 });
      await writeFile(`${artifacts}/${file}`, output.stdout);
    }
    await save("environment.json", { ros_distro: "jazzy", nav2_msgs: true, real_nav2: false, gazebo: false,
      home: process.env.HOME, tmp: process.env.TMPDIR, ros_domain_id: process.env.ROS_DOMAIN_ID,
      middleware: process.env.RMW_IMPLEMENTATION, pixi, manifest });
    acceptance.passed = true;
  } finally {
    if (transport.pid) owned.push(...await descendants(transport.pid));
    if (fixture.pid) owned.push(...await descendants(fixture.pid));
    await client.close().catch(() => undefined);
    if (fixture.pid) { try { process.kill(-fixture.pid, "SIGINT"); } catch {} }
    for (let i = 0; i < 50 && owned.some(alive); i++) await sleep(100);
    if (fixture.pid && alive(fixture.pid)) { try { process.kill(-fixture.pid, "SIGTERM"); } catch {} }
    for (let i = 0; i < 30 && owned.some(alive); i++) await sleep(100);
    const remaining = owned.filter(alive);
    await save("process-cleanup.json", { tracked_pids: owned, remaining_pids: remaining, all_stopped: remaining.length === 0 });
    acceptance.process_cleanup = remaining.length === 0;
    await save("mcp-trace.json", { trace });
    await save("acceptance.json", acceptance);
    fixtureLog.end(); mcpLog.end();
    assert.equal(remaining.length, 0, "owned ROS2/MCP process still running");
  }
});
