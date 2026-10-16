import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorldRegistry } from "../src/transport/world-registry.ts";
import { RuntimeWorldState } from "../src/transport/runtime-world-state.ts";
import { Ros2RobotGateway } from "../src/transport/ros2-gateway.ts";
import type { JsonlBridge } from "../src/transport/jsonl-bridge.ts";
import { BridgeError } from "../src/transport/jsonl-bridge.ts";

const load=()=>WorldRegistry.load(fileURLToPath(new URL("../../../simulation/phase9f/world_registry.json",import.meta.url)));
test("static registry validates frame, finite poses, adjacency and excludes hidden metadata",()=>{
  const r=load(); assert.equal(r.list().length,6);
  for(const l of r.list()) {assert.equal(r.locate(l.pose),l.id); assert.ok(l.adjacency.length>0);}
  for(const modify of [(d:any)=>d.locations[0].pose.x=NaN,(d:any)=>d.locations[0].researcher_location="hidden",(d:any)=>d.locations[0].adjacency.push("absent")]) {
    const d=r.snapshot();modify(d); assert.throws(()=>new WorldRegistry(d),/INVALID_WORLD_REGISTRY/);
  }
  assert.equal(r.locate({x:100,y:100}),"unknown");
  assert.equal(r.locate({x:1,y:1}),"unknown"); // Door transition, not a forced room assignment.
  assert.equal(r.locate({x:2,y:1,frame_id:"camera_link"}),"unknown");
  const copy=r.resolve("Room_A")!; copy.x=999; assert.equal(r.resolve("Room_A")!.x,2);
});
test("nearest threshold does not snap unknown space to a distant waypoint",()=>{
  const r=WorldRegistry.historicalWaypoints({P:{x:0,y:0}});
  assert.equal(r.locate({x:0.1,y:0}),"P"); assert.equal(r.locate({x:1,y:0}),"unknown");
});
test("runtime navigation facts require real successful status; timeout never proves blockage",()=>{
  const r=new RuntimeWorldState();
  r.observePose({x:0,y:0}); assert.equal(r.snapshot().last_observation_timestamp,null);
  r.finish(r.begin("X"),{status:"FAILED",reason:"TIMEOUT"});
  assert.deepEqual(r.snapshot().blocked_routes,[]); assert.deepEqual(r.snapshot().visited_locations,[]);
  r.finish(r.begin("Y"),{status:"SUCCEEDED",accepted:true,action_status:"SUCCEEDED"});
  r.finish(r.begin("Y"),{status:"SUCCEEDED",accepted:true,action_status:"SUCCEEDED"});
  assert.deepEqual(r.snapshot().visited_locations,["Y"]);
  r.finish(r.begin("Z"),{status:"FAILED",reason:"PATH_BLOCKED",blocked_route:"observed_route"});
  assert.equal(r.snapshot().blocked_routes.length,1);
});
test("navigation and listed positions share one registry; semantic labels remain empty",async()=>{
  const registry=load(), calls:any[]=[];
  // Explicit unit stub only, never used by middleware acceptance.
  const bridge={request:async(method:string,params:any)=>{
    calls.push({method,params});
    if(method==="inspect_room")throw new BridgeError("PERCEPTION_NOT_CONFIGURED");
    if(method==="navigate_to") return {status:"SUCCEEDED",accepted:true,action_status:"SUCCEEDED"};
    if(method==="get_robot_state") return {pose:{x:2,y:1},timestamp:{sec:1,nanosec:0}};
    return {robot_pose:{x:2,y:1},timestamp:{sec:1,nanosec:0},lidar:{available:false},camera:{available:false},semantic_objects:[]};
  }} as unknown as JsonlBridge;
  const g=new Ros2RobotGateway({registry,bridge}); await g.navigateTo("Room_A");
  assert.deepEqual(calls[0].params.pose,g.listKnownLocations().find(l=>l.id==="Room_A")!.pose);
  const w=await g.getWorldState(); assert.equal(w.current_location,"Room_A");
  assert.deepEqual(w.visited_locations,["Room_A"]); assert.deepEqual(w.semantic_objects,[]);
  assert.ok(!JSON.stringify(w).includes("researcher"));
  assert.equal((await g.inspectRoom("Room_A")).code,"PERCEPTION_NOT_CONFIGURED");
});


