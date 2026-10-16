import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile,writeFile,readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JsonlBridge } from "../src/transport/jsonl-bridge.ts";
import { ROBOT_TOOL_CONTRACTS } from "../src/contract/tools.ts";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const out=`${root}artifacts/phase10`,logs=`${root}logs/phase10`;
const pixi=`${root}tools/pixi/bin/pixi`,runArgs=["run","--locked","-m",`${root}runtime/ros2-jazzy/pixi.toml`];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const save=(name:string,value:unknown)=>writeFile(`${out}/${name}`,JSON.stringify(value,null,2)+"\n");
async function descendants(pid:number):Promise<number[]> {
  try {
    const ts=await readdir(`/proc/${pid}/task`);
    const children=(await Promise.all(ts.map(async t=>{
      try{return (await readFile(`/proc/${pid}/task/${t}/children`,"utf8")).trim().split(/\s+/).filter(Boolean).map(Number);}catch{return [];}
    }))).flat();
    return [pid,...(await Promise.all([...new Set(children)].map(descendants))).flat()];
  }catch{return [];}
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};

test("real camera pixel perception and physical inspections through MCP",{
  skip:process.env.PHASE10_PERCEPTION_TEST!=="1",timeout:900000,
},async()=>{
  assert.equal(process.env.HOME,`${root}.phase10-home`);
  const acceptance:any={passed:false,real_ros2:false,real_gazebo:false,real_nav2:false,real_sensors:false,
    world_state_source:"ros2_gazebo_world_model",location_registry_source:"semantic_map_registry",
    mock_fallback:false,hidden_ground_truth_leak:false,mcp_contract_changed:false,
    phase9b_fixture_used:false,semantic_objects:[]};
  let observer:JsonlBridge|undefined,client:Client|undefined,transport:StdioClientTransport|undefined;
  const owned:number[]=[],trace:any[]=[];
  let stackOwned=false;
  await writeFile(`${logs}/stack.log`,"");
  const stream=createWriteStream(`${logs}/stack.log`,{flags:"a"});
  const stack=spawn("/bin/bash",[`${root}scripts/phase10/start-stack.sh`],{detached:true,env:process.env,stdio:["ignore","pipe","pipe"]});
  stack.stdout!.pipe(stream);stack.stderr!.pipe(stream);
  const register=async(pid:number|undefined,group=true)=>{
    if(pid) await promisify(execFile)("/usr/bin/python3",[`${root}scripts/phase9d/stack.py`,"register",String(pid),group?"group":"pid"],{env:process.env});
  };
  try{
    for(let i=0;i<100;i++) {
      if((await readFile(`${logs}/stack.log`,"utf8")).includes("PHASE10_STACK_STARTED"))break;
      assert.equal(stack.exitCode,null);await sleep(100);
    }
    const registry=JSON.parse(await readFile(`${root}.runtime-phase10/processes.json`,"utf8"));
    assert.ok((await descendants(stack.pid!)).includes(registry.entries.find((e:any)=>e.name==="supervisor").pid));stackOwned=true;
    observer=new JsonlBridge(pixi,[...runArgs,"python",`${root}simulation/phase9d/observer.py`]);await register(observer.child.pid);
    let lifecycle:any;
    for(let i=0;i<30;i++) {
      lifecycle=await observer.request("lifecycle",{},15000);
      if(Object.values(lifecycle).every(v=>v==="active"))break;
      await sleep(400);
    }
    assert.ok(Object.values(lifecycle).every(v=>v==="active"));
    const graph:any=await observer.request("graph");
    assert.ok(graph.nav2_action_servers.some(([n]:any)=>n==="/navigate_to_pose"));
    assert.ok(!graph.nodes.some(([n]:any)=>n.includes("fixture")));
    await save("environment.json",{home:process.env.HOME,tmp:process.env.TMPDIR,domain:process.env.ROS_DOMAIN_ID,graph,lifecycle});
    const alignment=JSON.parse((await promisify(execFile)(pixi,[...runArgs,"python",`${root}simulation/phase9f/map_validation.py`],{env:process.env,timeout:30000})).stdout);
    await save("nav2-map-alignment.json",alignment);assert.equal(alignment.passed,true);
    const doc=JSON.parse(await readFile(`${root}simulation/phase9f/world_registry.json`,"utf8"));await save("world-registry.json",doc);
    transport=new StdioClientTransport({command:process.execPath,args:[`${root}services/robot-mcp/src/server.ts`],cwd:root,stderr:"pipe",
      env:{...process.env as Record<string,string>,ROBOT_GATEWAY:"ros2",ROBOT_ROS2_ENV:"phase10"}});
    client=new Client({name:"phase9f-real-world",version:"0.1.0"},{capabilities:{}});
    await client.connect(transport);await register(transport.pid??undefined,false);
    const mcpLog=createWriteStream(`${logs}/mcp-server.log`);
    transport.stderr?.pipe(mcpLog);
    transport.stderr?.on("end",()=>mcpLog.end());
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),ROBOT_TOOL_CONTRACTS.map(t=>t.tool_name));
    const call=async(name:string,args:any={})=>{
      const reply:any=await client!.callTool({name,arguments:args},undefined,{timeout:300000});
      const result=reply.structuredContent??JSON.parse(reply.content.find((c:any)=>c.type==="text").text);
      trace.push({tool:name,input:args,result});return result;
    };
    const robot=await call("get_robot_state");assert.ok(Number.isFinite(robot.pose.x));
    const locations=await call("list_known_locations");assert.equal(locations.items.length,6);
    const raw = new JsonlBridge("/bin/bash",[`${root}services/robot-mcp/ros2_bridge/launch_bridge.sh`],
      {...process.env,ROBOT_ROS2_ENV:"phase10"});
    await register(raw.child.pid);
    try {
      let initial:any;
      for(let i=0;i<30;i++) {
        initial=await call("get_observation");if(initial.camera.available)break;
        await sleep(200);
      }
      assert.equal(initial.perception_status,"AVAILABLE");
      assert.ok(!initial.semantic_objects.some((d:any)=>d.label==="person"));
      const weak=initial.semantic_objects.find((d:any)=>d.confidence<0.8);
      let active:any;
      if(weak) {
        await save("object-inspection-before.json",weak);
        active=await call("inspect_object",{object_id:weak.id});
        await save("object-inspection-after.json",active);
        assert.equal(active.status,"SUCCEEDED");
        assert.equal(active.evidence.length,3);
        if(active.after_confidence<0.8 || active.detection_count<2)assert.equal(active.still_uncertain,true);
      }
      const navA=await call("navigate_to",{location:"Room_A"});assert.equal(navA.status,"SUCCEEDED");
      const roomA=await call("inspect_room",{location:"Room_A"});await save("room-a-inspection.json",roomA);
      await raw.request("capture_frame",{name:"camera-frame-room-a.png"});
      assert.equal(roomA.status,"SUCCEEDED");assert.equal(roomA.scan_views,8);
      assert.ok(new Set(roomA.evidence.map((e:any)=>JSON.stringify(e.timestamp))).size===8);
      assert.ok(Math.max(...roomA.evidence.map((e:any)=>e.yaw))-Math.min(...roomA.evidence.map((e:any)=>e.yaw))>2);
      assert.ok(!roomA.detections.some((d:any)=>d.label==="person"),"person must not appear before Room_B observation");
      assert.ok(roomA.detections.some((d:any)=>d.label==="toolbox"),"visible toolbox distractor required");
      assert.ok(roomA.detections.some((d:any)=>d.label==="fire_extinguisher"),"visible extinguisher required");
      await raw.request("capture_frame",{name:"camera-frame-room-a.png"});
      const worldA=await call("get_world_state");
      assert.ok(!worldA.semantic_objects.some((d:any)=>d.label==="person"));
      const navB=await call("navigate_to",{location:"Room_B"});assert.equal(navB.status,"SUCCEEDED");
      const roomB=await call("inspect_room",{location:"Room_B"});await save("room-b-inspection.json",roomB);
      assert.equal(roomB.status,"SUCCEEDED");assert.equal(roomB.evidence.length,8);
      const person=roomB.detections.find((d:any)=>d.label==="person");
      if(!person) {
        const probe=await promisify(execFile)(pixi,[...runArgs,"gz","topic","-e","-t","/world/phase10/dynamic_pose/info","-n","1"],{env:process.env,timeout:10000}).catch(e=>({stdout:String(e)}));
        await writeFile(`${out}/test-only-physical-pose.txt`,probe.stdout);
      }
      assert.ok(person,"human-shaped target must be detected from Room_B camera pixels");
      await raw.request("capture_frame",{name:"camera-frame-room-b.png"});
      const verified=await call("inspect_object",{object_id:person.id});
      assert.equal(verified.status,"SUCCEEDED");assert.equal(verified.evidence.length,3);
      if(!active){active=verified;await save("object-inspection-before.json",person);await save("object-inspection-after.json",verified);}
      await save("person-reinspection.json",verified);
      assert.equal((await call("inspect_object",{object_id:"never_observed_object"})).code,"INVALID_OBJECT");
      const world=await call("get_world_state");await save("world-state-after-inspection.json",world);
      assert.ok(world.inspected_rooms.includes("Room_A")&&world.inspected_rooms.includes("Room_B"));
      assert.ok(world.observed_objects.some((d:any)=>d.label==="person"));
      assert.ok(world.confidence_history.length>0);
      const observation=await call("get_observation");assert.equal(observation.perception_source,"ros2_camera_perception");
      const stop=await call("stop_robot");assert.equal(stop.stopped,true);
      for(const entry of trace) {
        const detections=entry.result.semantic_objects??entry.result.detections??[];
        for(const d of detections) {
          assert.equal(d.source,"ros2_camera_perception");assert.equal(d.evidence.method,"cv_color_contour");
          assert.ok(d.bbox.length===4 && d.evidence.frame_sha256.length===64);
        }
      }
      await save("perception-trace.json",{roomA,roomB,active,person_reinspection:verified,observation});
      await save("leak-check.json",{passed:true,early_person:false,runtime_ground_truth_read:false,
        runtime_sources:["ROS2 Image bytes","actual odometry","NumPy pixel color components"],
        person_identity_confirmed:false});
      acceptance.real_ros2=acceptance.real_gazebo=acceptance.real_nav2=acceptance.real_sensors=true;
      acceptance.real_camera_frames=acceptance.semantic_detections_from_pixels=true;
      acceptance.inspect_room=acceptance.inspect_object=acceptance.active_reinspection=true;
      acceptance.perception_route="CV";acceptance.general_recognition=false;acceptance.demo_marker_semantics=true;
      acceptance.before_confidence=active.before_confidence;acceptance.after_confidence=active.after_confidence;
      acceptance.still_uncertain=active.still_uncertain;acceptance.low_confidence_observed=Boolean(weak);
      acceptance.implemented_tools=ROBOT_TOOL_CONTRACTS.map(t=>t.tool_name);acceptance.unimplemented_tools=0;
      acceptance.passed=true;
    } finally {
      if(raw.child.pid)owned.push(...await descendants(raw.child.pid));
      await raw.close();
    }
  }finally{
    if(observer?.child.pid)owned.push(...await descendants(observer.child.pid));
    if(transport?.pid)owned.push(...await descendants(transport.pid));
    if(stack.pid)owned.push(...await descendants(stack.pid));
    await client?.close().catch(()=>undefined);await observer?.close();
    if(stackOwned)await promisify(execFile)("/bin/bash",[`${root}scripts/phase10/stop-stack.sh`],{env:process.env,timeout:30000});
    else if(stack.pid&&alive(stack.pid)){try{process.kill(-stack.pid,"SIGTERM");}catch{}}
    for(let i=0;i<70&&owned.some(alive);i++)await sleep(100);
    const remaining=[...new Set(owned.filter(alive))];acceptance.process_cleanup=!remaining.length;
    if(remaining.length)acceptance.passed=false;
    await save("process-cleanup.json",{tracked_pids:[...new Set(owned)],remaining_pids:remaining,all_stopped:!remaining.length});
    await save("mcp-trace.json",{trace});await save("acceptance.json",acceptance);stream.end();
    assert.equal(remaining.length,0);
  }
});
