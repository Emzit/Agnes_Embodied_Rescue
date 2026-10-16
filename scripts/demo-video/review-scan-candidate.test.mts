import {test} from "node:test";
import assert from "node:assert/strict";
import {candidateReviewProof,resumeEvidencePlan} from "./resume-policy.mts";
const hash="a".repeat(64),ts=(sec:number)=>({sec,nanosec:0}),id="visual_real",pose={x:0,y:-6.7,frame_id:"map"};
const candidate={id,label:"person",confidence:.06,source:"ros2_camera_perception",timestamp:ts(10),
 evidence:{provider:"agnes-ai",model:"agnes-3.0-flash",method:"vlm",frame_timestamp:ts(10),frame_sha256:hash}};
const saved={session_id:"same-session"},stage={id:"start"},scan={event_seq:10,result:{inspection:{result:{status:"SUCCEEDED",return_motion:{start_pose:pose},evidence:Array.from({length:8},(_,i)=>({timestamp:ts(10+i)}))}}}};
function fixture(){
 const result={status:"SUCCEEDED",object_id:id,before_confidence:.06,after_confidence:0,still_uncertain:true,detection_count:0,detections:[],
  evidence:[18,19,20].map((sec,i)=>({frame_timestamp:ts(sec),yaw:i*.12,detections:[],
   motion:{status:"SUCCEEDED",xy_drift:0,start_pose:pose,end_pose:pose}}))};
 const e={session_id:"same-session",stage:"start_candidate_review",tool:"inspect_object",args:{object_id:id},result,
  call_seq:20,event_seq:21,tool_call_id:"inspect-real"};
 const events:any[]=[e,
 {session_id:"same-session",stage:"start_candidate_review",tool:"stop_robot",call_seq:22,event_seq:23,result:{status:"STOPPED",zero_twist_published:true}},
 {session_id:"same-session",stage:"start_candidate_review",tool:"get_robot_state",call_seq:24,event_seq:25,result:{
  navigation_active:false,inspection_active:false,motion_owner:null,linear_velocity:0,angular_velocity:0,timestamp:ts(21)}}];
 const native=[
  {seq:20,type:"tool/call",data:{toolUseId:"inspect-real",name:"mcp_robot_mcp_inspect_object",args:{object_id:id}},_meta:{generation:1}},
  {seq:21,type:"tool/result",data:{toolUseId:"inspect-real",content:[{type:"text",text:JSON.stringify(result)}]},_meta:{generation:1}}];
 for(const item of events.slice(1)){
  native.push({seq:item.call_seq,type:"tool/call",data:{toolUseId:"tool-"+item.call_seq,name:"mcp_robot_mcp_"+item.tool,args:{}},_meta:{generation:1}});
  native.push({seq:item.event_seq,type:"tool/result",data:{toolUseId:"tool-"+item.call_seq,content:[{type:"text",text:JSON.stringify(item.result)}]},_meta:{generation:1}});
  item.tool_call_id="tool-"+item.call_seq;item.args={};
 }
 return {events,native,result};
}
const sync=(f:ReturnType<typeof fixture>)=>{for(const e of f.events){const n=f.native.find(v=>v.seq===e.event_seq);if(n?.data.content)n.data.content[0].text=JSON.stringify(e.result);}};
test("three real new empty views leave the original weak candidate unconfirmed, never claim area empty",()=>{
 const f=fixture(),p=candidateReviewProof(saved,stage,candidate,scan,f.events,f.native);
 assert.equal(p?.status,"UNCONFIRMED_AVAILABLE");assert.equal(p?.area_empty_claimed,false);assert.equal(p?.original_candidate_preserved,true);
});
test("absence of review or original strong person never allows resume",()=>{
 const f=fixture();assert.equal(candidateReviewProof(saved,stage,candidate,scan,[],f.native),null);
 assert.equal(candidateReviewProof(saved,stage,{...candidate,confidence:.94},scan,f.events,f.native),null);
});
test("invented event JSON cannot pass without matching native call and result ledger",()=>{
 const f=fixture();assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,[]),null);
 f.native[0].data.args!.object_id="different";assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,f.native),null);
});
test("wrong candidate, mismatched before confidence, partial result or unavailable/stale motion rejects",()=>{
 for(const mutate of [
  (f:any)=>{f.result.object_id="different";},(f:any)=>{f.result.before_confidence=.5;},
  (f:any)=>{f.result.status="PARTIAL";},(f:any)=>{f.result.evidence[1].motion.status="FAILED";},
  (f:any)=>{f.result.evidence[1].frame_timestamp=ts(10);},(f:any)=>{f.result.evidence[2].frame_timestamp=ts(19);},
  (f:any)=>{f.result.evidence[1].motion.xy_drift=.21;},(f:any)=>{f.result.evidence[0].motion.start_pose={...pose,x:1};},
  (f:any)=>{f.result.still_uncertain=false;},(f:any)=>{f.events[2].result.inspection_active=true;},
  (f:any)=>{f.events[0].session_id="another";} ]){
  const f=fixture();mutate(f);sync(f);assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,f.native),null);
 }
});
test("unproven positive detections cannot masquerade as a complete available candidate review",()=>{
 const f=fixture();f.result.evidence[0].detections=[{id:"fake",label:"person"}] as any;sync(f);
 assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,f.native),null);
});

