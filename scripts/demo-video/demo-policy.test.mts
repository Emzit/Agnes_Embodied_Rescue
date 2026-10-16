import {test} from "node:test";
import assert from "node:assert/strict";
import {stages, initialTask, baseTool, normalized, freshPeople, allowTool, navDone, stageEvidence, stopped, expectedStageMemory} from "./demo-policy.mts";

// In-memory fixtures only: no daemon, models, ROS, browser, navigation or doors.
const stage=(id:string)=>stages.find(s=>s.id===id)!;
const hash=(n:number)=>n.toString(16).padStart(64,"0");
const ts=(sec:number)=>({sec,nanosec:0});
const detection=(sec:number,n=sec)=>({id:"visual_"+n,label:"person",confidence:.94,source:"ros2_camera_perception",timestamp:ts(sec),
 evidence:{method:"vlm",provider:"agnes-ai",model:"agnes-3.0-flash",frame_timestamp:ts(sec),frame_sha256:hash(n)}});
const world=(sec:number)=>({current_location:"Right_Front_Room",sensor_status:{camera:true},current_observation:{
 timestamp:ts(sec),frame_sha256:hash(sec),perception_status:"AVAILABLE",semantic_objects:[detection(sec)]}});
const event=(tool:string,args:any,result:any,at:number)=>({tool,args,result,at});
const navigation=(target:string,at=1,op=target)=>[
 event("navigate_to",{location:target},{status:"PENDING",accepted:true,operation_id:op},at),
 event("get_robot_state",{}, {navigation_operation_id:op,navigation_terminal_known:true,navigation_terminal_status:"SUCCEEDED",navigation_active:false},at+1)
];
const halted={navigation_active:false,inspection_active:false,motion_owner:null,linear_velocity:0,angular_velocity:0};
const objectResult=(a=110,b=111)=>({status:"SUCCEEDED",still_uncertain:false,object_id:"visual_99",
 detections:[detection(a,100),detection(b,101)],evidence:[
 {frame_timestamp:ts(a),yaw:0,motion:{status:"SUCCEEDED"},detections:[detection(a,100)]},
 {frame_timestamp:ts(b),yaw:.12,motion:{status:"SUCCEEDED"},detections:[detection(b,101)]}]});
function confirmationRoomScan(){
 const events=scanEvents();
 events[0].args.location="Right_Front_Room";events[0].result.room="Right_Front_Room";events[0].at=1.5;
 events[1].at=1.8;events[1].result.inspection.result.room="Right_Front_Room";
 events[1].result.inspection.result.detections=[{...detection(101),id:"visual_99"}];
 return events;
}
const confirmation=(result=objectResult())=>[
 event("get_world_state",{},world(99),1),
 ...confirmationRoomScan(),
 event("inspect_object",{object_id:"visual_99"},result,2),
 event("stop_robot",{},{status:"STOPPED",zero_twist_published:true},3),
 event("get_robot_state",{},halted,4)
];
const frontEvents=()=>[
 ...navigation("Right_Front_Door_interaction",10),
 event("inspect_door",{door_id:"Right_Front_Door"},{status:"SUCCEEDED",runtime_state:"CLOSED",door_id:"Right_Front_Door",perception:{status:"AVAILABLE"},evidence:{near_interaction_pose:true,frame_timestamp:ts(20),frame_hashes:[hash(20)]},camera_observation:[{...detection(20),label:"door"}]},20),
 event("open_door",{door_id:"Right_Front_Door"},{status:"SUCCEEDED",runtime_state:"OPEN",code:"DOOR_OPEN_VERIFIED",door_id:"Right_Front_Door",command:{returncode:0,stop_returncode:0}},30),
 event("get_world_state",{},world(40),40),
 ...navigation("Right_Front_Room",50),
 event("get_world_state",{},world(60),60)
];

