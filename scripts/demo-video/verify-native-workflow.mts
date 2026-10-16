/** Real native AGH scan → navigate → door check. No recorder, reset or simulated results. */
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import {initialTask,stages,baseTool,normalized,freshPeople,allowTool,stageEvidence,expectedStageMemory,stopped} from "./demo-policy.mts";
import {stopOwnedMotion} from "./stop-owned-motion.mts";
import {finishPendingStage,continuationAllows} from "./async-stage-driver.mts";

const ROOT="/data-ssd/zhongchengkai/agnes";
const UI=ROOT+"/artifacts/demo-ui-final";
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const nowIso=()=>new Date().toISOString();
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const chosen=stages.slice(0,2);

export function assertPreflight(native:any,ros:any,now=Date.now()){
 if(!native||native.observer_connected!==true||!Number.isFinite(Date.parse(native.observer_updated_at))||
    now-Date.parse(native.observer_updated_at)>10000||Date.parse(native.observer_updated_at)>now+2000)
  throw Error("FRESH_NATIVE_OBSERVER_REQUIRED");
 if(native.status==="RUNNING"||native.pending_approvals?.length||native.pending_inputs?.length)throw Error("NATIVE_SESSION_BUSY");
 if(!ros||ros.ros_domain_id!==106||!Number.isFinite(ros.updated_at)||now/1000-ros.updated_at>3||now/1000-ros.updated_at<0||
    !Number.isFinite(ros.pose_age_ms)||ros.pose_age_ms<0||ros.pose_age_ms>2500)throw Error("FRESH_ROS_REQUIRED");
 if(ros.navigation?.status!=="IDLE"||ros.navigation?.motion_lease?.held!==false||
    !Array.isArray(ros.navigation?.active_goals)||ros.navigation.active_goals.length||
    !ros.velocity||!["linear_x","linear_y","angular_z"].every(k=>Number.isFinite(ros.velocity[k])&&Math.abs(ros.velocity[k])<.001))
  throw Error("ROBOT_NOT_IDLE");
 if(!Number.isFinite(ros.pose?.x)||!Number.isFinite(ros.pose?.y)||Math.hypot(ros.pose.x,ros.pose.y+6.7)>.45)
  throw Error("START_POSE_NOT_VERIFIED");
}

/** Probe the reusable project inode without clearing or replacing lease metadata. */
export function assertFreeMotionLease(file=ROOT+"/runtime/motion-control.lock"){
 const candidate=path.resolve(file);
 if(!candidate.startsWith(ROOT+"/"))throw Error("PROJECT_LEASE_PATH_REQUIRED");
 if(!fs.existsSync(candidate))return;
 const actual=fs.realpathSync(candidate);
 if(!actual.startsWith(ROOT+"/"))throw Error("PROJECT_LEASE_PATH_REQUIRED");
 try{
  execFileSync("python3",["-B","-c",
   "import fcntl,sys; f=open(sys.argv[1],\"rb\"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); fcntl.flock(f,fcntl.LOCK_UN); f.close()",
   actual],{cwd:ROOT,stdio:"pipe",timeout:3000});
 }catch{throw Error("PROJECT_MOTION_LEASE_HELD");}
}

export function assertNativeStop(events:any[]){
 const stopIndex=events.findLastIndex(e=>e.tool==="stop_robot"&&e.result?.status==="STOPPED"&&e.result.zero_twist_published===true);
 const stateIndex=events.findLastIndex(e=>e.tool==="get_robot_state");
 const stop=events[stopIndex],state=events[stateIndex];
 const sequential=Number.isFinite(state?.call_seq)&&Number.isFinite(stop?.event_seq)
  ?state.call_seq>stop.event_seq:Number.isFinite(state?.call_at)&&state.call_at>stop?.at;
 if(stopIndex<0||stateIndex<=stopIndex||!sequential||!stopped(state?.result)||
   events.slice(stopIndex+1).some(e=>["navigate_to","inspect_room","inspect_object","open_door"].includes(e.tool)))
  throw Error("NATIVE_FINAL_ZERO_STATE_NOT_VERIFIED");
 return {stop:events[stopIndex],state:events[stateIndex]};
}

