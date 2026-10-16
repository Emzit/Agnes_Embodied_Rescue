/** Recorded native-session review of one real Start scan candidate; never changes the route. */
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import {baseTool,normalized,freshPeople,stageEvidence,stages,stopped,frameTime} from "./demo-policy.mts";
import {validateResumeRecording,candidateReviewProof} from "./resume-policy.mts";
import {stopOwnedMotion} from "./stop-owned-motion.mts";
const ROOT="/data-ssd/zhongchengkai/agnes";
if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
const args=process.argv.slice(2),arg=(name:string)=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const RUN=arg("--run")??"guided-demo-1791902640008",requestedCandidate=arg("--candidate");
if(!/^guided-demo-\d+$/.test(RUN))throw Error("VALID_RUN_ID_REQUIRED");
if(requestedCandidate&&!/^visual_[a-f0-9]{16}$/.test(requestedCandidate))throw Error("VALID_VISUAL_CANDIDATE_ID_REQUIRED");
const OUT=ROOT+"/artifacts/demo-video-20261013",DIR=OUT+"/runs/"+RUN,UI=ROOT+"/artifacts/demo-ui-final";
const recordingId=arg("--recording")??JSON.parse(fs.readFileSync(DIR+"/recording.json","utf8")).id;
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(recordingId??""))throw Error("REAL_RECORDING_UUID_REQUIRED");
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const lines=(p:string)=>fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l));
const save=(p:string,v:any)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n");
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const ATTEMPT=Date.now(),REVIEW=DIR+"/candidate-review-"+ATTEMPT;fs.mkdirSync(REVIEW,{recursive:true});
const append=(name:string,v:any)=>fs.appendFileSync(REVIEW+"/"+name,JSON.stringify(v)+"\n");
const saved=read(DIR+"/state.json"),plan=read(DIR+"/plan.json"),approval=read(DIR+"/human-approval.json");
const SESSION=saved.session_id,STAGE=arg("--stage")??saved.stage;
if(!["start","middle_scan"].includes(STAGE)||STAGE!==saved.stage)throw Error("LEGAL_CURRENT_SCAN_STAGE_REQUIRED");
const scanStage=stages.find(s=>s.id===STAGE)!;
const savedScanStage=plan.stages?.find((s:any)=>s.id===STAGE);
if(savedScanStage?.scan!==scanStage.scan)throw Error("ORIGINAL_PLAN_SCAN_STAGE_REQUIRED");
const reviewStage=STAGE+"_candidate_review";
if(saved.run_id!==RUN||plan.run_id!==RUN||typeof SESSION!=="string"||!SESSION||plan.session_id!==SESSION||!["start","middle_scan"].includes(saved.stage)||saved.status!=="NEEDS_REVIEW"||saved.stop_verification?.verified!==true)throw Error("ORIGINAL_RUN_STOP_REVIEW_REQUIRED");
const history=lines(DIR+"/tool-results.jsonl"),nativeHistory=lines(DIR+"/native-events.jsonl");
const startEvents=history.filter(e=>e.stage===STAGE);
if(!stageEvidence(scanStage,startEvents).ok)throw Error("ORIGINAL_SCAN_STAGE_INCOMPLETE");
const seen=new Map<string,{candidate:any;original:any}>();
for(const e of startEvents){
 const result=e.result?.inspection?.result;
 if(result?.status!=="SUCCEEDED"||result.room!==scanStage.scan)continue;
 for(const d of freshPeople(result))if(typeof d.id==="string"&&d.confidence>=0&&d.confidence<.8)
  seen.set(d.id,{candidate:d,original:e});
}
if(requestedCandidate&&!seen.has(requestedCandidate))throw Error("REQUESTED_CANDIDATE_NOT_IN_REAL_COMPLETED_SCAN_STAGE");
if(!requestedCandidate&&seen.size!==1)throw Error("UNIQUE_REAL_WEAK_CANDIDATE_OR_EXPLICIT_ID_REQUIRED");
const ID=requestedCandidate??[...seen.keys()][0],{candidate,original}=seen.get(ID)!;
const scan=original.result.inspection.result;
if(!candidate||scan.status!=="SUCCEEDED")throw Error("EXACT_REAL_WEAK_CANDIDATE_REQUIRED");
const recordedPose=scan.return_motion?.start_pose;
if(!Number.isFinite(recordedPose?.x)||!Number.isFinite(recordedPose?.y)||recordedPose.frame_id!=="map"||
 !Number.isFinite(scan.rotation_evidence?.max_xy_drift_m)||scan.rotation_evidence.max_xy_drift_m>.2)throw Error("SCAN_POSE_PROXY_UNAVAILABLE");