test("office room formatting aliases resolve uniquely and preserve canonical runtime IDs", async () => {
  const registry = new WorldRegistry({version:1,frame_id:"map",nearest_threshold:.45,locations:[{id:"Right_Front_Room",name:"右前方小房间",type:"room",pose:{x:6.75,y:5.9,yaw:0,frame_id:"map"},adjacency:[]}]});
  for (const name of ["Right_Front_Room", "Right Front Room", "right-front-room", "右前方小房间"]) {
    assert.equal(registry.find(name)?.id, "Right_Front_Room");
    assert.deepEqual(registry.resolve(name), registry.resolve("Right_Front_Room"));
  }
  assert.equal(registry.resolve("Right Room"), undefined);
  const calls: any[] = [];
  const bridge = { request: async (method: string, params: any) => {
    calls.push({method,params});
    if (method === "navigate_to") return {status:"PENDING",accepted:true,terminal_known:false};
    throw new Error("Unexpected bridge call");
  }} as unknown as JsonlBridge;
  const gateway = new Ros2RobotGateway({registry,bridge});
  const result = await gateway.navigateTo("Right Front Room");
  assert.equal(result.status, "PENDING");
  assert.equal(calls[0].params.target, "Right_Front_Room");
  assert.deepEqual(calls[0].params.pose, registry.resolve("Right_Front_Room"));
});

test("unknown location rejects before any robot request and identifies naming failure accurately", async () => {
  const registry=load();
  const bridge={request:async()=>{throw new Error("Unknown location must never send a robot command");}} as unknown as JsonlBridge;
  const result=await new Ros2RobotGateway({registry,bridge}).navigateTo("made-up room");
  assert.equal(result.code,"INVALID_LOCATION");
  assert.equal(result.reason,"INVALID_LOCATION");
  assert.equal(result.accepted,false);
  assert.ok(result.known_locations.some((l:any)=>l.id==="Room_A"));
});

test("ambiguous formatting aliases never pick an arbitrary location", () => {
  const registry=WorldRegistry.historicalWaypoints({"Room_A":{x:0,y:0},"Room-A":{x:2,y:0}});
  assert.equal(registry.find("room a"),undefined);
  assert.equal(registry.find("Room_A")?.id,"Room_A");
});

test("managed short routes can finish within one bounded request; long routes retain their actual goal", async () => {
  const oldAsync=process.env.ROBOT_NAVIGATION_ASYNC,oldConfirm=process.env.ROBOT_NAVIGATION_CONFIRMATION_MS;
  process.env.ROBOT_NAVIGATION_ASYNC="1";delete process.env.ROBOT_NAVIGATION_CONFIRMATION_MS;
  try {
    const calls:any[]=[];
    const registry=load();
    const bridge={request:async(method:string,params:any,timeout:number)=>{
      calls.push({method,params,timeout});
      if(method==="navigate_to")return {status:"SUCCEEDED",accepted:true,action_status:"SUCCEEDED",terminal_known:true,operation_id:"short",goal_id:"goal-short"};
      if(method==="get_robot_state")return {pose:{x:2,y:1}};
      if(method==="navigation_status")return {status:"SUCCEEDED",terminal_known:true,active:false,last_terminal:{operation_id:"short",goal_id:"goal-short",terminal_status:"SUCCEEDED"}};
      throw Error("Unexpected command");
    }} as unknown as JsonlBridge;
    const result=await new Ros2RobotGateway({registry,bridge}).navigateTo("Room_A");
    assert.equal(result.status,"SUCCEEDED");assert.equal(calls[0].timeout,20000);
    assert.equal(calls.filter(c=>c.method==="navigate_to").length,1);
    const pendingCalls:any[]=[];
    const pendingBridge={request:async(method:string,params:any,timeout:number)=>{
      pendingCalls.push({method,params,timeout});
      if(method==="navigate_to")throw new BridgeError("BRIDGE_TIMEOUT");
      if(method==="navigation_status")return {status:"EXECUTING",terminal_known:false,active:true,operation:{operation_id:"long",goal_id:"goal-long",state:"EXECUTING"}};
      throw Error("Unexpected command");
    }} as unknown as JsonlBridge;
    const pending=await new Ros2RobotGateway({registry,bridge:pendingBridge}).navigateTo("Room_A");
    assert.equal(pending.status,"PENDING");assert.equal(pending.operation_id,"long");assert.equal(pending.goal_id,"goal-long");
    assert.equal(pending.terminal_known,false);assert.equal(pendingCalls.filter(c=>c.method==="navigate_to").length,1);
    process.env.ROBOT_NAVIGATION_CONFIRMATION_MS="90000";
    pendingCalls.length=0;
    await new Ros2RobotGateway({registry,bridge:pendingBridge}).navigateTo("Room_A");
    assert.equal(pendingCalls[0].timeout,30000);
  } finally {
    if(oldAsync===undefined)delete process.env.ROBOT_NAVIGATION_ASYNC;else process.env.ROBOT_NAVIGATION_ASYNC=oldAsync;
    if(oldConfirm===undefined)delete process.env.ROBOT_NAVIGATION_CONFIRMATION_MS;else process.env.ROBOT_NAVIGATION_CONFIRMATION_MS=oldConfirm;
  }
});
