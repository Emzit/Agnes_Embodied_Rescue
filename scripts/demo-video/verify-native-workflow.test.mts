import test from "node:test";
import assert from "node:assert/strict";
import {assertPreflight,assertNativeStop,highConfidencePeople,assertFreeMotionLease} from "./verify-native-workflow.mts";
const now=1791908400000;
const native={status:"FAILED",observer_connected:true,observer_updated_at:new Date(now).toISOString(),pending_approvals:[],pending_inputs:[]};
const ros={ros_domain_id:106,updated_at:now/1000,pose_age_ms:0,pose:{x:0,y:-6.7},velocity:{linear_x:0,linear_y:0,angular_z:0},
 navigation:{status:"IDLE",active_goals:[],motion_lease:{held:false}}};
test("preflight accepts current idle Start and rejects stale, disconnected, busy or moving state",()=>{
 assert.doesNotThrow(()=>assertPreflight(native,ros,now));
 for(const n of [{...native,observer_connected:false},{...native,observer_updated_at:new Date(now-11000).toISOString()},{...native,status:"RUNNING"},{...native,pending_approvals:[{}]}])
  assert.throws(()=>assertPreflight(n,ros,now));
 for(const r of [{...ros,updated_at:now/1000-4},{...ros,ros_domain_id:7},{...ros,pose:{x:3.4,y:-6}},{...ros,velocity:{...ros.velocity,angular_z:.01}},{...ros,navigation:{...ros.navigation,motion_lease:{held:true}}}])
  assert.throws(()=>assertPreflight(native,r,now));
});
const stop={tool:"stop_robot",at:10,event_seq:12,result:{status:"STOPPED",zero_twist_published:true}};
const state={tool:"get_robot_state",at:11,call_seq:13,result:{navigation_active:false,inspection_active:false,motion_owner:null,linear_velocity:0,angular_velocity:0}};
test("final stop needs an actual sequential native stop and later zero state, with no subsequent movement",()=>{
 assert.doesNotThrow(()=>assertNativeStop([stop,state]));
 for(const events of [
  [state],
  [stop,{...state,call_seq:11}],
  [stop,{...state,result:{...state.result,inspection_active:true}}],
  [stop,state,{tool:"navigate_to"}],
  [{...stop,result:{status:"STOPPED",zero_twist_published:false}},state]
 ])assert.throws(()=>assertNativeStop(events),/NATIVE_FINAL_ZERO_STATE_NOT_VERIFIED/);
});
test("high confidence current Agnes person is protected while weak or historical candidates remain unconfirmed",()=>{
 const timestamp={sec:10,nanosec:0},hash="a".repeat(64);
 const person={id:"actual-test-fixture",label:"person",confidence:.06,source:"ros2_camera_perception",timestamp,
  evidence:{method:"vlm",provider:"agnes-ai",model:"agnes-3.0-flash",frame_timestamp:timestamp,frame_sha256:hash}};
 const observation={sensor_status:{camera:true},current_observation:{timestamp,frame_sha256:hash,perception_status:"AVAILABLE",semantic_objects:[person]}};
 assert.equal(highConfidencePeople([{result:observation}]).length,0);
 const high={...person,confidence:.94};
 assert.equal(highConfidencePeople([{result:{...observation,current_observation:{...observation.current_observation,semantic_objects:[high]}}}]).length,1);
 assert.equal(highConfidencePeople([{result:{semantic_objects:[high]}}]).length,0);
});


test("a persistent released lease inode is free; a real advisory owner is held and its metadata is never erased", async () => {
 const fs = await import("node:fs");
 const path = await import("node:path");
 const { spawn } = await import("node:child_process");
 const { once } = await import("node:events");
 const root="/data-ssd/zhongchengkai/agnes/artifacts/tests";
 fs.mkdirSync(root,{recursive:true});
 const temporary=fs.mkdtempSync(path.join(root,"workflow-flock-"));
 const file=path.join(temporary,"lease.lock"),metadata='{"operation_id":"owned-test-fixture"}';
 let holder:any;
 try {
  assert.doesNotThrow(()=>assertFreeMotionLease(file));
  fs.writeFileSync(file,"");
  assert.doesNotThrow(()=>assertFreeMotionLease(file));
  fs.writeFileSync(file,metadata);
  holder=spawn("python3",["-B","-c",
   'import fcntl,sys; f=open(sys.argv[1],"rb"); fcntl.flock(f,fcntl.LOCK_EX); print("HELD",flush=True); sys.stdin.readline(); fcntl.flock(f,fcntl.LOCK_UN); f.close()',file],{stdio:["pipe","pipe","pipe"]});
  await Promise.race([once(holder.stdout,"data"),new Promise((_,reject)=>setTimeout(()=>reject(Error("Fixture lock timeout")),2000))]);
  assert.throws(()=>assertFreeMotionLease(file),/PROJECT_MOTION_LEASE_HELD/);
  assert.equal(fs.readFileSync(file,"utf8"),metadata);
  const released=once(holder,"exit");holder.stdin.end("release\n");await released;
  assert.doesNotThrow(()=>assertFreeMotionLease(file));
  assert.equal(fs.readFileSync(file,"utf8"),metadata);
  assert.throws(()=>assertFreeMotionLease("/tmp/other-directory.lock"),/PROJECT_LEASE_PATH_REQUIRED/);
 } finally {
  if(holder&&holder.exitCode===null)holder.kill();
  assert.ok(fs.realpathSync(temporary).startsWith(root+"/"));
  fs.rmSync(temporary,{recursive:true,force:true});
 }
});
