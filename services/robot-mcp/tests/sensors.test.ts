import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JsonlBridge } from "../src/transport/jsonl-bridge.ts";
import { ROBOT_TOOL_CONTRACTS } from "../src/contract/tools.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = `${root}artifacts/phase9e`, logs = `${root}logs/phase9e`;
const pixi = `${root}tools/pixi/bin/pixi`;
const runArgs = ["run", "--locked", "-m", `${root}runtime/ros2-jazzy/pixi.toml`];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const save = (name: string, value: unknown) => writeFile(`${artifacts}/${name}`, JSON.stringify(value, null, 2)+"\n");
async function descendants(pid: number): Promise<number[]> {
  try {
    const threads = await readdir(`/proc/${pid}/task`);
    const lists = await Promise.all(threads.map(async tid => {
      try { return (await readFile(`/proc/${pid}/task/${tid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean).map(Number); }
      catch { return []; }
    }));
    return [pid, ...(await Promise.all([...new Set(lists.flat())].map(descendants))).flat()];
  } catch { return []; }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("real EGL Gazebo sensors → ROS-GZ → ROS2 → MCP, with real Nav2", {
  skip: process.env.PHASE9E_SENSORS_TEST !== "1", timeout: 240000,
}, async () => {
  assert.equal(process.env.HOME, `${root}.phase9e-home`);
  const acceptance: any = { passed: false, real_ros2: false, real_gazebo: false,
    real_lidar: false, real_camera: false, real_nav2: false, headless: true,
    semantic_objects: [], mock_fallback: false, fake_scan: false, static_image_fake: false,
    mcp_contract_changed: false, scan_connected_to_nav2_obstacle_layer: false,
    phase9b_fixture_used: false };
  let observer: JsonlBridge | undefined, sensors: JsonlBridge | undefined;
  let client: Client | undefined, transport: StdioClientTransport | undefined;
  const owned: number[] = [], trace: any[] = [];
  let stackOwned = false;
  await writeFile(`${logs}/acceptance-stack.log`, "");
  const stream = createWriteStream(`${logs}/acceptance-stack.log`, { flags: "a" });
  const stack = spawn("/bin/bash", [`${root}scripts/phase9e/start-stack.sh`],
    { detached: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  stack.stdout!.pipe(stream); stack.stderr!.pipe(stream);
  const register = async (pid: number | undefined, group = true) => {
    if (pid) await promisify(execFile)("/usr/bin/python3", [`${root}scripts/phase9d/stack.py`,
      "register", String(pid), group ? "group" : "pid"], { env: process.env });
  };
  const command = async (args: string[]) => (await promisify(execFile)(pixi, [...runArgs, ...args],
    { env: process.env, timeout: 20000, maxBuffer: 2000000 })).stdout;
  try {
    for (let i=0;i<100;i++) {
      if ((await readFile(`${logs}/acceptance-stack.log`, "utf8")).includes("PHASE9E_STACK_STARTED")) break;
      assert.equal(stack.exitCode, null); await sleep(100);
    }
    const registry = JSON.parse(await readFile(`${root}.runtime-phase9e/processes.json`, "utf8"));
    assert.ok((await descendants(stack.pid!)).includes(registry.entries.find((e: any)=>e.name==="supervisor").pid));
    stackOwned = true;
    observer = new JsonlBridge(pixi, [...runArgs, "python", `${root}simulation/phase9d/observer.py`]);
    sensors = new JsonlBridge(pixi, [...runArgs, "python", `${root}simulation/phase9e/sensor_probe.py`]);
    await register(observer.child.pid); await register(sensors.child.pid);
    let samples: any;
    // LiDAR is required first; camera validation follows independently.
    for (let i=0;i<40;i++) {
      samples = await sensors.request("snapshot", {}, 15000);
      if (samples.scans.length >= 5) break;
      await sleep(300);
    }
    await save("lidar-sample.json", samples.scans.slice(0,5));
    assert.ok(samples.scans.length >= 5, "five real scan frames required");
    assert.ok(samples.scans.every((s:any)=>s.valid_points>0 && s.sample_count===360));
    assert.equal(new Set(samples.scans.map((s:any)=>JSON.stringify(s.frame_timestamp))).size, samples.scans.length);
    const initialScan = samples.scans.at(-1);
    assert.ok(Math.abs(initialScan.front_min_range - 2.6)<0.15, "ray must hit physical box at 3m, front face 2.7m, lidar x=0.1m");
    await save("lidar-validation.json", { passed: true, frames: samples.scans.length,
      measured_front: initialScan.front_min_range, expected_front: 2.6, source: "Gazebo gpu_lidar → ROS2 LaserScan" });
    acceptance.real_lidar = true;
    for (let i=0;i<40 && (samples.images.length<3 || !samples.camera_info);i++) {
      await sleep(300); samples=await sensors.request("snapshot");
    }
    await save("camera-info.json", samples.camera_info);
    assert.ok(samples.images.length>=3 && samples.camera_info, "three real image frames and camera info required");
    assert.ok(samples.images.every((s:any)=>s.available && s.width===320 && s.height===240 && s.data_length===230400 && s.summary.std>1 && s.summary.max>0));
    const imageBefore = samples.images.at(-1);
    await sensors.request("save_frame");
    let lifecycle: any;
    for (let i=0;i<25;i++) {
      lifecycle=await observer.request("lifecycle", {}, 15000);
      if (Object.values(lifecycle).every(v=>v==="active")) break;
      await sleep(500);
    }
    assert.ok(Object.values(lifecycle).every(v=>v==="active"));
    const graph: any = await observer.request("graph");
    assert.ok(graph.nav2_action_servers.some(([n]:any)=>n==="/navigate_to_pose"));
    assert.ok(!graph.nodes.some(([n]:any)=>n.includes("fixture")));
    for (const [name, type] of [["/scan","sensor_msgs/msg/LaserScan"], ["/camera/image_raw","sensor_msgs/msg/Image"], ["/camera/camera_info","sensor_msgs/msg/CameraInfo"]])
      assert.ok(graph.topics.some(([n,t]:any)=>n===name && t.includes(type)));
    const config=await readFile(`${root}simulation/phase9d/nav2_params.yaml`, "utf8");
    assert.ok(!config.includes("observation_sources") && !config.includes("ObstacleLayer"));
    await writeFile(`${artifacts}/ros2-topics.txt`, graph.topics.map(([n,t]:any)=>`${n} ${t}`).join("\n")+"\n");
    await writeFile(`${artifacts}/gz-topics.txt`, await command(["gz","topic","-l"]));
    await save("bridge-mapping.json", { mapping: await readFile(`${root}simulation/phase9e/bridge.yaml`,"utf8"),
      sensor_tf: {lidar_link:{x:0.1,z:0.22},camera_link:{x:0.25,z:0.22}}, nav2_scan_obstacle_layer:false });
    acceptance.real_ros2 = acceptance.real_gazebo = acceptance.real_nav2 = true;
    transport=new StdioClientTransport({command:process.execPath,args:[`${root}services/robot-mcp/src/server.ts`],cwd:root,stderr:"pipe",
      env:{...process.env as Record<string,string>,ROBOT_GATEWAY:"ros2",ROBOT_ROS2_ENV:"phase9e",ROBOT_WAYPOINTS_FILE:`${root}simulation/phase9e/waypoints.json`}});
    client=new Client({name:"phase9e-real-sensors",version:"0.1.0"},{capabilities:{}});
    await client.connect(transport); await register(transport.pid??undefined,false);
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),ROBOT_TOOL_CONTRACTS.map(t=>t.tool_name));
    const call=async (name:string,args:any={})=>{
      const reply:any=await client!.callTool({name,arguments:args});
      const result=reply.structuredContent??JSON.parse(reply.content.find((c:any)=>c.type==="text").text);
      trace.push({tool:name,input:args,result}); return result;
    };
    const initial=await call("get_robot_state");
    assert.ok(Math.hypot(initial.position.x,initial.position.y)<0.1);
    let before:any;
    for(let i=0;i<30;i++) {
      before=await call("get_observation");
      if(before.lidar.available && before.camera.available) break;
      await sleep(150);
    }
    await save("mcp-observation-before.json",before);
    assert.equal(before.source,"ros2_real_sensors"); assert.equal(before.lidar.available,true); assert.equal(before.camera.available,true);
    assert.deepEqual(before.semantic_objects,[]); assert.deepEqual(before.object_observations,[]);
    const nav=await call("navigate_to",{location:"B"});
    const final=await call("get_robot_state");
    await save("mcp-nav-result.json",{initial,result:nav,final,distance_to_goal:Math.hypot(final.position.x-2,final.position.y-1)});
    assert.equal(nav.status,"SUCCEEDED"); assert.ok(Math.hypot(final.position.x-2,final.position.y-1)<=0.25);
    await sleep(700);
    const after=await call("get_observation");
    await save("mcp-observation-after.json",after);
    assert.equal(after.source,"ros2_real_sensors"); assert.deepEqual(after.semantic_objects,[]);
    assert.ok(Math.abs(after.lidar.front_min_range-before.lidar.front_min_range)>0.2);
    assert.notDeepEqual(after.camera.frame_timestamp,before.camera.frame_timestamp);
    assert.notEqual(after.camera.summary.sha256,before.camera.summary.sha256);
    assert.ok(Math.abs(after.camera.summary.mean-before.camera.summary.mean)>0.1);
    const turn=await call("navigate_to",{location:"ViewTurn"});
    assert.equal(turn.status,"SUCCEEDED");
    await sleep(700);
    const turned=await call("get_robot_state"), turnedObservation=await call("get_observation");
    assert.ok(Math.abs(turned.yaw-final.yaw)>0.8, "real robot must turn before view-change validation");
    assert.notEqual(turnedObservation.camera.summary.sha256,after.camera.summary.sha256);
    assert.ok(Math.abs(turnedObservation.camera.summary.mean-after.camera.summary.mean)>0.1);
    await save("mcp-turn-result.json",{result:turn,state:turned,observation:turnedObservation});
    const afterSamples:any=await sensors.request("snapshot");
    const imageAfter=afterSamples.images.at(-1);
    await save("camera-frame-stats.json",{before:imageBefore,after_navigation:after.camera,after_turn:imageAfter,frames_before:samples.images.length,frames_after:afterSamples.images.length});
    await save("camera-validation.json",{passed:true,headless:true,real_frames:true,three_distinct_timestamps:new Set(samples.images.map((i:any)=>JSON.stringify(i.frame_timestamp))).size>=3,
      pixel_statistics_changed:imageBefore.summary.mean!==imageAfter.summary.mean,
      yaw_before:final.yaw,yaw_after:turned.yaw,turn_changes_pixels:true,
      source:"Gazebo Camera → ROS2 Image", renderer:"ogre2/EGL"});
    acceptance.real_camera=acceptance.mcp_observation=acceptance.nav2_navigation=true;
    const long=call("navigate_to",{location:"C"});
    for(let i=0;i<40;i++) {
      if((await call("get_robot_state")).navigation_status==="EXECUTING") break;
      await sleep(100);
    }
    await sleep(600);
    const stopped=await call("stop_robot"), canceled=await long;
    await sleep(600); const stop1=await call("get_robot_state");
    await sleep(600); const stop2=await call("get_robot_state");
    await save("mcp-stop-result.json",{stopped,canceled,stop1,stop2});
    assert.equal(stopped.cancel_status,"CANCELED"); assert.equal(stopped.zero_twist_published,true);
    assert.equal(canceled.action_status,"CANCELED"); assert.ok(Math.abs(stop2.linear_velocity)<0.02);
    assert.ok(Math.hypot(stop2.position.x-stop1.position.x,stop2.position.y-stop1.position.y)<0.02);
    acceptance.stop_robot=true;
    assert.equal((await call("get_world_state")).source,"ros2_gazebo_world_model");
    assert.ok((await call("list_known_locations")).items.length > 0);
    for(const [name,args] of [["inspect_room",{location:"B"}],["inspect_object",{object_id:"unsupported"}]] as const) {
      const error=await call(name,args);assert.equal(error.status,"FAILED");assert.notEqual(error.code,"ROS2_MVP_NOT_IMPLEMENTED");
    }
    acceptance.unimplemented_tools=0;
    const metadata=await readdir(`${root}runtime/ros2-jazzy/.pixi/envs/default/conda-meta`);
    const records=await Promise.all(metadata.filter(f=>f.endsWith(".json")).map(async f=>{
      const p=JSON.parse(await readFile(`${root}runtime/ros2-jazzy/.pixi/envs/default/conda-meta/${f}`,"utf8"));
      return {name:p.name,version:p.version,url:p.url};
    }));
    await save("sensor-packages.json",{new_packages_installed:false,packages:records.filter(p=>/gz-(sensors|rendering|sim)|ros-gz|sensor-msgs|numpy|ogre/.test(p.name)),opencv_required:false,cv_bridge_required:false});
    await save("environment.json",{home:process.env.HOME,tmp:process.env.TMPDIR,cache:process.env.XDG_CACHE_HOME,
      ros_domain:process.env.ROS_DOMAIN_ID,gz_partition:process.env.GZ_PARTITION,display:process.env.DISPLAY??null,
      wayland:process.env.WAYLAND_DISPLAY??null,headless_rendering:true,nav2_lifecycle:lifecycle,graph_provenance:graph});
    acceptance.passed=true;
  } finally {
    for(const b of [observer,sensors]) if(b?.child.pid) owned.push(...await descendants(b.child.pid));
    if(transport?.pid) owned.push(...await descendants(transport.pid));
    if(stack.pid) owned.push(...await descendants(stack.pid));
    await client?.close().catch(()=>undefined); await sensors?.close(); await observer?.close();
    if(stackOwned) await promisify(execFile)("/bin/bash",[`${root}scripts/phase9e/stop-stack.sh`],{env:process.env,timeout:30000});
    else if(stack.pid && alive(stack.pid)) {
      // Only this test's newly spawned process group, never a discovered daemon.
      try { process.kill(-stack.pid, "SIGTERM"); } catch {}
    }
    for(let i=0;i<70 && owned.some(alive);i++) await sleep(100);
    const remaining=[...new Set(owned.filter(alive))];
    acceptance.process_cleanup=!remaining.length;
    if(remaining.length) acceptance.passed=false;
    await save("mcp-trace.json",{trace});
    await save("process-cleanup.json",{tracked_pids:[...new Set(owned)],remaining_pids:remaining,all_stopped:!remaining.length});
    await save("acceptance.json",acceptance); stream.end();
    assert.equal(remaining.length,0,"owned phase9e process remains");
  }
});
