/** Add missing native stop/state evidence to one actual recorded candidate review. */
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import {baseTool,normalized,stages,stopped,frameTime} from "./demo-policy.mts";
import {candidateReviewProof,validateResumeRecording} from "./resume-policy.mts";
const ROOT="/data-ssd/zhongchengkai/agnes",OUT=ROOT+"/artifacts/demo-video-20261013",UI=ROOT+"/artifacts/demo-ui-final";
if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
const argv=process.argv.slice(2),arg=(name:string)=>{const i=argv.indexOf(name);return i<0?null:argv[i+1];};
const requested=arg("--review"),recording=arg("--recording");
if(!requested||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(recording??""))
 throw Error("Use --review <actual candidate-review directory> --recording <new real UUID>");
const REVIEW=path.resolve(ROOT,requested),match=REVIEW.match(/^\/data-ssd\/zhongchengkai\/agnes\/artifacts\/demo-video-20261013\/runs\/(guided-demo-\d+)\/candidate-review-\d+$/);
if(!match||fs.realpathSync(REVIEW)!==REVIEW)throw Error("ACTUAL_PROJECT_REVIEW_DIRECTORY_REQUIRED");
const RUN=match[1],DIR=OUT+"/runs/"+RUN;
const read=(file:string)=>JSON.parse(fs.readFileSync(file,"utf8"));
const lines=(file:string)=>fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l));
const save=(file:string,v:any)=>fs.writeFileSync(REVIEW+"/"+file,JSON.stringify(v,null,2)+"\n");
const append=(file:string,v:any)=>fs.appendFileSync(REVIEW+"/"+file,JSON.stringify(v)+"\n");
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const saved=read(DIR+"/state.json"),plan=read(DIR+"/plan.json"),original=read(REVIEW+"/original-candidate.json"),source1=read(REVIEW+"/recording.json");
const SESSION=original.session_id,stage=stages.find(s=>s.id===saved.stage);
if(!stage||!["start","middle_scan"].includes(stage.id)||saved.run_id!==RUN||saved.session_id!==SESSION||
 plan.session_id!==SESSION||original.run_id!==RUN||saved.status!=="NEEDS_REVIEW"||saved.stop_verification?.verified!==true)
 throw Error("ORIGINAL_SAFE_STOPPED_SCAN_REVIEW_REQUIRED");
if(recording===source1.id)throw Error("NEW_CAPTURE_FOR_NATIVE_STOP_REQUIRED");
const history=lines(DIR+"/tool-results.jsonl"),events=lines(REVIEW+"/tool-results.jsonl"),native=lines(REVIEW+"/native-events.jsonl");
const scanEvent=history.find(e=>e.event_seq===original.scan_event_seq&&e.stage===stage.id);
const inspect=events.findLast(e=>e.tool==="inspect_object"&&e.args?.object_id===original.candidate.id);
if(!scanEvent||inspect?.result?.status!=="SUCCEEDED"||inspect.result.object_id!==original.candidate.id||
 inspect.result.before_confidence!==original.candidate.confidence||original.candidate.confidence>=.8||
 !Array.isArray(inspect.result.evidence)||inspect.result.evidence.length!==3||
 !inspect.result.evidence.every((v:any)=>v.motion?.status==="SUCCEEDED"&&frameTime(v.frame_timestamp)!>frameTime(original.candidate.timestamp)!))
 throw Error("PRIOR_ACTUAL_COMPLETE_THREE_VIEW_INSPECTION_REQUIRED");
const binding=()=>{const approval=read(DIR+"/human-approval.json"),meta=read(OUT+"/recordings/"+recording+"/metadata.json");
 if(meta.id!==recording)throw Error("RECORDING_IDENTITY_MISMATCH");
 validateResumeRecording(meta,approval,RUN,SESSION);return {meta,approval};};