test("native SDK MCP text-content envelope is normalized",()=>{
 const raw={toolUseId:"real-shape-id",content:[{type:"text",text:JSON.stringify(world(9))}]};
 assert.equal(normalized(raw).current_observation.timestamp.sec,9);
 assert.equal(freshPeople(raw).length,1);
});
test("historical semantic_objects alone never count as current person evidence",()=>{
 assert.equal(freshPeople({semantic_objects:[detection(1)]}).length,0);
});
test("a frame from another provider is rejected",()=>{
 const v=world(10);v.current_observation.semantic_objects[0].evidence.provider="other";
 assert.equal(freshPeople(v).length,0);
});
test("current detection must match current frame hash, not only timestamp",()=>{
 const v=world(10);v.current_observation.frame_sha256=hash(99);
 assert.equal(freshPeople(v).length,0);
});
test("unavailable perception cannot supply accepted current detections",()=>{
 const v=world(10);v.current_observation.perception_status="UNAVAILABLE";
 assert.equal(freshPeople(v).length,0);
});
test("navigation completion must match the issued operation",()=>{
 const events=navigation("Right_Front_Room");events[1].result.navigation_operation_id="different";
 assert.equal(navDone(events,"Right_Front_Room"),false);
});
test("ordered approach, inspect, open, observe and entry is accepted",()=>{
 assert.deepEqual(stageEvidence(stage("front"),frontEvents()),{ok:true,missing:[]});
});
test("reversed entry-before-opening cannot satisfy the front stage",()=>{
 const events=[
  ...navigation("Right_Front_Room",1),
  ...frontEvents().filter(e=>!(e.tool==="navigate_to"&&e.args.location==="Right_Front_Room")&&e.at!==51)
 ];
 assert.equal(stageEvidence(stage("front"),events).ok,false);
});
test("FAILED scan start cannot reuse a previous completed inspection",()=>{
 const events=[
 event("inspect_room",{location:"Start"},{status:"FAILED",code:"MOTION_CONTROL_BUSY",inspection_id:"old-scan"},1),
 event("get_robot_state",{}, {inspection:{inspection_id:"old-scan",terminal_known:true,result:{status:"SUCCEEDED"}}},2)
 ];
 assert.equal(stageEvidence(stage("start"),events).ok,false);
});
test("ALREADY_OPEN does not prove the requested opening animation",()=>{
 const events=frontEvents();events.find(e=>e.tool==="open_door")!.result.code="ALREADY_OPEN";
 assert.equal(stageEvidence(stage("front"),events).ok,false);
});
test("two distinct current frames plus explicit stopped proof confirms",()=>{
 assert.deepEqual(stageEvidence(stage("confirm"),confirmation()),{ok:true,missing:[]});
});
test("two detections from the same frame do not count as two views",()=>{
 const r=objectResult();r.detections[1].evidence.frame_sha256=r.detections[0].evidence.frame_sha256;
 assert.equal(stageEvidence(stage("confirm"),confirmation(r)).ok,false);
});
test("same frame timestamp with different hashes is not multiview proof",()=>{
 assert.equal(stageEvidence(stage("confirm"),confirmation(objectResult(100,100))).ok,false);
});
test("later active motion invalidates an earlier stopped state",()=>{
 const events=[...confirmation(),event("get_robot_state",{},
  {...halted,inspection_active:true,motion_owner:"inspection",angular_velocity:.25},5)];
 assert.equal(stageEvidence(stage("confirm"),events).ok,false);
});
test("closed-room entry is denied until this stage has opening evidence",()=>{
 assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Room"},new Set(),"mission"),false);
});
test("stage scope rejects other doors, navigation targets, object IDs and reset IDs",()=>{
 assert.equal(allowTool(stage("near"),"open_door",{door_id:"Right_Middle_Door"},new Set(),"mission"),false);
 assert.equal(allowTool(stage("near"),"navigate_to",{location:"Right_Front_Room"},new Set(),"mission"),false);
 assert.equal(allowTool(stage("confirm"),"inspect_object",{object_id:"visual_unknown"},new Set(["visual_known"]),"mission"),false);
 assert.equal(allowTool(stage("start"),"mission_reset",{mission_id:"other",goal:initialTask},new Set(),"mission"),false);
});
test("zero Twist alone is insufficient while an inspection owns motion",()=>{
 assert.equal(stopped({...halted,inspection_active:true,motion_owner:"inspection"}),false);
});

