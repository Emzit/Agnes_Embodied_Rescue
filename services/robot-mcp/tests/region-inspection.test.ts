import assert from "node:assert/strict";
import test from "node:test";
import { Ros2RobotGateway } from "../src/transport/ros2-gateway.ts";
import { WorldRegistry } from "../src/transport/world-registry.ts";
import type { JsonlBridge } from "../src/transport/jsonl-bridge.ts";

const pose = (x:number,y=0) => ({x,y,yaw:0,frame_id:"map" as const});
const registry = () => new WorldRegistry({version:1,frame_id:"map",nearest_threshold:0.35,locations:[
  {id:"Start",name:"Start",type:"start",pose:pose(0),adjacency:[]},
  {id:"Hall",name:"Hall",type:"corridor",pose:pose(1),adjacency:[],bounds:{min_x:-1,max_x:3,min_y:-1,max_y:1}},
  {id:"Room",name:"Room",type:"room",pose:pose(5),adjacency:[],bounds:{min_x:4,max_x:6,min_y:-1,max_y:1}},
]});
function setup() {
  let robotPose:any=pose(0);
  let navigation:any={status:"IDLE",active:false,inspection_active:false,motion_owner:null,terminal_known:true};
  let frame:any={camera:{available:true,frame_timestamp:{sec:10,nanosec:20}},lidar:{available:true},
    robot_pose:pose(0),timestamp:{sec:10,nanosec:90},perception_status:"AVAILABLE",
    vision_observation:{frame_timestamp:{sec:10,nanosec:20},frame_sha256:"a".repeat(64)},semantic_objects:[]};
  const calls:any[]=[];
  const bridge={request:async(method:string,params:any={},timeout?:number)=>{
    calls.push({method,params,timeout});
    if(method==="get_robot_state")return {pose:robotPose,navigation_status:navigation.status};
    if(method==="navigation_status")return navigation;
    if(method==="get_observation")return frame;
    if(method==="inspect_room")return {status:"PENDING",accepted:true,room:params.room,inspection_id:"scan-1",
      terminal_known:false,poll_via:"get_robot_state",required_views:8};
    throw Error(method);
  }} as unknown as JsonlBridge;
  return {gateway:new Ros2RobotGateway({registry:registry(),bridge}),calls,
    setPose:(value:any)=>{robotPose=value;},setNavigation:(value:any)=>{navigation={...navigation,...value};},
    setFrame:(value:any)=>{frame={...frame,...value};}};
}

test("Start inside a corridor uses only its measured waypoint neighborhood and short async RPC",async()=>{
  const x=setup();
  const result=await x.gateway.inspectRoom("Start");
  assert.equal(result.status,"PENDING");
  assert.equal(result.region_type,"start");
  assert.deepEqual(x.calls.find(c=>c.method==="inspect_room"),{
    method:"inspect_room",params:{room:"Start",region_type:"start",async:true,expected_pose:{x:0,y:0}},timeout:10000});
  x.setPose(pose(0.36));
  assert.equal((await x.gateway.inspectRoom("Start")).code,"NOT_AT_LOCATION");
  x.setPose({...pose(0),frame_id:"camera"});
  assert.equal((await x.gateway.inspectRoom("Start")).code,"NOT_AT_LOCATION");
});

test("current corridor and existing room accepted; remote/unknown regions rejected",async()=>{
  const x=setup();x.setPose(pose(1.5));
  assert.equal((await x.gateway.inspectRoom("Hall")).status,"PENDING");
  assert.equal((await x.gateway.inspectRoom("Room")).code,"NOT_AT_LOCATION");
  assert.equal((await x.gateway.inspectRoom("missing")).code,"INVALID_LOCATION");
  x.setPose(pose(5));
  const room=await x.gateway.inspectRoom("Room");
  assert.equal(room.room,"Room");assert.equal(room.region_type,"room");assert.equal(room.status,"PENDING");
});

test("navigation and concurrent motion prevent inspection admission",async()=>{
  for(const state of [{active:true},{status:"EXECUTING"},{motion_owner:{kind:"navigation"}},
    {inspection_active:true,inspection:{inspection_id:"scan-existing"}}]) {
    const x=setup();x.setNavigation(state);
    assert.equal((await x.gateway.inspectRoom("Start")).code,"MOTION_CONTROL_BUSY");
    assert.equal(x.calls.filter(c=>c.method==="inspect_room").length,0);
  }
});

