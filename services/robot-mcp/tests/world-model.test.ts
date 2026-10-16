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
const out=`${root}artifacts/phase9f`,logs=`${root}logs/phase9f`;
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

test("real static regions, Nav2 motion and ROS sensor world model through MCP",{
  skip:process.env.PHASE9F_WORLD_TEST!=="1",timeout:240000,
},async()=>{
  assert.equal(process.env.HOME,`${root}.phase9f-home`);
  const acceptance:any={passed:false,real_ros2:false,real_gazebo:false,real_nav2:false,real_sensors:false,
    world_state_source:"ros2_gazebo_world_model",location_registry_source:"semantic_map_registry",
    mock_fallback:false,hidden_ground_truth_leak:false,mcp_contract_changed:false,
    phase9b_fixture_used:false,semantic_objects:[]};
  let observer:JsonlBridge|undefined,client:Client|undefined,transport:StdioClientTransport|undefined;
  const owned:number[]=[],trace:any[]=[];
  let stackOwned=false;
  await writeFile(`${logs}/stack.log`,"");
  const stream=createWriteStream(`${logs}/stack.log`,{flags:"a"});
  const stack=spawn("/bin/bash",[`${root}scripts/phase9f/start-stack.sh`],{detached:true,env:process.env,stdio:["ignore","pipe","pipe"]});
  stack.stdout!.pipe(stream);stack.stderr!.pipe(stream);
  const register=async(pid:number|undefined,group=true)=>{
    if(pid) await promisify(execFile)("/usr/bin/python3",[`${root}scripts/phase9d/stack.py`,"register",String(pid),group?"group":"pid"],{env:process.env});
  };
  try{
    for(let i=0;i<100;i++) {
      if((await readFile(`${logs}/stack.log`,"utf8")).includes("PHASE9F_STACK_STARTED"))break;
      assert.equal(stack.exitCode,null);await sleep(100);
    }
    const registry=JSON.parse(await readFile(`${root}.runtime-phase9f/processes.json`,"utf8"));
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
      env:{...process.env as Record<string,string>,ROBOT_GATEWAY:"ros2",ROBOT_ROS2_ENV:"phase9f"}});
    client=new Client({name:"phase9f-real-world",version:"0.1.0"},{capabilities:{}});
    await client.connect(transport);await register(transport.pid??undefined,false);
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),ROBOT_TOOL_CONTRACTS.map(t=>t.tool_name));
    const call=async(name:string,args:any={})=>{
      const reply:any=await client!.callTool({name,arguments:args});
      const result=reply.structuredContent??JSON.parse(reply.content.find((c:any)=>c.type==="text").text);
      trace.push({tool:name,input:args,result});return result;
    };
    const locations=await call("list_known_locations");await save("known-locations.json",locations);
    assert.equal(locations.items.length,6);
    for(const l of locations.items){assert.equal(l.source,"semantic_map_registry");assert.deepEqual(l.pose,doc.locations.find((v:any)=>v.id===l.id).pose);}
    const initial=await call("get_robot_state");assert.ok(Math.hypot(initial.position.x,initial.position.y)<0.1);
    let start:any;
    for(let i=0;i<30;i++){
      start=await call("get_world_state");if(start.sensor_status.lidar&&start.sensor_status.camera)break;await sleep(200);
    }
    await save("world-state-start.json",start);assert.equal(start.current_location,"Start");
    assert.equal(start.sensor_status.lidar,true);assert.equal(start.sensor_status.camera,true);
    assert.deepEqual(start.visited_locations,[]);
    const navResults:any[]=[];
    for(const location of ["Room_A","Room_C"]){
      const result=await call("navigate_to",{location});navResults.push({location,result});assert.equal(result.status,"SUCCEEDED");
      const world=await call("get_world_state");await save(location==="Room_A"?"world-state-room-a.json":"world-state-room-c.json",world);
      assert.equal(world.current_location,location);assert.ok(world.visited_locations.includes(location));
      assert.deepEqual(world.known_locations,locations.items);assert.deepEqual(world.semantic_objects,[]);
      assert.deepEqual(world.blocked_routes,[]);assert.equal(world.source,"ros2_gazebo_world_model");
      assert.equal(world.sensor_status.lidar,true);assert.equal(world.sensor_status.camera,true);
      const p=doc.locations.find((l:any)=>l.id===location).pose;
      assert.ok(Math.hypot(world.robot.pose.x-p.x,world.robot.pose.y-p.y)<=0.25);
    }
    await save("navigation-results.json",navResults);
    const last=trace.at(-1).result;assert.deepEqual(last.visited_locations,["Room_A","Room_C"]);
    assert.equal(last.navigation_attempts.length,2);assert.deepEqual(last.navigation_failures,[]);
    for(const name of ["inspect_room","inspect_object"]){
      const result=await call(name,name==="inspect_room"?{location:"Room_C"}:{object_id:"not_implemented"});
      assert.equal(result.status,"FAILED");assert.notEqual(result.code,"ROS2_MVP_NOT_IMPLEMENTED");
    }
    const leak=JSON.stringify(trace).match(/researcher|cabinet|fire_extinguisher|mock_world|ground_truth/gi)??[];
    await save("leak-check.json",{passed:!leak.length,forbidden_matches:leak,semantic_objects:[],
      sources:["static semantic registry","real odometry","real ROS sensor summaries","confirmed navigation events"]});
    assert.equal(leak.length,0);
    const stopped=await call("stop_robot");assert.equal(stopped.stopped,true);
    acceptance.real_ros2=acceptance.real_gazebo=acceptance.real_nav2=acceptance.real_sensors=true;
    acceptance.registry_map_alignment=acceptance.single_coordinate_source=true;
    acceptance.world_state=acceptance.list_known_locations=acceptance.current_location=acceptance.visited_locations=true;
    acceptance.remaining_unimplemented_tools=[];
    acceptance.passed=true;
  }finally{
    if(observer?.child.pid)owned.push(...await descendants(observer.child.pid));
    if(transport?.pid)owned.push(...await descendants(transport.pid));
    if(stack.pid)owned.push(...await descendants(stack.pid));
    await client?.close().catch(()=>undefined);await observer?.close();
    if(stackOwned)await promisify(execFile)("/bin/bash",[`${root}scripts/phase9f/stop-stack.sh`],{env:process.env,timeout:30000});
    else if(stack.pid&&alive(stack.pid)){try{process.kill(-stack.pid,"SIGTERM");}catch{}}
    for(let i=0;i<70&&owned.some(alive);i++)await sleep(100);
    const remaining=[...new Set(owned.filter(alive))];acceptance.process_cleanup=!remaining.length;
    if(remaining.length)acceptance.passed=false;
    await save("process-cleanup.json",{tracked_pids:[...new Set(owned)],remaining_pids:remaining,all_stopped:!remaining.length});
    await save("mcp-trace.json",{trace});await save("acceptance.json",acceptance);stream.end();
    assert.equal(remaining.length,0);
  }
});