export function highConfidencePeople(events:any[]){
 return events.flatMap(e=>freshPeople(e.result?.inspection?.result??e.result)).filter(d=>Number.isFinite(d.confidence)&&d.confidence>=.8);
}

export function stageInstructions(stage:any,runId:string){
 const constraints="这是已授权的真实流程复验，不录制视频，不重置物理场景。只执行本阶段指定动作，完成后停止工具调用并结束当前turn。"+
  "仅使用 Agnes 模型，图像检测只依据本轮扫描或本轮 current_observation；历史 semantic_objects 不属于当前视野。"+
  "person 弱线索如实记录为未确认，不说整个房间无人、不虚构已救援。发现置信度>=0.80的新person或实际多视角确认人员时，立即stop_robot并get_robot_state确认零速度，报告线索并停止，不继续既定路线。"+
  "不要decision_score_candidates、inspect_object、shell、文件工具或调用其他房间。不要创建current_plan，不把字符串数组写入要求对象数组的schema。"+
  "navigate_to真实SUCCEEDED终态直接使用；PENDING才用get_robot_state轮询同一operation_id。inspect_room PENDING后用get_robot_state轮询同一inspection_id，只有result.status=SUCCEEDED且terminal_known后继续。"+
  "禁止并发动作，禁止重复启动已经成功的环视或导航。get_robot_state为状态读取，不追加get_world_state做多余轮询。"+
  "本阶段证据完成后一次world_memory_update，严格使用"+JSON.stringify(expectedStageMemory(stage))+"，只写robot_location/last_observation两个字段，再world_memory_get。"+
  "拒绝/失败/不可用均停止并报告，不通过另一位置、另一门或反复重试规避。";
 if(stage.id==="start")return constraints+"\n当前阶段：先mission_reset "+JSON.stringify({mission_id:runId,goal:initialTask})+
  "，只清理任务记忆。读取get_map、list_known_locations、get_robot_state，确认Start附近。inspect_room {location:\"Start\"}原地完整环视一圈，使用get_robot_state等待8个真实Agnes图像观察及完整旋转结束。写入上述记忆后简短报告，立即结束turn，等下一阶段。不要导航。";
 return constraints+"\n当前阶段：先navigate_to {location:\"Right_Near_Door_interaction\"}并确认真实导航成功。"+
  "再inspect_door {door_id:\"Right_Near_Door\"}确认实际门的视觉证据，随后open_door {door_id:\"Right_Near_Door\"}。"+
  "使用open_door.verification.fresh_camera_observation作为门停下后新图像证据；只有它缺失或识别失败时再get_world_state。"+
  "保持门打开，不进入房间，不继续其他门。完成门后新视觉及上述记忆后stop_robot，再get_robot_state确认零速度、没有活动导航或inspection和motion_owner，结束turn。";
}

