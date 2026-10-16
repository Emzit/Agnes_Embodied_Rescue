import assert from "node:assert/strict";
import test from "node:test";
import {createStopOwnedMotion} from "./stop-owned-motion.mts";
const owner={operation_id:"inspect-run",pid:42,bridge_instance_id:"bridge-42"};
function rig(){
  let now=100000,phase=0,liveOwner:any=owner,release=false,stale=false,moving=false;
  const requests:any[]=[];
  const ros=()=>({ros_domain_id:106,updated_at:stale?1:now/1000,pose_age_ms:0,
    velocity:{linear_x:moving ? .1 : 0,linear_y:0,angular_z:0},
    navigation:{status:"IDLE",active_goals:[],motion_lease:{held:!release,owner:release?null:liveOwner}}});
  const run=createStopOwnedMotion({
    now:()=>now,sleep:async(ms)=>{now+=ms;phase++;},
    read:async(file)=>file.endsWith("ros-state.json")?ros():release?null:liveOwner,
    writeRequest:async(r)=>{requests.push(r);},
    readAck:async(id)=>requests.length?{source:"actual_motion_owner_stop",request_id:id,run_id:"demo-run",
      ...owner,result:{status:"PENDING",cancel_status:"ACCEPTED_PENDING"}}:null,
    id:()=>"request-"+requests.length,
  });
  return {run,requests,setOwner:(x:any)=>{liveOwner=x;},setRelease:(x:boolean)=>{release=x;},
    setStale:(x:boolean)=>{stale=x;},setMoving:(x:boolean)=>{moving=x;},get phase(){return phase;}};
}
test("unknown operation is refused without writing any stop request",async()=>{
  const r=rig(),out=await r.run({runId:"demo-run",operationIds:["other"],timeoutMs:1000});
  assert.equal(out.reason,"OWNER_NOT_IN_RUN");assert.equal(r.requests.length,0);
});
test("already idle is verified without writing a request",async()=>{
  const r=rig();r.setRelease(true);
  assert.equal((await r.run({runId:"demo-run",operationIds:[],timeoutMs:1000})).verified,true);
  assert.equal(r.requests.length,0);
});
test("matching owner gets scoped request but zero/lease confirmation is still mandatory",async()=>{
  const r=rig(),out=await r.run({runId:"demo-run",operationIds:[owner.operation_id],timeoutMs:1000});
  assert.equal(out.verified,false);assert.equal(out.status,"PENDING");assert.equal(r.requests.length,1);
  assert.equal(r.requests[0].pid,42);assert.equal(r.requests[0].operation_id,owner.operation_id);
  assert.ok(r.requests[0].expires_at-r.requests[0].issued_at<=15);
});
test("stale ROS state is refused without any write",async()=>{
  const r=rig();r.setStale(true);
  assert.equal((await r.run({runId:"demo-run",operationIds:[owner.operation_id],timeoutMs:1000})).reason,"FRESH_ROS_REQUIRED");
  assert.equal(r.requests.length,0);
});
test("released lease with nonzero velocity never verifies stop",async()=>{
  const r=rig();r.setRelease(true);r.setMoving(true);
  const out=await r.run({runId:"demo-run",operationIds:[owner.operation_id],timeoutMs:1000});
  assert.equal(out.verified,false);assert.equal(r.requests.length,0);
});
test("owner ack followed by fresh zero/idle/released state verifies the real stop",async()=>{
  let now=100000,issued:any=null,ackRead=false;
  const run=createStopOwnedMotion({
    now:()=>now,sleep:async(ms)=>{now+=ms;},id:()=>"request-ok",
    read:async(file)=>file.endsWith("ros-state.json")?{ros_domain_id:106,updated_at:now/1000,pose_age_ms:0,
      velocity:{linear_x:0,linear_y:0,angular_z:0},navigation:{status:"IDLE",active_goals:[],
        motion_lease:{held:!ackRead,owner:ackRead?null:owner}}}:ackRead?null:owner,
    writeRequest:async(r)=>{issued=r;},
    readAck:async(id)=>{ackRead=true;return {source:"actual_motion_owner_stop",request_id:id,run_id:"demo-run",
      ...owner,result:{status:"STOPPED",stopped:true,zero_twist_published:true}};},
  });
  const out=await run({runId:"demo-run",operationIds:[owner.operation_id],timeoutMs:1000});
  assert.equal(out.verified,true);assert.equal(out.status,"STOPPED_BY_OWNER");assert.equal(issued.operation_id,owner.operation_id);
});