test("PENDING polling reports the correlated true terminal and records a room once",async()=>{
  const x=setup();x.setPose(pose(5));await x.gateway.inspectRoom("Room");
  x.setNavigation({inspection_active:true,inspection:{inspection_id:"scan-1",location:"Room",
    status:"PENDING",active:true,terminal_known:false,scan_views:2,required_views:8,result:null}});
  const pending=await x.gateway.getState();
  assert.equal(pending.inspection_active,true);assert.equal(pending.inspection.terminal_known,false);
  assert.equal(x.gateway.runtime.snapshot().inspected_rooms.length,0);
  const result={status:"SUCCEEDED",room:"Room",inspected:true,scan_views:8,rotation_complete:true,
    detections:[{id:"visual-current",label:"person",confidence:0.9,timestamp:{sec:12,nanosec:1}}],
    evidence:[],complete_visibility_claimed:false};
  x.setNavigation({inspection_active:false,inspection:{inspection_id:"scan-1",location:"Room",
    status:"SUCCEEDED",active:false,terminal_known:true,scan_views:8,required_views:8,result}});
  assert.equal((await x.gateway.getState()).inspection.result.rotation_complete,true);
  await x.gateway.getState();
  assert.deepEqual(x.gateway.runtime.snapshot().inspected_rooms,["Room"]);
  assert.equal(x.gateway.runtime.snapshot().object_observations.length,1);
});

test("failed or canceled scan never becomes an inspected room",async()=>{
  const x=setup();
  x.setNavigation({inspection:{inspection_id:"bad",location:"Room",status:"PARTIAL",active:false,
    terminal_known:true,result:{status:"PARTIAL",room:"Room",inspected:false,reason:"ROBOT_STOPPED",scan_views:1}}});
  const result=await x.gateway.getState();
  assert.equal(result.inspection.result.reason,"ROBOT_STOPPED");
  assert.deepEqual(x.gateway.runtime.snapshot().inspected_rooms,[]);
});

test("a complete corridor scan does not populate inspected_rooms",async()=>{
  const x=setup();
  x.setNavigation({inspection:{inspection_id:"hall",location:"Hall",terminal_known:true,
    result:{status:"SUCCEEDED",room:"Hall",inspected:true,detections:[],scan_views:8}}});
  await x.gateway.getState();assert.deepEqual(x.gateway.runtime.snapshot().inspected_rooms,[]);
});

test("current_observation distinguishes fresh empty frame from historical detections",async()=>{
  const x=setup();
  x.setFrame({semantic_objects:[{id:"old-person",label:"person",confidence:0.9,timestamp:{sec:10,nanosec:20}}]});
  await x.gateway.getWorldState();
  x.setFrame({semantic_objects:[],camera:{available:true,frame_timestamp:{sec:11,nanosec:5}},
    timestamp:{sec:11,nanosec:90},vision_observation:{frame_timestamp:{sec:11,nanosec:5},frame_sha256:"b".repeat(64)}});
  const world=await x.gateway.getWorldState();
  assert.equal(world.semantic_objects.length,1);
  assert.deepEqual(world.current_observation.semantic_objects,[]);
  assert.deepEqual(world.current_observation.timestamp,{sec:11,nanosec:5});
  assert.equal(world.current_observation.perception_status,"AVAILABLE");
  assert.equal(world.current_observation.frame_sha256,"b".repeat(64));
  assert.equal(JSON.stringify(world.current_observation).includes("_camera_image"),false);
});

test("current frame perception failure is preserved, never negative evidence",async()=>{
  const x=setup();x.setFrame({perception_status:"UNAVAILABLE",perception_error:"PERCEPTION_UNAVAILABLE",
    perception_error_stage:"IMAGE_PROMPT",semantic_objects:[]});
  const o=(await x.gateway.getWorldState()).current_observation;
  assert.equal(o.perception_status,"UNAVAILABLE");
  assert.equal(o.perception_error_stage,"IMAGE_PROMPT");
});


test("large asynchronous scan polling preserves exact frame and return-motion proof",async()=>{
  const x=setup();
  const samples=Array.from({length:200},(_,i)=>({at:i,x:0,y:0,yaw:i/200,yaw_error:0.02}));
  const result={status:"SUCCEEDED",room:"Hall",inspection_id:"large",inspected:true,scan_views:8,
    rotation_complete:true,return_motion:{status:"SUCCEEDED",target_yaw:2*Math.PI},
    detections:[],evidence:Array.from({length:8},(_,i)=>({yaw:i*Math.PI/4,
      timestamp:{sec:100+i,nanosec:0},frame_sha256:String(i).repeat(64),perception_status:"AVAILABLE",
      detections:[],motion:{status:"SUCCEEDED",start_pose:{x:0,y:0},samples}}))};
  x.setNavigation({inspection:{inspection_id:"large",location:"Hall",terminal_known:true,result}});
  const scan=(await x.gateway.getState()).inspection.result;
  assert.equal(scan.rotation_complete,true);assert.equal(scan.inspection_id,"large");
  assert.equal(scan.return_motion.status,"SUCCEEDED");
  assert.equal(scan.evidence.length,8);
  for(const [i,view] of scan.evidence.entries()) {
    assert.equal(view.frame_sha256,String(i).repeat(64));
    assert.equal(view.perception_status,"AVAILABLE");
  }
  assert.ok(Buffer.byteLength(JSON.stringify(scan))<12*1024);
});