const cursor=nativeHistory.findLast(e=>Number.isInteger(e.seq)&&Number.isInteger(e._meta?.generation));
if(!cursor)throw Error("NATIVE_CURSOR_REQUIRED");
const bound=read(DIR+"/recording.json");
for(const name of fs.readdirSync(OUT+"/runs")){
 if(name===RUN||!/^guided-demo-\d+$/.test(name))continue;
 const file=OUT+"/runs/"+name+"/recording.json";
 if(fs.existsSync(file)&&read(file).id===recordingId)throw Error("RECORDING_BOUND_TO_ANOTHER_RUN");
}
const metaPath=OUT+"/recordings/"+recordingId+"/metadata.json";
const approvalGood=()=>{const a=read(DIR+"/human-approval.json");return a.authorized===true&&a.run_id===RUN&&a.session_id===SESSION&&Date.parse(a.expires_at)>Date.now();};
function preflight(){
 const r=read(UI+"/ros-state.json");
 if(!Number.isFinite(r.updated_at)||Date.now()/1000-r.updated_at<0||Date.now()/1000-r.updated_at>3||
  !Number.isFinite(r.pose_age_ms)||r.pose_age_ms>2500||r.navigation?.status!=="IDLE"||
  r.navigation?.motion_lease?.held!==false||!Array.isArray(r.navigation.active_goals)||r.navigation.active_goals.length||
  !["linear_x","linear_y","angular_z"].every(k=>Number.isFinite(r.velocity?.[k])&&Math.abs(r.velocity[k])<.001)||
  !Number.isFinite(r.pose?.x)||!Number.isFinite(r.pose?.y)||Math.hypot(r.pose.x-recordedPose.x,r.pose.y-recordedPose.y)>=.5)
  throw Error("FRESH_IDLE_NEAR_RECORDED_SCAN_REQUIRED");
 // This reusable lock inode can exist while free; check the advisory lock itself.
 if(fs.existsSync(ROOT+"/runtime/motion-control.lock")){
  try{execFileSync("python3",["-B","-c","import fcntl,sys; f=open(sys.argv[1],\"rb\"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); fcntl.flock(f,fcntl.LOCK_UN); f.close()",ROOT+"/runtime/motion-control.lock"],{cwd:ROOT,stdio:"pipe"});}
  catch{throw Error("FREE_LEASE_REQUIRED");}
 }
 return r;
}
save(REVIEW+"/original-candidate.json",{run_id:RUN,session_id:SESSION,candidate,scan_event_seq:original.event_seq,
 preflight_pose_source:"real scan return_motion.start_pose; proxy justified by bounded continuous odom drift, not original object.view_pose",
 recorded_scan_pose:recordedPose,bridge_guard:"actual object.view_pose distance <= 0.5m is enforced by bridge before any successful inspect_object"});