test("resume uses real reviewed uncertainty but refuses missing native review, wrong session and confirmed person",()=>{
 const f=fixture(),run="guided-demo-123",session="same-session",op="scan-real";
 const start={tool:"inspect_room",stage:"start",args:{location:"Start"},call_seq:1,event_seq:2,
  result:{status:"PENDING",accepted:true,room:"Start",inspection_id:op,terminal_known:false,required_views:8}};
 const completed:any={...scan,stage:"start",tool:"get_robot_state",result:{inspection:{inspection_id:op,terminal_known:true,active:false,result:{
  ...scan.result.inspection.result,inspection_id:op,room:"Start",rotation_complete:true,scan_views:8,
  return_motion:{status:"SUCCEEDED",control_frame:"odom",start_pose:pose},
  rotation_evidence:{control_frame:"odom",start_yaw:0,end_yaw:0,measured_radians:Math.PI*2,requested_radians:Math.PI*2,max_xy_drift_m:0},
  detections:[candidate],evidence:Array.from({length:8},(_,i)=>({timestamp:ts(10+i),frame_sha256:i.toString(16).padStart(64,"0"),
   perception_status:"AVAILABLE",motion_status:"SUCCEEDED",yaw:i*Math.PI/4,odom_yaw:i*Math.PI/4}))
 }}}};
 const savedRun={run_id:run,session_id:session,stage:"start",status:"NEEDS_REVIEW",stop_verification:{verified:true}};
 const plan={run_id:run,session_id:session},events=[start,completed,...f.events];
 assert.throws(()=>resumeEvidencePlan(savedRun,plan,events),/RESUME_PERSON_PRESENT_REVIEW/);
 assert.equal(resumeEvidencePlan(savedRun,plan,events,f.native).skipCurrent,true);
 const wrong=structuredClone(events);wrong[2].session_id="other";
 assert.throws(()=>resumeEvidencePlan(savedRun,plan,wrong,f.native),/RESUME_PERSON_PRESENT_REVIEW/);
});
test("forged stopped state without corresponding native stop and state events cannot enable resume",()=>{
 const f=fixture();assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,f.native.slice(0,2)),null);
});

test("a real high-confidence confirmation stops the review and cannot use the uncertain-candidate resume exception",()=>{
 const f=fixture();
 const person=(sec:number)=>({...candidate,id:"new-"+sec,confidence:.9,timestamp:ts(sec),
  evidence:{...candidate.evidence,frame_timestamp:ts(sec),frame_sha256:sec.toString(16).padStart(64,"0")}});
 const first=person(18),second=person(19);
 f.result.detection_count=2;f.result.detections=[first,second] as any;f.result.after_confidence=.9;f.result.still_uncertain=false;
 f.result.evidence[0].detections=[first] as any;f.result.evidence[1].detections=[second] as any;sync(f);
 assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,f.native),null);
 assert.equal(candidateReviewProof(saved,stage,candidate,scan,f.events,f.native,true)?.status,"CONFIRMED_STOP");
});

test("the same native guarded review also supports middle_scan without rewriting its original proof",()=>{
 const f=fixture(),middle={id:"middle_scan",scan:"Main_Corridor"};
 for(const e of f.events)e.stage="middle_scan_candidate_review";
 const original=structuredClone(scan);original.result.inspection.result.room="Main_Corridor";
 assert.equal(candidateReviewProof(saved,middle,candidate,original,f.events,f.native)?.status,"UNCONFIRMED_AVAILABLE");
 assert.equal(candidateReviewProof(saved,{id:"near"},candidate,original,f.events,f.native),null);
});