function scanEvents(){
 const views=Array.from({length:8},(_,i)=>({timestamp:ts(100+i),frame_sha256:hash(100+i),
  perception_status:"AVAILABLE",yaw:i*Math.PI/4,odom_yaw:i*Math.PI/4,motion:{status:"SUCCEEDED"}}));
 return [
  event("inspect_room",{location:"Start"},{status:"PENDING",accepted:true,room:"Start",inspection_id:"new-scan",terminal_known:false,required_views:8},1),
  event("get_robot_state",{}, {inspection:{inspection_id:"new-scan",terminal_known:true,active:false,
   result:{status:"SUCCEEDED",room:"Start",inspection_id:"new-scan",rotation_complete:true,scan_views:8,return_motion:{status:"SUCCEEDED",control_frame:"odom"},
    rotation_evidence:{control_frame:"odom",start_yaw:0,end_yaw:-.05,measured_radians:2*Math.PI-.05,
      max_xy_drift_m:0,requested_radians:2*Math.PI},evidence:views}}},2)
 ];
}
test("eight fresh views plus final physical rotation proves a complete Start scan",()=>{
 assert.deepEqual(stageEvidence(stage("start"),scanEvents()),{ok:true,missing:[]});
});
test("seven views or an unfinished return rotation cannot prove 360 degrees",()=>{
 for(const mutation of [
  (x:any)=>{x.scan_views=7;x.evidence.pop();},
  (x:any)=>{x.rotation_complete=false;},
  (x:any)=>{x.return_motion.status="FAILED";},
  (x:any)=>{x.evidence[7].frame_sha256=x.evidence[0].frame_sha256;},
 ]){
  const events=scanEvents();mutation(events[1].result.inspection.result);
  assert.equal(stageEvidence(stage("start"),events).ok,false);
 }
});
test("previously known inspection ID is rejected even if the begin says PENDING",()=>{
 const events=scanEvents();
 events.unshift(event("get_robot_state",{}, {inspection:{inspection_id:"new-scan",terminal_known:true}},0));
 assert.equal(stageEvidence(stage("start"),events).ok,false);
});
test("door open is authorized only after this stage arrival and real door vision",()=>{
 const events=frontEvents();
 assert.equal(allowTool(stage("front"),"open_door",{door_id:"Right_Front_Door"},new Set(),"m",events.slice(0,2)),false);
 assert.equal(allowTool(stage("front"),"open_door",{door_id:"Right_Front_Door"},new Set(),"m",events.slice(0,3)),true);
 assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Room"},new Set(),"m",events.slice(0,4)),false);
 assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Room"},new Set(),"m",events.slice(0,5)),true);
});
test("pending navigation blocks other motion even within the same stage",()=>{
 assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Door_interaction"},new Set(),"m",navigation("Right_Front_Door_interaction").slice(0,1)),false);
});
test("frame after opening must advance beyond the door inspection frame",()=>{
 const events=frontEvents();events.find(e=>e.tool==="get_world_state")!.result=world(20);
 assert.equal(stageEvidence(stage("front"),events).ok,false);
});
test("parallel launched dependent operation cannot pass solely by result order",()=>{
 const events=frontEvents();const open=events.find(e=>e.tool==="open_door")! as any;open.call_at=19;
 assert.equal(stageEvidence(stage("front"),events).ok,false);
});
test("seeded historical person ID alone cannot authorize active inspection",()=>{
 assert.equal(allowTool(stage("confirm"),"inspect_object",{object_id:"visual_100"},new Set(["visual_100"]),"m",[]),false);
});

test("confirmation cannot reuse a multiview result from before the fresh current frame",()=>{
 const events=confirmation(objectResult(98,98));
 assert.equal(stageEvidence(stage("confirm"),events).ok,false);
});
test("two distinct sensor frames at the same angle do not prove an active multiview inspection",()=>{
 const r=objectResult();r.evidence[1].yaw=0;
 assert.equal(stageEvidence(stage("confirm"),confirmation(r)).ok,false);
});
test("a different Agnes model does not match the approved demo provider configuration",()=>{
 const r=world(10);r.current_observation.semantic_objects[0].evidence.model="unknown-model";
 assert.equal(freshPeople(r).length,0);
});
test("failed door vision permits a bounded retry at the same approach waypoint",()=>{
 const events=navigation("Right_Front_Door_interaction");
 events.push(event("inspect_door",{door_id:"Right_Front_Door"},{status:"FAILED",code:"DOOR_NOT_VISUALLY_OBSERVED"},4));
 assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Door_interaction"},new Set(),"m",events),true);
});
test("a completed full circle cannot trigger another scripted circle",()=>{
 assert.equal(allowTool(stage("start"),"inspect_room",{location:"Start"},new Set(),"m",scanEvents()),false);
});

test("hashed and unhashed MCP tool names normalize without eating the action verb",()=>{
 assert.equal(baseTool("mcp_robot_mcp_1685c66d_get_world_state"),"get_world_state");
 assert.equal(baseTool("mcp_robot_mcp_get_robot_state"),"get_robot_state");
 assert.equal(baseTool("mcp_envdoor_open_door"),"open_door");
});
test("native event sequence supports valid sequential calls delivered in the same millisecond",()=>{
 const events=frontEvents() as any[];
 for(let i=0;i<events.length;i++){events[i].at=1;events[i].call_at=1;events[i].call_seq=i*2+1;events[i].event_seq=i*2+2;}
 assert.equal(stageEvidence(stage("front"),events).ok,true);
});