function preflight(){
 const r=read(UI+"/ros-state.json"),age=Date.now()/1000-r.updated_at,pose=original.recorded_scan_pose;
 if(r.ros_domain_id!==106||!Number.isFinite(age)||age<0||age>3||!Number.isFinite(r.pose_age_ms)||r.pose_age_ms>2500||
 r.navigation?.status!=="IDLE"||r.navigation?.motion_lease?.held!==false||r.navigation?.active_goals?.length!==0||
 !["linear_x","linear_y","angular_z"].every(k=>Number.isFinite(r.velocity?.[k])&&Math.abs(r.velocity[k])<.001)||
 !Number.isFinite(r.pose?.x)||!Number.isFinite(r.pose?.y)||Math.hypot(r.pose.x-pose.x,r.pose.y-pose.y)>=.5)
 throw Error("FRESH_IDLE_FREE_LEASE_SAME_VIEW_REGION_REQUIRED");
 const lock=ROOT+"/runtime/motion-control.lock";
 if(fs.existsSync(lock))execFileSync("python3",["-B","-c",'import fcntl,sys; f=open(sys.argv[1],"rb"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); fcntl.flock(f,fcntl.LOCK_UN); f.close()',lock],{cwd:ROOT,stdio:"pipe",timeout:3000});
 return r;
}
const first=binding();save("native-stop-completion-preflight.json",{run_id:RUN,session_id:SESSION,source1_recording:source1.id,
 source2_recording:recording,original_inspection_event_seq:inspect.event_seq,ros:preflight(),
 source2_meta:first.meta,original_failure_preserved:fs.existsSync(REVIEW+"/failure.json")});
