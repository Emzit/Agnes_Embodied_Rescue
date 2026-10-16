import test from "node:test";
import assert from "node:assert/strict";
import {finishPendingStage,pendingStage,continuationAllows,waitForPendingRelease} from "./async-stage-driver.mts";
import {stages,expectedStageMemory} from "./demo-policy.mts";
const stage=stages[0],turn={reason:"completed",stopReason:"end_turn"};
const stamp=(sec:number)=>({sec,nanosec:0}),hash=(i:number)=>i.toString(16).padStart(64,"0");
const events=()=>[
 {tool:"inspect_room",args:{location:"Start"},at:Date.now()-1000,result:{status:"PENDING",accepted:true,room:"Start",inspection_id:"owned-inspection",terminal_known:false,required_views:8}},
 {tool:"get_robot_state",args:{},at:Date.now()-500,result:{inspection_active:true,inspection:{inspection_id:"owned-inspection",active:true,terminal_known:false,status:"PENDING"},motion_owner:{operation_id:"owned-inspection"}}}
];
const terminal=(status="SUCCEEDED")=>({tool:"get_robot_state",args:{},at:Date.now(),result:{inspection_active:false,inspection:{
 inspection_id:"owned-inspection",terminal_known:true,active:false,status,result:{status,room:"Start",inspection_id:"owned-inspection",rotation_complete:true,scan_views:8,
  return_motion:{status:"SUCCEEDED",control_frame:"odom"},rotation_evidence:{control_frame:"odom",start_yaw:0,end_yaw:-.05,measured_radians:Math.PI*2-.05,max_xy_drift_m:0,requested_radians:Math.PI*2},
  evidence:Array.from({length:8},(_,i)=>({timestamp:stamp(100+i),frame_sha256:hash(100+i),perception_status:"AVAILABLE",yaw:i*Math.PI/4,odom_yaw:i*Math.PI/4,motion:{status:"SUCCEEDED"}}))}}}});
const released=()=>({ros_domain_id:106,updated_at:Date.now()/1000,navigation:{motion_lease:{held:false}}});
const base=(e:any[],ask:any)=>({stage,initialTurn:turn,events:()=>e,readRos:released,signal:new AbortController().signal,deadline:Date.now()+600000,ask,record:()=>{},drain:async()=>{}});
test("accepted pending native job continues only through matching new native terminal proof and preserves the original turn",async()=>{
 const e=events();let asks=0;
 const result=await finishPendingStage(base(e,async(text:string,plan:any)=>{
  asks++;assert.equal(plan.id,"owned-inspection");assert.match(text,/只用get_robot_state/);
  assert.equal(continuationAllows(plan,"inspect_room",{location:"Start"}),false);
  e.push(terminal());const wanted=expectedStageMemory(stage);
  e.push({tool:"world_memory_update",args:wanted,at:Date.now(),result:wanted},{tool:"world_memory_get",args:{},at:Date.now(),result:wanted});
  return {reason:"completed",stopReason:"end_turn",lastSeq:99};
 }));
 assert.equal(asks,1);assert.equal(result.initial_turn,turn);assert.equal(result.turn.lastSeq,99);
 assert.deepEqual(result.evidence,{ok:true,missing:[]});assert.equal(result.memory_verified,true);
});
test("terminal PARTIAL or FAILED never triggers a continuation or replaces truthful failure evidence",async()=>{
 for(const status of ["PARTIAL","FAILED"]){
  const e=events();e.push(terminal(status));let asks=0;
  const result=await finishPendingStage(base(e,async()=>{asks++;return turn;}));
  assert.equal(asks,0);assert.equal(result.initial_turn,turn);assert.equal(result.evidence.ok,false);
  assert.equal(pendingStage(stage,e),null);
 }
});
test("lease release alone is never stage success and pending native reads are bounded at six continuations",async()=>{
 const e=events();let asks=0;
 const result=await finishPendingStage(base(e,async()=>{asks++;return turn;}));
 assert.equal(asks,6);assert.equal(result.evidence.ok,false);assert.equal(result.memory_verified,false);
 assert.equal(e.length,2);
});
test("an accepted PENDING without a later state is eligible, but unrelated native IDs and ROS owners fail closed",async()=>{
 const e=events();
 assert.equal(pendingStage(stage,e.slice(0,1))?.id,"owned-inspection");
 e[1].result.inspection.inspection_id="unrelated";
 assert.equal(pendingStage(stage,e),null);
 const plan=pendingStage(stage,events())!;
 await assert.rejects(()=>waitForPendingRelease(plan,()=>({...released(),navigation:{motion_lease:{held:true,owner:{operation_id:"foreign"}}}}),
  new AbortController().signal,Date.now()+600000),/ASYNC_STAGE_OWNER_CHANGED/);
});