test("map localization jumps do not invalidate continuous odometry scan proof",()=>{
 const events=scanEvents(),r=events[1].result.inspection.result;
 r.evidence.forEach((v:any,i:number)=>{v.yaw=i%2?2.9:-2.9;});
 assert.equal(stageEvidence(stage("start"),events).ok,true);
});
test("complete rotation needs finite odom travel, bounded drift and eight angular stations",()=>{
 for(const mutation of [
  (r:any)=>{delete r.rotation_evidence;},
  (r:any)=>{r.rotation_evidence.control_frame="map";},
  (r:any)=>{r.rotation_evidence.measured_radians=Math.PI;},
  (r:any)=>{r.rotation_evidence.measured_radians=NaN;},
  (r:any)=>{r.rotation_evidence.requested_radians=0;},
  (r:any)=>{r.rotation_evidence.max_xy_drift_m=.201;},
  (r:any)=>{r.rotation_evidence.max_xy_drift_m=-1;},
  (r:any)=>{r.rotation_evidence.end_yaw=.2;},
  (r:any)=>{r.return_motion.control_frame="map";},
  (r:any)=>{delete r.evidence[3].odom_yaw;},
  (r:any)=>{r.evidence[3].odom_yaw=r.evidence[2].odom_yaw;},
 ]){
  const events=scanEvents();mutation(events[1].result.inspection.result);
  assert.equal(stageEvidence(stage("start"),events).ok,false);
 }
});

const postCamera=(sec=40)=>({status:"SUCCEEDED",source:"ros2_real_sensors",
  robot_pose:{x:3.4,y:5.7,heading:0,frame_id:"map"},camera:{available:true,frame_timestamp:ts(sec),png_sha256:hash(sec)},
  perception_status:"AVAILABLE",semantic_objects:[detection(sec)],vision_observation:{frame_timestamp:ts(sec),frame_sha256:hash(sec)}});
const withPostOpen=()=>{const events=frontEvents().filter(e=>!(e.tool==="get_world_state"&&e.at===40));
 const opened=events.find(e=>e.tool==="open_door")!;opened.result.verification={measured_animation_final:{sim_time:35},fresh_camera_observation:postCamera()};
 return events;};
test("verified post-open Agnes frame authorizes entry without a duplicate recognition call",()=>{
 const events=withPostOpen();
 assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Room"},new Set(),"m",events.slice(0,4)),true);
 assert.deepEqual(stageEvidence(stage("front"),events),{ok:true,missing:[]});
 assert.equal(freshPeople(events.find(e=>e.tool==="open_door")!.result)[0].id,"visual_40");
});
test("pre-opening frame and inconsistent post-camera hash cannot replace fresh door vision",()=>{
 for(const change of [(v:any)=>{v.camera.frame_timestamp=ts(20);v.vision_observation.frame_timestamp=ts(20);},
  (v:any)=>{v.camera.png_sha256=hash(99);},(v:any)=>{v.perception_status="UNAVAILABLE";}]){
  const events=withPostOpen();change(events.find(e=>e.tool==="open_door")!.result.verification.fresh_camera_observation);
  assert.equal(allowTool(stage("front"),"navigate_to",{location:"Right_Front_Room"},new Set(),"m",events.slice(0,4)),false);
 }
});
test("door-post frame does not replace new observation inside the room",()=>{
 const events=withPostOpen().filter(e=>!(e.tool==="get_world_state"&&e.at===60));
 assert.equal(stageEvidence(stage("front"),events).ok,false);
});


