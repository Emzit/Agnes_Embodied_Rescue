import assert from "node:assert/strict";
import fs from "node:fs";
import {resumeEvidencePlan,validateResumeRecording,allowResumeObservation,allowResumeFrontEntry} from "./resume-policy.mts";
const ROOT="/data-ssd/zhongchengkai/agnes",dir=ROOT+"/artifacts/demo-video-20261013/runs/guided-demo-1791886895805";
const read=(f:string)=>JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));
const actualSaved=read("state.json"),plan=read("plan.json"),actualEvents=fs.readFileSync(dir+"/tool-results.jsonl","utf8").trim().split("\n").map(x=>JSON.parse(x));
const saved={...actualSaved,stage:"near"},events=[...actualEvents.filter(e=>e.stage==="start"),...read("stage-near.json").events];
const checks:any[]=[];
function test(name:string,f:()=>void){f();checks.push({name,status:"PASS"});}
test("actual verified post-open frame completes the near stage without redundant recognition",()=>{
 const result=resumeEvidencePlan(saved,plan,events);
 assert.equal(result.index,1);assert.equal(result.observationOnly,false);assert.equal(result.skipCurrent,true);assert.equal(result.checks[0].evidence.ok,true);
});
test("near continuation still obtains fresh vision if the returned post-open frame is invalid",()=>{
 const stale=structuredClone(events);stale.find(e=>e.stage==="near"&&e.tool==="open_door")!.result.verification.fresh_camera_observation.perception_status="UNAVAILABLE";
 const result=resumeEvidencePlan(saved,plan,stale);
 assert.equal(result.observationOnly,true);assert.equal(result.skipCurrent,false);
});
test("missing navigation, door inspection or door-open proof never permits replay or automatic resume",()=>{
 for(const tool of ["navigate_to","inspect_door","open_door"]){
  assert.throws(()=>resumeEvidencePlan(saved,plan,events.filter(e=>e.stage!=="near"||e.tool!==tool)),/RESUME_REQUIRES_REVIEW/);
 }
});
test("a failed earlier stage prevents continuation",()=>{
 assert.throws(()=>resumeEvidencePlan(saved,plan,events.filter(e=>e.stage!=="start")) ,/RESUME_PRIOR_STAGE_EVIDENCE_MISSING/);
});
test("run/session mismatches and absent verified stop fail closed",()=>{
 assert.throws(()=>resumeEvidencePlan({...saved,session_id:"other"},plan,events),/RESUME_IDENTITY/);
 assert.throws(()=>resumeEvidencePlan({...saved,stop_verification:null},plan,events),/VERIFIED_SAFE_STOP/);
});
test("observation repair tool scope refuses all navigation, door actuation, resets and scans",()=>{
 assert.equal(allowResumeObservation("get_world_state"),true);
 for(const tool of ["navigate_to","inspect_door","open_door","mission_reset","inspect_room","inspect_object","shell"])assert.equal(allowResumeObservation(tool),false);
});
test("actual front partial evidence resumes with observation then only room entry, never another door operation",()=>{
 const result=resumeEvidencePlan(actualSaved,plan,actualEvents);
 assert.equal(result.index,4);assert.equal(result.frontContinuation,true);assert.equal(result.observationOnly,true);
 assert.deepEqual(result.checks.at(-1)?.evidence.missing,["navigation:Right_Front_Room"]);
 const front=actualEvents.filter(e=>e.stage==="front");
 assert.equal(allowResumeFrontEntry("navigate_to",{location:"Right_Front_Room"},front),true);
 for(const tool of ["inspect_door","open_door","inspect_room","inspect_object","mission_reset","shell"])
  assert.equal(allowResumeFrontEntry(tool,{door_id:"Right_Front_Door"},front),false);
 assert.equal(allowResumeFrontEntry("navigate_to",{location:"Right_Front_Door_interaction"},front),false);
 assert.equal(allowResumeFrontEntry("get_world_state",{},front),true);
});
test("front continuation rejects incomplete original navigation/inspection/door opening proof",()=>{
 for(const tool of ["navigate_to","inspect_door","open_door"])
  assert.throws(()=>resumeEvidencePlan(actualSaved,plan,actualEvents.filter(e=>e.stage!=="front"||e.tool!==tool)),/RESUME_REQUIRES_REVIEW/);
});
const now=Date.now(),approval={authorized:true,run_id:saved.run_id,session_id:saved.session_id,expires_at:new Date(now+60000).toISOString()};
const meta={id:"8aabeb2d-779b-4893-8bf2-4ae6ddf39a0d",status:"RECORDING",source:"user_selected_browser_display_capture",started_at:new Date(now-1000).toISOString(),updated_at:new Date(now).toISOString(),chunk_count:1,limits:{maxSeconds:1200}};
test("fresh replacement recording is allowed only for matching unexpired human approval",()=>{
 assert.equal(validateResumeRecording(meta,approval,saved.run_id,saved.session_id,now).recordingId,meta.id);
 assert.throws(()=>validateResumeRecording(meta,{...approval,session_id:"other"},saved.run_id,saved.session_id,now),/APPROVAL_INVALID/);
 assert.throws(()=>validateResumeRecording(meta,{...approval,expires_at:new Date(now-1).toISOString()},saved.run_id,saved.session_id,now),/APPROVAL_INVALID/);
});
test("completed, zero-chunk, stale or expired recording cannot resume a route",()=>{
 for(const extra of [{status:"COMPLETE"},{chunk_count:0},{updated_at:new Date(now-16000).toISOString()}])assert.throws(()=>validateResumeRecording({...meta,...extra},approval,saved.run_id,saved.session_id,now),/LIVE_RECORDING/);
 assert.throws(()=>validateResumeRecording({...meta,started_at:new Date(now-1201000).toISOString()},approval,saved.run_id,saved.session_id,now),/RECORDING_EXPIRED/);
});
// Read-only real formal-run baseline; negative cases clone it and never alter logs.
const formalDir=ROOT+"/artifacts/demo-video-20261013/runs/guided-demo-1791910728138";
const formalRead=(file:string)=>JSON.parse(fs.readFileSync(formalDir+"/"+file,"utf8"));
// Keep the actually observed source-2 cutoff as the regression baseline even
// after a later recording appends successful confirmation evidence.
const formalStop=fs.readFileSync(formalDir+"/emergency-stop.jsonl","utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line))
 .find(e=>e.at>=1791913684000&&e.at<=1791913686000)?.result;
assert.equal(formalStop?.verified,true);
const formalSaved={...formalRead("state.json"),status:"NEEDS_REVIEW",stage:"confirm",error:"CANCELED",stop_verification:formalStop};
const formalPlan=formalRead("plan.json");
const formalEvents=fs.readFileSync(formalDir+"/tool-results.jsonl","utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line)).filter(e=>e.event_seq<=1319);
const formalNative=fs.readFileSync(formalDir+"/native-events.jsonl","utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line)).filter(e=>e.seq<=1334);
test("actual entered-room fresh empty view permits confirmation continuation without skipping unfinished work",()=>{
 const result=resumeEvidencePlan(formalSaved,formalPlan,formalEvents,formalNative);
 assert.equal(result.index,5);assert.equal(result.confirmationContinuation,true);assert.equal(result.skipCurrent,false);
 assert.equal(result.observationOnly,false);assert.equal(result.frontContinuation,false);
 const realRoomScan=formalEvents.findLast(e=>e.stage==="confirm"&&e.tool==="get_robot_state"&&
  e.result?.inspection?.result?.status==="SUCCEEDED"&&e.result.inspection.result.room==="Right_Front_Room");
 if(realRoomScan){
  assert.equal(result.confirmation_scan_required,false);
  assert.equal(result.reusable_confirmation_scan?.inspection_id,realRoomScan.result.inspection.inspection_id);
  assert.equal(result.reusable_confirmation_scan?.native_event_seq,realRoomScan.event_seq);
  assert.ok(result.reusable_confirmation_scan?.person_ids.includes("visual_b3cf3c6efb468a39"));
 }
 assert.deepEqual(result.forbidden_continuation_actions,["navigate_to","inspect_door","open_door","mission_reset"]);
});
test("confirmation resume refuses absent or unavailable current room camera and cannot use the earlier doorway person",()=>{
 for(const change of [
  (events:any[])=>events.filter(e=>!(e.stage==="confirm"&&e.tool==="get_world_state")),
  (events:any[])=>{events.findLast(e=>e.stage==="confirm"&&e.tool==="get_world_state").result.current_location="Right_Front_Door_interaction";return events;},
  (events:any[])=>{events.findLast(e=>e.stage==="confirm"&&e.tool==="get_world_state").result.sensor_status.camera=false;return events;},
  (events:any[])=>{events.findLast(e=>e.stage==="confirm"&&e.tool==="get_world_state").result.current_observation.perception_status="UNAVAILABLE";return events;},
  (events:any[])=>{events.findLast(e=>e.stage==="confirm"&&e.tool==="get_world_state").call_seq=1;return events;},
 ]){
  assert.throws(()=>resumeEvidencePlan(formalSaved,formalPlan,change(structuredClone(formalEvents)),formalNative),/RESUME_REQUIRES_REVIEW/);
 }
});
test("confirmation resume keeps complete prior Front entry and fresh inside-view requirements",()=>{
 const broken=formalEvents.filter(e=>!(e.stage==="front"&&e.tool==="navigate_to"&&e.args?.location==="Right_Front_Room"));
 assert.throws(()=>resumeEvidencePlan(formalSaved,formalPlan,broken,formalNative),/RESUME_PRIOR_STAGE_EVIDENCE_MISSING:front/);
 assert.throws(()=>resumeEvidencePlan({...formalSaved,stop_verification:{verified:false}},formalPlan,formalEvents,formalNative),/VERIFIED_SAFE_STOP/);
});
test("a real accepted room scan ending PARTIAL cannot become a confirmation restart exception",()=>{
 const events=structuredClone(formalEvents),seq=Math.max(...events.map(e=>e.event_seq??0))+1;
 events.push({stage:"confirm",tool:"inspect_room",args:{location:"Right_Front_Room"},call_seq:seq,event_seq:seq+1,
  result:{status:"PENDING",accepted:true,inspection_id:"failed-test-fixture",room:"Right_Front_Room"}});
 events.push({stage:"confirm",tool:"get_robot_state",args:{},call_seq:seq+2,event_seq:seq+3,
  result:{inspection:{inspection_id:"failed-test-fixture",terminal_known:true,result:{status:"PARTIAL"}}}});
 assert.throws(()=>resumeEvidencePlan(formalSaved,formalPlan,events,formalNative),/RESUME_REQUIRES_REVIEW/);
});
const result={kind:"ISOLATED_RESUME_GATE_TESTS_NO_MODEL_NO_MOTION",pass:true,at:new Date().toISOString(),tests:checks};
fs.writeFileSync(ROOT+"/artifacts/demo-video-20261013/resume-tests.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));
