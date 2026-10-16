import fs from "node:fs";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import {resumeEvidencePlan,validateResumeRecording,allowResumeObservation,allowResumeFrontEntry} from "./resume-policy.mts";
import {stopOwnedMotion} from "./stop-owned-motion.mts";
import {finishPendingStage,continuationAllows} from "./async-stage-driver.mts";
import {initialTask,stages,baseTool,normalized,freshPeople,allowTool,stageEvidence,expectedStageMemory,confirmationPeople} from "./demo-policy.mts";
const ROOT="/data-ssd/zhongchengkai/agnes",OUT=ROOT+"/artifacts/demo-video-20261013",UI=ROOT+"/artifacts/demo-ui-final";
if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const save=(p:string,v:any)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n");
const stamp=()=>new Date().toISOString();
const freshIso=(v:any,maxMs:number)=>typeof v==="string"&&Number.isFinite(Date.parse(v))&&Date.now()-Date.parse(v)>=-2000&&Date.now()-Date.parse(v)<maxMs;
function idleRos(r:any){
 return Number.isFinite(r.updated_at)&&Date.now()/1000-r.updated_at<5&&Date.now()/1000-r.updated_at>=-2&&
 Number.isFinite(r.pose_age_ms)&&r.pose_age_ms<2500&&r.navigation?.status==="IDLE"&&!r.navigation?.motion_lease?.held;
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const argv=process.argv.slice(2),flags=new Set(argv);
const valueAfter=(name:string)=>{const at=argv.indexOf(name);return at<0?null:argv[at+1];};
const resumeRun=valueAfter("--resume"),overrideRecording=valueAfter("--recording");
if(flags.has("--resume")&&!/^guided-demo-\d+$/.test(resumeRun||""))throw Error("VALID_RESUME_RUN_REQUIRED");
if(overrideRecording&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(overrideRecording))throw Error("INVALID_RECORDING_ID");
if(!flags.has("--prepare")&&!flags.has("--check")&&!resumeRun)throw Error("Use --check, --prepare or --resume <run_id> [--recording <id>]");
if(resumeRun&&flags.has("--prepare"))throw Error("RESUME_AND_PREPARE_CONFLICT");
const safetyText="本演示使用人为预设搜寻顺序，通过 Agnes Harness 实时调用 Agnes 模型和真实仿真工具执行，所有后台指令保留在原生记录。"
+"navigate_to 若已返回真实 SUCCEEDED 且终态已知，无需再重复查询；仅 PENDING 时轮询 get_robot_state 到同一 operation_id 的 SUCCEEDED。"
+"inspect_room 返回 PENDING 后用 get_robot_state 等相同 inspection_id 的 terminal_known，确认 result.status=SUCCEEDED 后才继续。"
+"识别只能依据本轮 current_observation 或本轮扫描的图像证据；历史semantic_objects不是当前视野。"
+"不要使用 get_observation 原始图附件，不要从静态地图推定人员存在。"
+"当前视野未检测到人员，不等于整个房间无人。发现 person 要如实报告，不得为了预定剧情谎报未发现；右前房间阶段按明确指令进入已开门的房间，其余阶段若发现person就停止等待。"
+"严禁并发移动和识别、擅自进入其他房间、shell、文件读取或调用第三方模型。"
+"每个阶段完成后停止工具调用并简短报告，等待下一阶段指令。最后只宣称搜寻定位完成，不能宣称已搬运、护送、撤离或医疗救援。";
function instructions(stage:any,mission:string){
 const memory="\\n任务记忆：覆盖默认技能逐动作写记忆的习惯。本阶段所有上述真实工具证据完成后，才调用一次 world_memory_update，参数严格使用 "+JSON.stringify(expectedStageMemory(stage))+"；然后调用 world_memory_get 保留实际结构化任务记忆。只写这两个字段，不增加 searched_room、target_status、known_object、action 或 current_plan，不把门外观察描述成已搜索整个房间。记忆读取不需要 get_world_state，不触发额外图片识别。";
 if(stage.id==="start")return safetyText+memory+"\n本阶段：先 mission_reset {mission_id:"+JSON.stringify(mission)+",goal:"+JSON.stringify(initialTask)+"} 仅清理任务记忆，不重置物理场景。读取 get_map、list_known_locations、get_robot_state，确认在Start附近。调用 inspect_room {location:\"Start\"} 原地完整环视，轮询到真正结束，再报告当前所见。不要离开起点。";
 if(stage.id==="middle_scan")return safetyText+memory+"\n本阶段：navigate_to Main_Corridor，等导航成功；inspect_room Main_Corridor原地完整环视，轮询结束后报告。";
 if(stage.id==="confirm")return safetyText+memory+"\n本阶段：在已真实进入的Right_Front_Room先get_world_state，确认本轮相机AVAILABLE且current_location是Right_Front_Room。当前可能只看到墙，不能使用历史门口person ID。随后inspect_room {location:\"Right_Front_Room\"}一次完整8视角环视，用get_robot_state轮询同inspection_id到SUCCEEDED/8个AVAILABLE新帧/rotation_complete。从这次成功房内扫描detections中选择person实际visual ID，执行inspect_object；它会转向并采集新的相机帧。至少两个不同hash/时间戳与不同角度且still_uncertain=false才算人员复核。没有人员就如实停止，不能编造或使用历史semantic_objects。随后stop_robot，再get_robot_state确认零速度和无活动操作。报告人员所在房间和证据，标题为“人员定位完成”，不要导航、开门或进入别处。";
 return safetyText+memory+"\n本阶段：先 navigate_to "+stage.nav[0]+" 并等成功；依次 inspect_door "+stage.door+"、确认视觉支持门、open_door "+stage.door+"，等待真实打开完成，保持门敞开。直接使用 open_door.verification.fresh_camera_observation，它是门打开并停止后新帧的 Agnes 识别结果，不要立即重复调用 get_world_state。若该新帧缺失或失败才重取 get_world_state。"+
 (stage.id==="front"?"若门已确认打开，再 navigate_to Right_Front_Room 并等成功，进入人员所在房间，get_world_state 获取新的视觉。到达后停止本阶段，下一阶段复核。":"本阶段不要进入房间，报告新视野是否检出person。");
}
const plan={version:1,initial_task:initialTask,disclosure:safetyText,stages:stages.map(s=>({...s,prompt:instructions(s,"<session_mission_id>")})),expected_result:"LOCATED_AND_STOPPED",physical_evacuation:false,recording_required:true,requires_scoped_human_approval:true};
fs.mkdirSync(OUT,{recursive:true});save(OUT+"/run-plan.json",plan);
if(flags.has("--check")){
 if(resumeRun){const d=OUT+"/runs/"+resumeRun,history=fs.readFileSync(d+"/tool-results.jsonl","utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));const check=resumeEvidencePlan(read(d+"/state.json"),read(d+"/plan.json"),history,fs.readFileSync(d+"/native-events.jsonl","utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line)));console.log(JSON.stringify({ok:true,run_id:resumeRun,resume:check,robot_actions:false,model_calls:false}));}
 else console.log(JSON.stringify({ok:true,stages:stages.length,robot_actions:false,model_calls:false}));
 process.exit(0);
}
const previous=read(UI+"/native-session-state.json"),ros=read(UI+"/ros-state.json");
if(previous.status==="RUNNING"||previous.pending_approvals?.length||previous.pending_inputs?.length)throw Error("NATIVE_SESSION_BUSY");
if(!idleRos(ros))throw Error("ROBOT_NOT_IDLE");
const owner=read(ROOT+"/.agh-home-step7/data/daemon/owner.json");
const client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
const runId=resumeRun||"guided-demo-"+Date.now(),DIR=OUT+"/runs/"+runId;fs.mkdirSync(DIR,{recursive:true});
const jsonLines=(file:string)=>fs.readFileSync(file,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));
const resumeSaved=resumeRun?read(DIR+"/state.json"):null,resumePlan=resumeRun?read(DIR+"/plan.json"):null;
const events:any[]=resumeRun?jsonLines(DIR+"/tool-results.jsonl"):[];
const resumeGate=resumeRun?resumeEvidencePlan(resumeSaved,resumePlan,events,jsonLines(DIR+"/native-events.jsonl")):null;
const resumeApproval=resumeRun?read(DIR+"/human-approval.json"):null;
const resumeBinding=resumeRun?read(DIR+"/recording.json"):null;
const resumeRecording=resumeRun?read(OUT+"/recordings/"+(overrideRecording||resumeBinding.id)+"/metadata.json"):null;
if(resumeRun){
 if(resumeRecording.id!==(overrideRecording||resumeBinding.id))throw Error("RESUME_RECORDING_IDENTITY_MISMATCH");
 validateResumeRecording(resumeRecording,resumeApproval,runId,resumePlan.session_id);
}
const expires=resumeRun?Date.parse(resumeApproval.expires_at):Date.now()+90*60*1000,personIds=new Set<string>(),calls=new Map<string,any>();
const resumeAttempt=resumeRun?Date.now():null;
const historicalNative=resumeRun?jsonLines(DIR+"/native-events.jsonl"):[];
const cursorEvent=historicalNative.filter(e=>Number.isInteger(e.seq)&&Number.isInteger(e._meta?.generation)).at(-1);
if(resumeRun&&!cursorEvent)throw Error("RESUME_EVENT_CURSOR_MISSING");
const resumeLock=resumeRun?DIR+"/resume.lock":null;
if(resumeLock)fs.writeFileSync(resumeLock,JSON.stringify({pid:process.pid,at:stamp(),run_id:runId}),{flag:"wx"});
let session:any,stage:any=resumeRun?stages[resumeGate!.index]:stages[0],iterator:any,collector:any,steered=Boolean(resumeRun),executing=false,closed=false;
let observationRepair=Boolean(resumeGate?.observationOnly),frontEntryRepair=false,continuationPlan:any=null;
let watchdog:any,stageOffset=0,recordingId:string|null=null,stopping:Promise<any>|null=null,stopVerification:any=null,abortCause:string|null=null;
const abortController=new AbortController();
const append=(file:string,value:any)=>fs.appendFileSync(DIR+"/"+file,JSON.stringify(value)+"\n");
const state=(status:string,extra:any={})=>{const v={run_id:runId,session_id:session?.id,status,stage:stage.id,updated_at:stamp(),...extra};save(DIR+"/state.json",v);save(OUT+"/active-run.json",{...v,directory:DIR});console.log(JSON.stringify(v));};
function approved(){try{const a=read(DIR+"/human-approval.json");return a.authorized===true&&a.run_id===runId&&a.session_id===(session?.id||resumePlan?.session_id)&&Date.parse(a.expires_at)>Date.now()&&Date.parse(a.expires_at)<=expires;}catch{return false;}}
async function emergencyStop(){
 if(!executing)return null;
 if(stopping)return stopping;
 stopping=(async()=>{
  const ids=new Set<string>();
  for(const e of events){
   if(e.tool==="navigate_to"&&e.result?.accepted===true&&e.result.operation_id)ids.add(e.result.operation_id);
   if(e.tool==="inspect_room"&&e.result?.accepted===true&&e.result.inspection_id)ids.add(e.result.inspection_id);
  }
  try{
   const result=await stopOwnedMotion({runId,operationIds:ids,timeoutMs:130000});
   stopVerification=result;append("emergency-stop.jsonl",{at:Date.now(),result});return result;
  }catch(e:any){stopVerification={verified:false,status:"FAILED",error:String(e.message)};
   append("emergency-stop.jsonl",{at:Date.now(),result:stopVerification});return stopVerification;}
 })();
 return stopping;
}
async function abort(reason="CANCELED"){
 if(closed)return;abortCause??=reason;
 let metadata:any=null;try{if(recordingId){const m=read(OUT+"/recordings/"+recordingId+"/metadata.json");metadata={id:m.id,status:m.status,started_at:m.started_at,updated_at:m.updated_at,limits:m.limits,chunk_count:m.chunk_count,capture_duration_ms:m.capture_duration_ms};}}catch{}
 append("abort-events.jsonl",{at:stamp(),cause:abortCause,requested_reason:reason,run_id:runId,session_id:session?.id,stage:stage.id,recording_id:recordingId,recording:metadata,authorization_expires_at:new Date(expires).toISOString()});
 closed=true;abortController.abort();await session?.cancel().catch(()=>{});await emergencyStop();state("CANCELED",{error:abortCause,abort_cause:abortCause,stop_verification:stopVerification});
}
process.on("SIGTERM",()=>void abort());process.on("SIGINT",()=>void abort());
async function permission(r:any,context:any){
 const name=baseTool(String(r.toolCall?._meta?.["ai.agnes.harness"]?.tool||String(r.toolCall?.title||"").split(" ")[0]));
 let raw=r.toolCall?.rawInput;try{if(typeof raw==="string")raw=JSON.parse(raw);}catch{raw={};}
 const args=raw?.arguments??raw?.args??raw??{};
 while(!steered&&!context.signal.aborted&&!closed&&Date.now()<expires)await wait(100);
 const allow=r.sessionId===(session?.id||resumePlan?.session_id)&&approved()&&Date.now()<expires&&!closed&&!context.signal.aborted&&continuationAllows(continuationPlan,name,args)&&(observationRepair?allowResumeObservation(name):frontEntryRepair?allowResumeFrontEntry(name,args,events.slice(stageOffset)):allowTool(stage,name,args,personIds,runId,events.slice(stageOffset)));
 append("permission-decisions.jsonl",{at:Date.now(),stage:stage.id,tool:name,args,allowed:allow,authorization_file:"human-approval.json"});
 return {verdict:allow?"allowed-once":"rejected"} as any;
}
try{
 await client.initialize();const config=await client.config.get();
 if(config.provider?.id!=="agnes-ai"||config.provider?.model!=="agnes-3.0-flash")throw Error("AGNES_PROVIDER_REQUIRED");
 if(resumeRun){
  session=await client.session.load(resumePlan.session_id,{cwd:ROOT,onPermissionRequest:permission});
  await session.attach({cursor:{fromSeq:cursorEvent.seq,generation:cursorEvent._meta.generation}});
  save(DIR+"/resume-"+resumeAttempt+"-before.json",{at:stamp(),state:resumeSaved,gate:resumeGate,old_recording:resumeBinding,new_recording:{id:resumeRecording.id,started_at:resumeRecording.started_at},native_cursor:{seq:cursorEvent.seq,generation:cursorEvent._meta.generation},approval_expires_at:resumeApproval.expires_at,disclosure:"同一次演示在核查实际观测后继续，原始日志与真实状态保留。"});
 }else{
  session=await client.session.new({cwd:ROOT,preset:"standard",sessionKey:runId});
  await client.session.rename(session.id,"室内火灾人员搜寻演示");session.onPermissionRequest(permission);await session.attach();
  save(DIR+"/plan.json",{...plan,run_id:runId,session_id:session.id,provider:"agnes-ai",model:"agnes-3.0-flash"});
  save(DIR+"/previous-session.json",previous);
 }
 save(UI+"/native-session-target.json",{session_id:session.id,reason:"User-requested recorded guided demonstration",updated_at:stamp()});
 iterator=session.events()[Symbol.asyncIterator]();
 collector=(async()=>{for(;;){const next=await iterator.next();if(next.done)break;const ev=next.value;if(resumeRun&&ev.seq<=cursorEvent.seq)continue;append("native-events.jsonl",ev);
  if(ev.type==="tool/call")calls.set(ev.data.toolUseId,{call_at:Date.now(),call_seq:ev.seq,tool:baseTool(ev.data.name??ev.data.toolName??ev.data.tool??""),args:ev.data.args??ev.data.arguments??{}});
  if(ev.type==="tool/result"){
   const call=calls.get(ev.data.toolUseId)||{},result=normalized(ev.data.result??ev.data.content??ev.data);
   const item={at:Date.now(),event_seq:ev.seq,stage:stage.id,tool_call_id:ev.data.toolUseId,...call,result};events.push(item);append("tool-results.jsonl",item);
   for(const d of freshPeople(result?.inspection?.result??result))if(d.id)personIds.add(d.id);
  }
 }})().catch((error:any)=>abort("EVENT_STREAM_FAILED:"+String(error.message)));
 if(!resumeRun)state("READY_FOR_RECORDING");
 // Initial run waits for controller binding; resume verifies a real current recorder.
 let recording:any=resumeRecording;
 while(!recording&&!closed&&Date.now()<expires){
  try{const go=read(DIR+"/recording-go.json");
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(go.recording_id||""))throw Error("INVALID_RECORDING_ID");
   const meta=read(OUT+"/recordings/"+go.recording_id+"/metadata.json");
   if(approved()&&go.run_id===runId&&meta.status==="RECORDING"&&meta.source==="user_selected_browser_display_capture"&&
     freshIso(meta.started_at,120000)){recording=meta;break;}
  }catch{}
  await wait(500);
 }
 if(!recording)throw Error("RECORDING_OR_APPROVAL_NOT_READY");
 if(resumeGate?.confirmationContinuation){
  const limit=Date.parse(recording.started_at)+Number(recording.limits?.maxSeconds)*1000;
  if(!Number.isFinite(limit)||limit-Date.now()<180000||expires-Date.now()<180000)
   throw Error("CONFIRMATION_REQUIRES_180_SECONDS_OF_FRESH_RECORDING_AND_AUTHORIZATION");
 }
 const live=read(UI+"/ros-state.json");
 if(!idleRos(live)||!Number.isFinite(live.pose?.x)||!Number.isFinite(live.pose?.y)||(!resumeRun&&Math.hypot(live.pose.x,live.pose.y+6.7)>0.45))throw Error(resumeRun?"RESUME_ROBOT_NOT_IDLE":"START_POSE_NOT_VERIFIED");
 if(resumeRun){
  validateResumeRecording(read(OUT+"/recordings/"+recording.id+"/metadata.json"),resumeApproval,runId,session.id);
  append("recording-history.jsonl",{at:stamp(),reason:"resume_after_technical_review",run_id:runId,session_id:session.id,previous:resumeBinding,current:{id:recording.id,started_at:recording.started_at}});
 }
 executing=true;recordingId=recording.id;save(DIR+"/recording.json",{id:recording.id,started_at:recording.started_at});
 let checking=false;
 watchdog=setInterval(async()=>{
  if(checking||closed||!executing)return;checking=true;
  try{
   const meta=read(OUT+"/recordings/"+recordingId+"/metadata.json");
   if(meta.status!=="RECORDING"||!freshIso(meta.updated_at,15000))await abort("RECORDING_INTERRUPTED_OR_UPLOAD_STALE");
   if(!approved())await abort("DEMO_APPROVAL_EXPIRED");
  }catch{await abort("RECORDING_STATE_UNAVAILABLE");}finally{checking=false;}
 },1000);
 for(let i=resumeGate?(resumeGate.skipCurrent?resumeGate.index+1:resumeGate.index):0;i<stages.length;i++){
  if(closed)throw Error(abortCause??"CANCELED");
  stage=stages[i];const repairing=observationRepair&&i===resumeGate?.index;
  const reuseConfirmation=Boolean(stage.id==="confirm"&&resumeGate?.confirmationContinuation&&resumeGate?.reusable_confirmation_scan);
  const offset=(repairing||reuseConfirmation)?events.findIndex(e=>e.stage===stage.id):events.length;stageOffset=offset;
  if(offset<0)throw Error("CONFIRMATION_HISTORY_REQUIRED");
  const repairStart=events.length;
  personIds.clear();
  if(stage.id==="confirm"){
   for(const d of confirmationPeople(events.slice(offset)))if(d.id)personIds.add(d.id);
  }
  state("RUNNING");
  let turn:any;const stageStartedAt=Date.now();
  if(reuseConfirmation){
   const scan=resumeGate!.reusable_confirmation_scan;
   const people=confirmationPeople(events.slice(offset)).filter(d=>scan.person_ids.includes(d.id)).sort((a:any,b:any)=>b.confidence-a.confidence);
   if(!people.length)throw Error("REUSABLE_ROOM_SCAN_PERSON_EVIDENCE_REQUIRED");
   const text=safetyText+"\n这是同一次演示最后人员复核的技术续行：Right_Front_Room已经真实进入，房内scan "+scan.inspection_id+" 已在原生事件"+scan.native_event_seq+"真实SUCCEEDED，8个AVAILABLE新帧、rotation_complete已验证。原始失败与录制截止原因保留。现在先get_robot_state核查同inspection_id仍terminal_known=true、active=false、result.status=SUCCEEDED；无需重取墙面图，也绝不能再次inspect_room、navigate_to、inspect_door/open_door或mission_reset。然后仅用该实际成功房内scan的人员visual ID "+JSON.stringify(people[0].id)+"执行inspect_object采集新的相机多视角。>=2不同hash/时间戳、不同角度且still_uncertain=false后stop_robot，再get_robot_state验证零速度无活动操作。完成后world_memory_update仅"+JSON.stringify(expectedStageMemory(stage))+"两个字段，再world_memory_get并简短报告人员定位完成。失败如实停止，不能使用历史门口ID/semantic_objects或宣称医疗/搬运救援。";
   append("prompts.jsonl",{at:Date.now(),kind:"resume-confirmation-from-complete-room-scan",stage:stage.id,recording_id:recording.id,reused_scan:scan,text});
   turn=await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(Math.min(600000,expires-Date.now()))]),titleLocale:"zh-CN"});
  }else if(repairing){
   const text=safetyText+"\n这是同一次演示的技术恢复。此前本阶段到门口导航、视觉识门和开门均已有真实成功记录，保留原状态。刚才get_world_state结果被传输截断，当前唯一任务：调用一次 get_world_state 读取当前相机的新帧，然后简短报告当前是否识别到person。不要导航，不要开门，不要旋转，不要mission_reset，不要使用历史semantic_objects代替当前观测。完成这一个读取后立即结束，等待下一阶段。";
   append("prompts.jsonl",{at:Date.now(),kind:"resume-observation",stage:stage.id,recording_id:recording.id,text});
   turn=await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(180000)]),titleLocale:"zh-CN"});
  }else if(i===0&&!resumeRun){
   // An idle steer only journals next-step input. Core consumes it at the first
   // prompt checkpoint, before sending any inference; there is no unscoped turn.
   const text=instructions(stage,runId),steerSubmittedAt=Date.now();
   const steerSeq=await session.steer(text);
   append("prompts.jsonl",{at:steerSubmittedAt,acknowledged_at:Date.now(),kind:"steer",stage:stage.id,text,seq:steerSeq,delivery:"before_initial_prompt"});
   const initialAt=Date.now();
   const running=session.prompt(initialTask,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(600000)]),titleLocale:"zh-CN"});
   running.catch(()=>{});append("prompts.jsonl",{at:initialAt,kind:"initial",text:initialTask});
   const focusReady=()=>{try{const f=read(DIR+"/focus-ready.json");return f.run_id===runId&&f.recording_id===recordingId&&f.view==="dual"&&freshIso(f.at,120000)&&Number.isFinite(f.opening_full_view_ms)&&f.opening_full_view_ms>=15000&&Date.parse(f.initial_prompt_logged_at)===initialAt;}catch{return false;}};
   while(!closed&&!focusReady()&&Date.now()<expires)await wait(250);
   if(closed)throw Error(abortCause??"CANCELED");
   if(!focusReady())throw Error("FOCUS_ACK_REQUIRED");
   // The existing native permission handler still blocks camera/motion effects
   // until the recorder confirms the actual full-page opening and dual layout.
   steered=true;append("prompts.jsonl",{at:Date.now(),kind:"focus_ack",stage:stage.id,recording_id:recordingId});
   turn=await running;
  }else{
   const text=instructions(stage,runId);append("prompts.jsonl",{at:Date.now(),kind:"prompt",stage:stage.id,text});
   turn=await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(600000)]),titleLocale:"zh-CN"});
  }
  // Results are consumed asynchronously; give the event stream a bounded drain.
  await wait(300);
  if(closed)throw Error(abortCause??"CANCELED");
  if(repairing&&resumeGate?.frontContinuation){
   const observedEvents=events.slice(offset).filter(e=>e.stage===stage.id),observed=stageEvidence(stage,observedEvents);
   save(DIR+"/stage-front-resume-observation-"+resumeAttempt+".json",{turn,evidence:observed,events:observedEvents,recording_id:recording.id});
   if(turn.reason!=="completed"||turn.stopReason!=="end_turn")throw Error("RESUME_FRONT_OBSERVATION_TURN_FAILED");
   if(!events.slice(repairStart).some(e=>e.stage==="front"&&e.tool==="get_world_state"))throw Error("RESUME_FRESH_OBSERVATION_NOT_CALLED");
   if(observed.missing.length!==1||observed.missing[0]!=="navigation:Right_Front_Room")throw Error("RESUME_FRONT_DOOR_VIEW_NOT_VERIFIED:"+observed.missing.join(","));
   observationRepair=false;frontEntryRepair=true;
   const text=safetyText+"\\n同一次演示的右前房间续行：门已经真实打开，刚才新的 get_world_state 门后视觉已验证。现在只调用 navigate_to {location:Right_Front_Room} 一次，然后 get_robot_state 轮询同一 operation_id 到 navigation_terminal_known=true 且 SUCCEEDED，确认 navigation_active=false。导航成功后调用新的 get_world_state 获取房间内当前画面，报告所见后立即结束；不要重新导航门口，不要再次识门或开门，不要 inspect_room 或 inspect_object，人员复核由下一阶段执行。";
   append("prompts.jsonl",{at:Date.now(),kind:"resume-front-entry",stage:stage.id,recording_id:recording.id,text});
   turn=await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(180000)]),titleLocale:"zh-CN"});
   await wait(300);if(closed)throw Error(abortCause??"CANCELED");
  }
  let continuation:any;
  try{
   continuation=await finishPendingStage({stage,initialTurn:turn,events:()=>events.slice(offset).filter(e=>e.stage===stage.id),
    readRos:()=>read(UI+"/ros-state.json"),signal:abortController.signal,deadline:Math.min(expires,stageStartedAt+600000),
    record:value=>append("async-stage-continuations.jsonl",{stage:stage.id,recording_id:recording.id,...value}),drain:()=>wait(300),
    ask:async(text,plan,remainingMs)=>{
     continuationPlan=plan;append("prompts.jsonl",{at:Date.now(),kind:"pending-stage-continuation",stage:stage.id,recording_id:recording.id,operation_id:plan.id,text});
     return await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(remainingMs)]),titleLocale:"zh-CN"});
    }});
   turn=continuation.turn;
  }finally{continuationPlan=null;}
  const stageEvents=events.slice(offset).filter(e=>e.stage===stage.id);
  const evidence=stageEvidence(stage,stageEvents);
  const evidenceFile=resumeRun&&fs.existsSync(DIR+"/stage-"+stage.id+".json")?"/stage-"+stage.id+"-resume-"+resumeAttempt+".json":"/stage-"+stage.id+".json";
  save(DIR+evidenceFile,{turn,initial_turn:continuation?.initial_turn,continuation_turns:continuation?.continuation_turns,memory_verified:continuation?.memory_verified,evidence,events:stageEvents,...(resumeRun?{resume_attempt:resumeAttempt,recording_id:recording.id}: {})});
  if(repairing&&!events.slice(repairStart).some(e=>e.stage===stage.id&&e.tool==="get_world_state"))throw Error("RESUME_FRESH_OBSERVATION_NOT_CALLED");
  if(turn.reason!=="completed"||turn.stopReason!=="end_turn")throw Error("TURN_NOT_COMPLETED:"+stage.id);
  if(!evidence.ok)throw Error("STAGE_EVIDENCE_MISSING:"+stage.id+":"+evidence.missing.join(","));
  if(continuation?.continuation_turns?.length&&continuation.memory_verified!==true)throw Error("ASYNC_STAGE_MEMORY_NOT_VERIFIED:"+stage.id);
  if(repairing){observationRepair=false;frontEntryRepair=false;}
  const fresh=events.slice(offset).flatMap(e=>freshPeople(e.result?.inspection?.result??e.result));
  if(i<stages.length-2&&fresh.length)throw Error("PERSON_FOUND_EARLY_REVIEW_ACTUAL_OUTCOME:"+stage.id);
 }
 state("LOCATED_AND_STOPPED",{physical_evacuation:false,disclosure:"预设路线；真实图像识别、导航和开门；搜寻定位完成"});
 executing=false;
}catch(e:any){closed=true;abortController.abort();await session?.cancel().catch(()=>{});await emergencyStop();state("NEEDS_REVIEW",{error:abortCause??String(e.message),abort_cause:abortCause,physical_evacuation:false,stop_verification:stopVerification});process.exitCode=1;}
finally{
 closed=true;clearInterval(watchdog);await iterator?.return?.();await collector?.catch(()=>{});await session?.detach();await client.close();
 if(resumeLock){try{const lock=read(resumeLock);if(lock.pid===process.pid)fs.unlinkSync(resumeLock);}catch{}}
}