async function main(){
 if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
 const flags=new Set(process.argv.slice(2));
 if(flags.size!==1||!["--check","--execute"].some(f=>flags.has(f)))throw Error("Use --check or --execute");
 if(flags.has("--check")){
  console.log(JSON.stringify({kind:"NATIVE_WORKFLOW_PLAN_ONLY",stages:chosen.map(s=>s.id),preset:"standard",provider:"agnes-ai",model:"agnes-3.0-flash",recorder:false,robot_actions:false,model_calls:false}));
  return;
 }
 const nativeBefore=read(UI+"/native-session-state.json"),rosBefore=read(UI+"/ros-state.json");
 assertPreflight(nativeBefore,rosBefore);
 assertFreeMotionLease();
 const runId="native-workflow-"+Date.now(),DIR=ROOT+"/artifacts/native-workflow-check/"+runId;
 fs.mkdirSync(DIR,{recursive:true});
 const append=(file:string,value:any)=>fs.appendFileSync(DIR+"/"+file,JSON.stringify(value)+"\n");
 const save=(file:string,value:any)=>fs.writeFileSync(DIR+"/"+file,JSON.stringify(value,null,2)+"\n");
 save("preflight.json",{at:nowIso(),native:nativeBefore,ros:rosBefore});
 const owner=read(ROOT+"/.agh-home-step7/data/daemon/owner.json");
 const client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
 const all:any[]=[],calls=new Map<string,any>(),ids=new Set<string>(),personIds=new Set<string>();
 const abortController=new AbortController(),expires=Date.now()+20*60*1000;
 let session:any,stage:any=chosen[0],offset=0,iterator:any,collector:any,poseTimer:any,continuationPlan:any=null;
 let failure:string|null=null,executionStarted=false,stopResult:any=null,lastPoseAt:any=null;
 let stopping:Promise<any>|null=null;
 const state=(status:string,extra:any={})=>{
  const value={run_id:runId,session_id:session?.id,stage:stage.id,status,updated_at:nowIso(),kind:"ACTUAL_NATIVE_AGH_WORKFLOW_NO_VIDEO",directory:DIR,...extra};
  save("state.json",value);console.log(JSON.stringify(value));
 };
 const fail=(reason:string)=>{failure??=reason;abortController.abort();void session?.cancel().catch(()=>{});};
 const emergencyStop=async()=>{
  if(!executionStarted)return null;
  if(stopping)return stopping;
  stopping=(async()=>{try{
   const result=await stopOwnedMotion({runId,operationIds:ids,timeoutMs:130000});
   append("emergency-stop.jsonl",{at:Date.now(),result});return result;
  }catch(e:any){const result={verified:false,status:"FAILED",error:String(e.message)};append("emergency-stop.jsonl",{at:Date.now(),result});return result;}})();
  return stopping;
 };
 const onSignal=()=>{fail("PROCESS_INTERRUPTED");void emergencyStop();};
 process.on("SIGINT",onSignal);process.on("SIGTERM",onSignal);
 async function permission(request:any,context:any){
  const tool=baseTool(String(request.toolCall?._meta?.["ai.agnes.harness"]?.tool||String(request.toolCall?.title||"").split(" ")[0]));
  let raw=request.toolCall?.rawInput;try{if(typeof raw==="string")raw=JSON.parse(raw);}catch{raw={};}
  const args=raw?.arguments??raw?.args??raw??{},events=all.slice(offset);
  const allow=request.sessionId===session?.id&&Date.now()<expires&&!abortController.signal.aborted&&!context.signal.aborted&&
   !(tool==="navigate_to"&&highConfidencePeople(all).length)&&continuationAllows(continuationPlan,tool,args)&&allowTool(stage,tool,args,personIds,runId,events);
  append("permission-decisions.jsonl",{at:Date.now(),request_id:request.requestId,session_id:request.sessionId,stage:stage.id,tool,args,verdict:allow?"allowed-once":"rejected",authorization_file:"authorization.json"});
  if(!allow)queueMicrotask(()=>fail("NATIVE_APPROVAL_SCOPE_REJECTED:"+tool));
  return {verdict:allow?"allowed-once":"rejected"} as any;
 }
 try{
  await client.initialize();
  const config=await client.config.get();
  if(config.provider?.id!=="agnes-ai"||config.provider?.model!=="agnes-3.0-flash")throw Error("AGNES_PROVIDER_REQUIRED");
  session=await client.session.new({cwd:ROOT,preset:"standard",sessionKey:runId});
  await client.session.rename(session.id,"环视后继续导航与开门真实复验");
  session.onPermissionRequest(permission);await session.attach();
  save("authorization.json",{authorized:true,run_id:runId,session_id:session.id,expires_at:new Date(expires).toISOString(),basis:"Prior human authorization: 允许本次完整录制与仿真操作; latest user requested actual scan-to-navigation verification before re-recording. This test reuses that scope without recorder, reset, room entry or evacuation.",native_permissions:"Every actual request is evaluated through the ordinary native permission handler; no unknown-outcome or off-route approval is granted."});
  save("plan.json",{run_id:runId,session_id:session.id,preset:"standard",provider:"agnes-ai",model:"agnes-3.0-flash",initial_task:initialTask,stages:chosen.map(s=>({...s,prompt:stageInstructions(s,runId)})),recorder:false,physical_evacuation:false});
  fs.writeFileSync(UI+"/native-session-target.json",JSON.stringify({session_id:session.id,reason:"Actual scan-to-navigation verification requested before recording",updated_at:nowIso()},null,2)+"\n");
  iterator=session.events()[Symbol.asyncIterator]();
  collector=(async()=>{for(;;){
   const next=await iterator.next();if(next.done)break;
   const ev=next.value;append("native-events.jsonl",ev);
   if(ev.type==="tool/call")calls.set(ev.data.toolUseId,{call_at:Date.now(),call_seq:ev.seq,tool:baseTool(ev.data.name??ev.data.toolName??ev.data.tool??""),args:ev.data.args??ev.data.arguments??{}});
   if(ev.type==="tool/result"){
    const call=calls.get(ev.data.toolUseId)||{},result=normalized(ev.data.result??ev.data.content??ev.data);
    const item={at:Date.now(),event_seq:ev.seq,stage:stage.id,tool_call_id:ev.data.toolUseId,...call,result};all.push(item);append("tool-results.jsonl",item);
    if(item.tool==="navigate_to"&&result?.accepted===true&&result.operation_id)ids.add(result.operation_id);
    if(item.tool==="inspect_room"&&result?.accepted===true&&result.inspection_id)ids.add(result.inspection_id);
    for(const d of freshPeople(result?.inspection?.result??result))if(d.id)personIds.add(d.id);
    if(ev.data.isError===true)fail("NATIVE_TOOL_ERROR:"+String(ev.data.code||call.tool));
    if(["FAILED","ABORTED","TIMEOUT"].includes(result?.status))fail("ACTUAL_TOOL_FAILED:"+call.tool+":"+result.status);
    if(result?.navigation_terminal_known===true&&ids.has(result.navigation_operation_id)&&result.navigation_terminal_status!=="SUCCEEDED")
      fail("ACTUAL_NAVIGATION_FAILED:"+result.navigation_terminal_status);
    if(result?.inspection?.terminal_known===true&&ids.has(result.inspection.inspection_id)&&result.inspection.result?.status!=="SUCCEEDED")
      fail("ACTUAL_SCAN_FAILED:"+result.inspection.result?.status);
   }
   if(ev.type==="verifier/signal"&&ev.data?.reasons?.includes("schema_invalid"))fail("NATIVE_SCHEMA_INVALID");
  }})().catch(e=>fail("NATIVE_EVENT_STREAM_FAILED:"+String(e.message)));
  poseTimer=setInterval(()=>{
   try{
    const r=read(UI+"/ros-state.json");
    if(r.updated_at!==lastPoseAt){lastPoseAt=r.updated_at;append("ros-observer.jsonl",{observed_at:nowIso(),stage:stage.id,source:"actual project ROS observer",state:r});}
    if(Date.now()>expires)fail("AUTHORIZED_TEST_WINDOW_EXPIRED");
   }catch(e:any){append("observer-errors.jsonl",{at:nowIso(),error:String(e.message)});}
  },500);
  executionStarted=true;
  for(const selected of chosen){
   stage=selected;offset=all.length;personIds.clear();state("RUNNING");
   const text=stageInstructions(stage,runId),at=Date.now();let turn:any;
   if(stage.id==="start"){
    const seq=await session.steer(text);
    append("prompts.jsonl",{at,acknowledged_at:Date.now(),seq,kind:"steer",stage:stage.id,delivery:"before_initial_prompt",text});
    append("prompts.jsonl",{at:Date.now(),kind:"initial",stage:stage.id,text:initialTask});
    turn=await session.prompt(initialTask,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(600000)]),titleLocale:"zh-CN"});
   }else{
    if(highConfidencePeople(all).length)throw Error("HIGH_CONFIDENCE_PERSON_FOUND_STOP_FOR_REVIEW");
    append("prompts.jsonl",{at,kind:"prompt",stage:stage.id,text});
    turn=await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(600000)]),titleLocale:"zh-CN"});
   }
   await wait(500);
   let continuation:any;
   try{
    continuation=await finishPendingStage({stage,initialTurn:turn,events:()=>all.slice(offset),readRos:()=>read(UI+"/ros-state.json"),
     signal:abortController.signal,deadline:at+600000,stopAfterStage:stage.id==="near",
     record:value=>append("async-stage-continuations.jsonl",{stage:stage.id,...value}),drain:()=>wait(500),
     ask:async(text,plan,remainingMs)=>{
      continuationPlan=plan;append("prompts.jsonl",{at:Date.now(),kind:"pending-stage-continuation",stage:stage.id,operation_id:plan.id,text});
      return await session.prompt(text,{signal:AbortSignal.any([abortController.signal,AbortSignal.timeout(remainingMs)]),titleLocale:"zh-CN"});
     }});
    turn=continuation.turn;
   }finally{continuationPlan=null;}
   const events=all.slice(offset),evidence=stageEvidence(stage,events),people=events.flatMap(e=>freshPeople(e.result?.inspection?.result??e.result));
   save("stage-"+stage.id+".json",{turn,initial_turn:continuation?.initial_turn,continuation_turns:continuation?.continuation_turns,memory_verified:continuation?.memory_verified,evidence,events,people,person_status:people.some(d=>d.confidence>=.8)?"HIGH_CONFIDENCE_REVIEW_REQUIRED":people.length?"WEAK_PERSON_CANDIDATES_UNCONFIRMED":"NO_PERSON_DETECTION_IN_CURRENT_OBSERVATIONS"});
   if(failure)throw Error(failure);
   if(turn.reason!=="completed"||turn.stopReason!=="end_turn")throw Error("NATIVE_TURN_NOT_COMPLETED:"+stage.id);
   if(!evidence.ok)throw Error("ACTUAL_STAGE_EVIDENCE_MISSING:"+stage.id+":"+evidence.missing.join(","));
   if(continuation?.continuation_turns?.length&&continuation.memory_verified!==true)throw Error("ASYNC_STAGE_MEMORY_NOT_VERIFIED:"+stage.id);
   if(highConfidencePeople(events).length)throw Error("HIGH_CONFIDENCE_PERSON_FOUND_STOP_FOR_REVIEW");
  }
  const nativeStop=assertNativeStop(all.slice(offset));
  stopResult=await emergencyStop();
  if(stopResult?.verified!==true)throw Error("FRESH_ROS_STOP_NOT_VERIFIED");
  save("final-report.json",{kind:"ACTUAL_NATIVE_AGH_WORKFLOW_NO_VIDEO",status:"PASS",at:nowIso(),run_id:runId,session_id:session.id,preset:"standard",scan_and_continuation_verified:true,native_turns_completed:true,schema_invalid:false,native_stop:nativeStop,ros_stop:stopResult,person_candidates:all.flatMap(e=>freshPeople(e.result?.inspection?.result??e.result)),physical_evacuation:false});
  executionStarted=false;state("PASS",{native_turns_completed:true,scan_and_continuation_verified:true,stop_verification:stopResult});
 }catch(e:any){
  failure??=String(e.message);abortController.abort();await session?.cancel().catch(()=>{});
  stopResult=await emergencyStop();state("FAILED",{error:failure,stop_verification:stopResult});
  save("failure.json",{at:nowIso(),error:failure,stop_verification:stopResult});process.exitCode=1;
 }finally{
  clearInterval(poseTimer);process.off("SIGINT",onSignal);process.off("SIGTERM",onSignal);
  await wait(300);await session?.detach().catch(()=>{});await client.close().catch(()=>{});
  await iterator?.return?.().catch(()=>{});await collector?.catch(()=>{});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