test("stage memory writes require completed real evidence and exact room-localized fields",()=>{
 const memory=expectedStageMemory(stage("start"))!;
 assert.equal(allowTool(stage("start"),"world_memory_update",memory,new Set(),"m",[]),false);
 assert.equal(allowTool(stage("start"),"world_memory_update",memory,new Set(),"m",scanEvents()),true);
 assert.equal(allowTool(stage("start"),"world_memory_update",{...memory,robot_location:"Right_Front_Room"},new Set(),"m",scanEvents()),false);
 const incomplete=scanEvents();incomplete[1].result.inspection.result.scan_views=7;
 assert.equal(allowTool(stage("start"),"world_memory_update",memory,new Set(),"m",incomplete),false);
});
test("doorway observation records the approach location without asserting searched-room or absent personnel",()=>{
 const events=frontEvents().slice(0,5),memory=expectedStageMemory(stage("front"))!;
 assert.equal(allowTool(stage("front"),"world_memory_update",memory,new Set(),"m",events),false);
 const nearEvents=frontEvents().slice(0,5).map(e=>JSON.parse(JSON.stringify(e).replaceAll("Right_Front_Door","Right_Near_Door")));
 const nearMemory=expectedStageMemory(stage("near"))!;
 assert.equal(allowTool(stage("near"),"world_memory_update",nearMemory,new Set(),"m",nearEvents),true);
 assert.equal(nearMemory.robot_location,"Right_Near_Door_interaction");
 for(const extra of [{searched_room:"Right_Near_Room"},{target_status:"not_found"},{target_status:"secured"},{known_object:{object_id:"invented",labels:[{name:"person",confidence:1}]}},{action:{action_type:"rescue",status:"SUCCEEDED"}}])
  assert.equal(allowTool(stage("near"),"world_memory_update",{...nearMemory,...extra},new Set(),"m",nearEvents),false);
 assert.equal(allowTool(stage("near"),"world_memory_update",{...nearMemory,last_observation:"整个房间无人"},new Set(),"m",nearEvents),false);
});
test("fresh post-open evidence can back memory without a duplicate image inference",()=>{
 const events=withPostOpen(),memory=expectedStageMemory(stage("front"))!;
 assert.equal(allowTool(stage("front"),"world_memory_update",memory,new Set(),"m",events),true);
 const invalid=structuredClone(events);invalid.find(e=>e.tool==="open_door")!.result.verification.fresh_camera_observation.perception_status="UNAVAILABLE";
 // The separate real get_world_state inside the room is not a post-door view before entry.
 assert.equal(allowTool(stage("front"),"world_memory_update",memory,new Set(),"m",invalid),false);
});
test("person-confirmation memory cannot be written for unknown or mismatched people or without safe stop",()=>{
 const memory=expectedStageMemory(stage("confirm"))!;
 assert.equal(allowTool(stage("confirm"),"world_memory_update",memory,new Set(["visual_99"]),"m",confirmation()),true);
 const wrong=objectResult();wrong.object_id="invented_person";
 assert.equal(allowTool(stage("confirm"),"world_memory_update",memory,new Set(["invented_person"]),"m",confirmation(wrong)),false);
 const noPerson=confirmation();noPerson[0].result.current_observation.semantic_objects=[];
 noPerson[2].result.inspection.result.detections=[];
 assert.equal(allowTool(stage("confirm"),"world_memory_update",memory,new Set(),"m",noPerson),false);
 assert.equal(allowTool(stage("confirm"),"world_memory_update",memory,new Set(),"m",confirmation().slice(0,2)),false);
});
test("memory updates cannot manufacture stage action proof",()=>{
 const memory=expectedStageMemory(stage("near"))!;
 const forged=[event("world_memory_update",memory,{...memory,target_status:"found",searched_rooms:["Right_Near_Room"]},1)];
 assert.equal(stageEvidence(stage("near"),forged).ok,false);
 assert.equal(allowTool(stage("near"),"world_memory_update",memory,new Set(),"m",forged),false);
});


test("confirmation permits one room-local scan from a fresh blank wall and only its new personnel ID",()=>{
 const observed=event("get_world_state",{},world(99),1);
 observed.result.current_observation.semantic_objects=[];
 const scan=confirmationRoomScan(),events=[observed,...scan];
 assert.equal(allowTool(stage("confirm"),"inspect_room",{location:"Right_Front_Room"},new Set(),"m",[observed]),true);
 assert.equal(allowTool(stage("confirm"),"inspect_room",{location:"Right_Front_Room"},new Set(),"m",events),false);
 assert.equal(allowTool(stage("confirm"),"inspect_object",{object_id:"visual_99"},new Set(["visual_99"]),"m",events),true);
 assert.equal(allowTool(stage("confirm"),"inspect_object",{object_id:"old-doorway-id"},new Set(["old-doorway-id"]),"m",events),false);
 assert.equal(allowTool(stage("confirm"),"inspect_object",{object_id:"person"},new Set(["visual_99"]),"m",events),false);
 assert.equal(allowTool(stage("confirm"),"inspect_room",{location:"Right_Front_Room"},new Set(),"m",[]),false);
});
test("confirmation cannot use partial scans or a scan captured before its current-room camera frame",()=>{
 for(const mutate of [
  (e:any[])=>{e[2].result.inspection.result.status="PARTIAL";},
  (e:any[])=>{e[2].result.inspection.result.evidence[0].timestamp=ts(98);},
  (e:any[])=>{e[0].result.current_location="Right_Front_Door_interaction";}
 ]){
  const e=confirmation();mutate(e);
  assert.equal(stageEvidence(stage("confirm"),e).ok,false);
  assert.equal(allowTool(stage("confirm"),"inspect_object",{object_id:"visual_99"},new Set(["visual_99"]),"m",e.slice(0,3)),false);
 }
});