const combinedNative=[...lines(DIR+"/native-events.jsonl"),...native],cursor=combinedNative.findLast(e=>Number.isInteger(e.seq)&&Number.isInteger(e._meta?.generation));
if(!cursor)throw Error("SAME_SESSION_NATIVE_CURSOR_REQUIRED");
const owner=read(ROOT+"/.agh-home-step7/data/daemon/owner.json"),client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
let session:any,iterator:any,collector:any,timer:any,closed=false,violation:string|null=null;
const calls=new Map<string,any>(),abort=new AbortController(),turns:any[]=[];
const allowed=new Set(["stop_robot","get_robot_state"]);
async function permission(r:any,ctx:any){
 const name=baseTool(String(r.toolCall?._meta?.["ai.agnes.harness"]?.tool||String(r.toolCall?.title??"").split(" ")[0]));
 let input=r.toolCall?.rawInput;try{if(typeof input==="string")input=JSON.parse(input);}catch{input={};}
 input=input?.arguments??input?.args??input??{};
 let ok=r.sessionId===SESSION&&!closed&&!ctx.signal.aborted&&!abort.signal.aborted&&allowed.has(name)&&Object.keys(input).length===0;
 try{binding();}catch{ok=false;}
 append("permission-decisions.jsonl",{at:Date.now(),session_id:SESSION,stage:stage!.id+"_candidate_review",tool:name,args:input,allowed:ok,
 recording_id:recording,scope:"native stop and state only; never repeat inspection or navigation"});
 if(!ok){violation="NATIVE_STOP_SCOPE_REJECTED:"+name;abort.abort();}
 return {verdict:ok?"allowed-once":"rejected"} as any;
}
try{
 await client.initialize();const cfg=await client.config.get();
 if(cfg.provider?.id!=="agnes-ai"||cfg.provider?.model!=="agnes-3.0-flash")throw Error("AGNES_PROVIDER_REQUIRED");
 const current=read(UI+"/native-session-state.json");
 if(current.status==="RUNNING"||current.pending_approvals?.length||current.pending_inputs?.length)throw Error("NATIVE_SESSION_BUSY");
 session=await client.session.load(SESSION,{cwd:ROOT,onPermissionRequest:permission});
 await session.attach({cursor:{fromSeq:cursor.seq,generation:cursor._meta.generation}});
 iterator=session.events()[Symbol.asyncIterator]();
 collector=(async()=>{for(;;){const next=await iterator.next();if(next.done)break;const e=next.value;if(e.seq<=cursor.seq)continue;
  native.push(e);append("native-events.jsonl",e);
  if(e.type==="tool/call"){
   const tool=baseTool(e.data.name??"");
   calls.set(e.data.toolUseId,{tool_call_id:e.data.toolUseId,call_at:Date.now(),call_seq:e.seq,tool,args:e.data.args??{}});
   if(!allowed.has(tool)){violation="NATIVE_STOP_ACTOR_SCOPE_EXPANDED:"+tool;abort.abort();void session.cancel();break;}
  }
  if(e.type==="tool/result"){
   const item={at:Date.now(),event_seq:e.seq,session_id:SESSION,stage:stage!.id+"_candidate_review",recording_id:recording,
    ...calls.get(e.data.toolUseId),result:normalized(e.data.result??e.data.content??e.data)};
   events.push(item);append("tool-results.jsonl",item);
  }
 }})().catch(e=>{violation="NATIVE_STOP_EVENT_STREAM_FAILED:"+String(e);abort.abort();});
 timer=setInterval(()=>{try{binding();}catch(e){violation="NATIVE_STOP_RECORDING_INTERRUPTED:"+String(e);abort.abort();void session?.cancel();}},1000);
 for(let round=1;round<=3;round++){
  if(violation)throw Error(violation);
  const proof=candidateReviewProof(saved,stage,original.candidate,scanEvent,[...history,...events],[...combinedNative,...native],true);
  if(proof)break;
  const stop=events.findLast(e=>e.tool==="stop_robot"&&e.call_seq>inspect.event_seq&&e.result?.status==="STOPPED"&&e.result.zero_twist_published===true);
  allowed.clear();if(!stop)allowed.add("stop_robot");allowed.add("get_robot_state");
  const text="这是同一实际候选复核的缺失停止证据补齐。此前已有真实3视角inspect_object结果，不能重做或改写。"+
   (stop?"stop_robot已真实成功，本turn仅调用一次get_robot_state，确认零速度/无活动任务/无motion_owner。":
    "本turn仅依次调用stop_robot，然后get_robot_state，确认零速度/无活动任务/无motion_owner。")+
   "不要inspect_object、inspect_room、navigate_to、门操作、memory、scoring、shell、文件工具或重新开始任何任务。调用完成后立即结束。"+
   "本段录像只记录停止及状态复核，之前3视角属于原录像。";
  append("native-stop-completion-turns.jsonl",{kind:"prompt",round,at:Date.now(),session_id:SESSION,recording_id:recording,text});
  const turn=await session.prompt(text,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)]),titleLocale:"zh-CN"});
  await wait(400);turns.push({round,turn,recording_id:recording});
  append("native-stop-completion-turns.jsonl",{kind:"result",round,at:Date.now(),turn,recording_id:recording});
 }
 if(violation)throw Error(violation);
 const proof=candidateReviewProof(saved,stage,original.candidate,scanEvent,[...history,...events],[...combinedNative,...native],true);
 if(!proof||!turns.length||turns.at(-1).turn.reason!=="completed"||turns.at(-1).turn.stopReason!=="end_turn")throw Error("ACTUAL_NATIVE_STOP_COMPLETION_EVIDENCE_REQUIRED");
 const result={status:proof.status,run_id:RUN,session_id:SESSION,candidate:original.candidate,proof,turns,
 original_failure_preserved:true,original_inspection_event_seq:inspect.event_seq,original_inspection_recording_id:source1.id,
 native_stop_recording_id:recording,recording_id:recording,recording_sources:[
  {id:source1.id,role:"original actual three-view candidate inspection"},{id:recording,role:"native stop and zero-state evidence only"}],
 area_empty_claimed:false,original_candidate_preserved:true,at:new Date().toISOString()};
 save("result-after-native-stop.json",result);
 console.log(JSON.stringify({directory:REVIEW,status:result.status,result_file:"result-after-native-stop.json",inspection_not_repeated:true}));
}catch(e){abort.abort();await session?.cancel().catch(()=>{});save("native-stop-completion-failure.json",{error:String(e),at:new Date().toISOString(),
 source2_recording:recording,original_inspection_preserved:true});throw e;}
finally{closed=true;clearInterval(timer);await session?.detach().catch(()=>{});await client.close().catch(()=>{});await iterator?.return?.().catch(()=>{});await collector?.catch(()=>{});}