// Shared validator accepts the real recorder lifetime (<= 20 minutes), with fresh uploads.
let meta:any;const deadline=Date.now()+10*60*1000;
while(Date.now()<deadline){try{meta=read(metaPath);validateResumeRecording(meta,approval,RUN,SESSION);if(meta.id===recordingId&&approvalGood())break;meta=null;}catch{meta=null;}await sleep(500);}
if(!meta)throw Error("LIVE_RECORDING_NOT_READY");
save(REVIEW+"/recording.json",{...meta,reused_current_run_recording:bound.id===recordingId});save(REVIEW+"/preflight.json",preflight());
const owner=read(ROOT+"/.agh-home-step7/data/daemon/owner.json");
const client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
const calls=new Map<string,any>(),events:any[]=[],native:any[]=[],operationIds=new Set<string>();
let session:any,iterator:any,collector:any,issued=false,closed=false,watchdog:any,watching=false;
const controller=new AbortController();
async function permission(r:any,context:any){
 const name=baseTool(String(r.toolCall?._meta?.["ai.agnes.harness"]?.tool||String(r.toolCall?.title||"").split(" ")[0]));
 let raw=r.toolCall?.rawInput;try{if(typeof raw==="string")raw=JSON.parse(raw);}catch{raw={};}
 const input=raw?.arguments??raw?.args??raw??{};
 let allow=r.sessionId===SESSION&&!closed&&!context.signal.aborted&&approvalGood();
 if(allow){
  try{validateResumeRecording(read(metaPath),approval,RUN,SESSION);}catch{allow=false;}
 }
 if(allow&&name==="inspect_object"){
  const state=events.findLast(e=>e.tool==="get_robot_state")?.result;
  allow=!issued&&Object.keys(input).length===1&&input.object_id===ID&&stopped(state);
  if(allow){try{preflight();}catch{allow=false;}}
  if(allow)issued=true;
 }else if(allow)allow=["get_robot_state","stop_robot"].includes(name)&&Object.keys(input).length===0;
 append("permission-decisions.jsonl",{at:Date.now(),session_id:SESSION,stage:reviewStage,tool:name,args:input,allowed:allow,
  scope:"read state, one original weak-candidate inspect_object, stop; no navigation, reset, memory write or scoring"});
 return {verdict:allow?"allowed-once":"rejected"} as any;
}
async function cancel(reason:string){
 if(closed)return;closed=true;controller.abort();await session?.cancel().catch(()=>{});
 const stop=await stopOwnedMotion({runId:RUN,operationIds,timeoutMs:130000}).catch(e=>({verified:false,error:String(e)}));
 save(REVIEW+"/failure.json",{reason,stop_verification:stop,at:new Date().toISOString()});
}
try{
 await client.initialize();const cfg=await client.config.get();
 if(cfg.provider?.id!=="agnes-ai"||cfg.provider?.model!=="agnes-3.0-flash")throw Error("AGNES_PROVIDER_REQUIRED");
 const current=read(UI+"/native-session-state.json");
 if(current.status==="RUNNING"||current.pending_approvals?.length||current.pending_inputs?.length)throw Error("NATIVE_SESSION_BUSY");
 session=await client.session.load(SESSION,{cwd:ROOT,onPermissionRequest:permission});
 await session.attach({cursor:{fromSeq:cursor.seq,generation:cursor._meta.generation}});
 save(UI+"/native-session-target.json",{session_id:SESSION,reason:"Recorded bounded review of original low-confidence scan candidate",updated_at:new Date().toISOString()});
 iterator=session.events()[Symbol.asyncIterator]();
 collector=(async()=>{for(;;){
  const next=await iterator.next();if(next.done)break;const e=next.value;if(e.seq<=cursor.seq)continue;
  native.push(e);append("native-events.jsonl",e);
  if(e.type==="tool/call"){
   const tool=baseTool(e.data.name??"");calls.set(e.data.toolUseId,{tool_call_id:e.data.toolUseId,call_at:Date.now(),call_seq:e.seq,tool,args:e.data.args??{}});
   if(!["get_robot_state","inspect_object","stop_robot"].includes(tool)){await cancel("ACTOR_SCOPE_EXPANDED:"+tool);break;}
  }
  if(e.type==="tool/result"){
   const call=calls.get(e.data.toolUseId)??{},result=normalized(e.data.result??e.data.content??e.data);
   const item={at:Date.now(),event_seq:e.seq,session_id:SESSION,stage:reviewStage,...call,result};
   events.push(item);append("tool-results.jsonl",item);
  }
 }})().catch(e=>cancel("EVENT_STREAM_FAILED:"+String(e)));
 watchdog=setInterval(async()=>{
  if(watching||closed)return;watching=true;
  try{
   validateResumeRecording(read(metaPath),approval,RUN,SESSION);if(!approvalGood())throw Error("APPROVAL_EXPIRED");
   if(issued&&fs.existsSync(ROOT+"/runtime/motion-control.lock")){
    const leaseText=fs.readFileSync(ROOT+"/runtime/motion-control.lock","utf8").trim();
    if(leaseText){
     const lease=JSON.parse(leaseText);
     if(typeof lease.operation_id==="string"&&lease.operation_id.startsWith("inspect-"))operationIds.add(lease.operation_id);
    }
   }
  }catch(e){await cancel("RECORDING_OR_APPROVAL_INTERRUPTED:"+String(e));}finally{watching=false;}
 },1000);
 const prompt="本次是同一录制演示的受限证据复核，原"+scanStage.label+"8视角扫描和任务记忆已经完成，保留全部真实记录。"+
 "该scan帧中 Agnes 给出了弱person候选 "+ID+"，confidence="+candidate.confidence+"；它不是已确认人员，也不是当前前向视图。"+
 "本turn仅依次调用：get_robot_state（确认空闲零速度）；inspect_object {object_id:"+JSON.stringify(ID)+"} 一次，原地转向该线索并取得实际新相机多视图；stop_robot；get_robot_state确认零速度释放运动。"+
 "禁止navigate_to、inspect_room、任何门操作、mission_reset、world_memory_update、decision_score_candidates、shell或文件工具；不扩大权限、不因默认Skill扩展任务。"+
 "若inspect_object真实SUCCEEDED、3视角完成且still_uncertain=true，简短报告“低置信线索复核未确认，保留不确定性”，不能宣称原线索不存在或整个区域无人；"+
 "若still_uncertain=false并有至少2张真person新帧且高置信，报告确实发现人员并停止；PARTIAL或识别失败报告无法复核。"+
 "完成上述限定调用后直接结束本turn，等待下一阶段；不要重复扫描、不要继续导航，不以历史结果代替新图像。";
 save(REVIEW+"/prompt.json",{session_id:SESSION,text:prompt,at:new Date().toISOString(),recording_id:recordingId});
 const turn=await session.prompt(prompt,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(360000)]),titleLocale:"zh-CN"});
 await sleep(350);if(closed)throw Error("REVIEW_INTERRUPTED");
 const proof=candidateReviewProof(saved,scanStage,candidate,original,[...history,...events],native,true);
 if(!proof)throw Error("REVIEW_COMPLETE_EVIDENCE_REQUIRED");
 if(turn.reason!=="completed"||turn.stopReason!=="end_turn")throw Error("REVIEW_NATIVE_TURN_NOT_COMPLETED");
 save(REVIEW+"/result.json",{status:proof.status,session_id:SESSION,run_id:RUN,recording_id:recordingId,
  candidate,proof,turn,area_empty_claimed:false,original_candidate_preserved:true,at:new Date().toISOString()});
 console.log(JSON.stringify({directory:REVIEW,status:proof.status,original_run_unchanged:true}));
}catch(e){await cancel(String(e));throw e;}
finally{
 closed=true;clearInterval(watchdog);await iterator?.return?.();await collector?.catch(()=>{});
 await session?.detach();await client.close();
}
