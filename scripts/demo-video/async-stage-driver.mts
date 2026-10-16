/** Continue an early-ended native turn only for an actual pending operation in this stage. */
import {stageEvidence,expectedStageMemory} from "./demo-policy.mts";
export type PendingStage={kind:"inspection"|"navigation";id:string;target:string;accepted_at:number;state:any};
const terminal=(r:any)=>r?.terminal_known===true||["SUCCEEDED","FAILED","PARTIAL","ABORTED","CANCELED","STOPPED"].includes(r?.status);
export function pendingStage(stage:any,events:any[]):PendingStage|null{
 const lastState=events.findLast(e=>e.tool==="get_robot_state");
 if(stage.scan){
  const accepted=events.findLast(e=>e.tool==="inspect_room"&&e.args?.location===stage.scan&&e.result?.accepted===true&&e.result.status==="PENDING");
  if(accepted){
   if(events.indexOf(lastState)<=events.indexOf(accepted))
    return {kind:"inspection",id:accepted.result.inspection_id,target:stage.scan,accepted_at:accepted.at,state:null};
   const i=lastState.result?.inspection;
   if(i?.inspection_id===accepted.result.inspection_id&&!terminal(i)&&i.active===true&&i.terminal_known===false)
    return {kind:"inspection",id:i.inspection_id,target:stage.scan,accepted_at:accepted.at,state:lastState.result};
  }
 }
 for(const target of [...stage.nav].reverse()){
  const accepted=events.findLast(e=>e.tool==="navigate_to"&&e.args?.location===target&&e.result?.accepted===true&&e.result.status==="PENDING");
  if(accepted){
   if(events.indexOf(lastState)<=events.indexOf(accepted))
    return {kind:"navigation",id:accepted.result.operation_id,target,accepted_at:accepted.at,state:null};
   const r=lastState.result;
   if(r?.navigation_operation_id===accepted.result.operation_id&&r.navigation_active===true&&r.navigation_terminal_known===false)
    return {kind:"navigation",id:r.navigation_operation_id,target,accepted_at:accepted.at,state:r};
  }
 }
 return null;
}
export function continuationAllows(plan:PendingStage|null,name:string,args:any){
 if(!plan)return true;
 if(plan.kind==="inspection"&&name==="inspect_room"&&args.location===plan.target)return false;
 if(plan.kind==="navigation"&&name==="navigate_to"&&args.location===plan.target)return false;
 return true;
}
export async function waitForPendingRelease(plan:PendingStage,readRos:()=>any,signal:AbortSignal,deadline:number,onWait:(value:any)=>void=()=>{},io={now:()=>Date.now(),sleep:(ms:number)=>new Promise(r=>setTimeout(r,ms))}){
 const limit=Math.min(deadline,io.now()+180000);
 while(io.now()<limit){
  signal.throwIfAborted();const r=readRos(),age=io.now()/1000-r?.updated_at;
  if(r?.ros_domain_id===106&&Number.isFinite(age)&&age>=0&&age<3&&r.updated_at*1000>=plan.accepted_at){
   const lease=r.navigation?.motion_lease;
   if(lease?.held===false){onWait({status:"LEASE_RELEASE_OBSERVED_NOT_TERMINAL_PROOF",id:plan.id,ros:r});return;}
   if(lease?.held===true&&lease.owner?.operation_id!==plan.id)throw Error("ASYNC_STAGE_OWNER_CHANGED");
  }
  await io.sleep(250);
 }
 throw Error("ASYNC_STAGE_PASSIVE_WAIT_TIMEOUT");
}
function memoryDone(stage:any,events:any[]){
 const wanted=expectedStageMemory(stage);
 if(!wanted)return true;
 const update=events.findLastIndex((e,i)=>e.tool==="world_memory_update"&&Object.keys(e.args??{}).length===2&&
  e.args.robot_location===wanted.robot_location&&e.args.last_observation===wanted.last_observation&&
  e.result?.robot_location===wanted.robot_location&&e.result?.last_observation===wanted.last_observation&&
  stageEvidence(stage,events.slice(0,i)).ok);
 return update>=0&&events.slice(update+1).some(e=>e.tool==="world_memory_get"&&
  e.result?.robot_location===wanted.robot_location&&e.result?.last_observation===wanted.last_observation);
}
function promptFor(stage:any,plan:PendingStage,stopAfterStage:boolean){
 const poll=plan.kind==="inspection"?"inspection.inspection_id":"navigation_operation_id";
 let next=plan.kind==="inspection"?"不要再次inspect_room；完整环视已在后台执行。":"不要再次navigate_to已接受的目标 "+plan.target+"。";
 if(plan.kind==="navigation"&&stage.scan)next+=" 此导航实际SUCCEEDED后才启动本阶段inspect_room "+stage.scan+"一次，PENDING时继续get_robot_state轮询新inspection_id到实际完成。";
 if(plan.kind==="navigation"&&stage.door){
  if(plan.target===stage.nav[0])next+=" 此导航实际SUCCEEDED后完成尚未执行的inspect_door/open_door "+stage.door+"；直接使用门开后fresh_camera_observation，缺失/失败才get_world_state。"+
   (stage.nav.length>1?" 仅门后的真实视觉通过后导航 "+stage.nav[1]+"一次，PENDING时轮询同operation_id，进入后get_world_state获取新的房内视觉。":" 不进入房间。");
  else next+=" 此房内导航实际SUCCEEDED后get_world_state获取新的房内视觉，不再次识门/开门。";
 }
 const confirm=stage.id==="confirm"?" 同一Right_Front_Room完整8视角scan实际SUCCEEDED后，从本次扫描的detections里选person新visual ID，执行inspect_object采集新的多视角帧，至少2个不同hash/时间戳和不同角度且still_uncertain=false后stop_robot/get_robot_state。没有person如实停止，不用历史门口ID。":"";
 return "前一个原生turn已经结束，但本阶段实际异步操作尚未完成；这不是新动作请求，也不是运行失败。"+
  "已接受的"+plan.kind+" ID="+plan.id+"，目标="+plan.target+"。只用get_robot_state确认同一 "+poll+" 的实际终态；后台lease释放仅表示可读取终态，绝不表示SUCCEEDED。"+
  "若仍PENDING/active，用get_robot_state继续轮询，不能结束turn、不能启动替代动作。FAILED/PARTIAL/ABORTED/CANCELED则stop_robot并get_robot_state后如实报告失败，不能写成功记忆。"+
  next+confirm+" 只有本阶段真实工具证据齐全后才world_memory_update严格使用"+JSON.stringify(expectedStageMemory(stage))+
  "，只写robot_location与last_observation两个字段，再world_memory_get。不要current_plan、decision_score_candidates、shell/文件工具，不能把历史semantic_objects视为当前视觉。"+
  (stage.id==="confirm"?"":"不执行inspect_object。")+
  (stage.id==="confirm"?"person线索如实记录；本确认阶段已授权使用成功房内扫描的新visual ID执行inspect_object复核并停止，无需等待另一个阶段指令。":"person线索如实记录，弱线索未确认；发现高置信新person须停止等待复核，不硬走预设路线。")+
  (stopAfterStage?" 本阶段完成后stop_robot，再get_robot_state读取零速度/无活动操作。":"")+
  "完成以上真实步骤才简短报告并结束当前turn。";
}
type Input={stage:any;initialTurn:any;events:()=>any[];readRos:()=>any;signal:AbortSignal;deadline:number;stopAfterStage?:boolean;
 ask:(text:string,plan:PendingStage,remainingMs:number)=>Promise<any>;record:(value:any)=>void;drain:()=>Promise<void>};
export async function finishPendingStage(input:Input){
 let turn=input.initialTurn;const original=turn,turns:any[]=[];
 for(let round=1;round<=6;round++){
  if(turn?.reason!=="completed"||turn?.stopReason!=="end_turn"||stageEvidence(input.stage,input.events()).ok)break;
  const plan=pendingStage(input.stage,input.events());
  if(!plan)break; // A terminal PARTIAL/FAILED or missing/unrelated ID is a real failure.
  input.signal.throwIfAborted();
  if(Date.now()>=input.deadline)throw Error("ASYNC_STAGE_TOTAL_DEADLINE");
  input.record({at:Date.now(),kind:"CONTINUATION_PLANNED",round,plan,previous_turn:turn});
  await waitForPendingRelease(plan,input.readRos,input.signal,input.deadline,value=>input.record({at:Date.now(),kind:"PASSIVE_ROS_OBSERVATION",round,...value}));
  const remaining=input.deadline-Date.now();if(remaining<=0)throw Error("ASYNC_STAGE_TOTAL_DEADLINE");
  const text=promptFor(input.stage,plan,input.stopAfterStage===true);
  turn=await input.ask(text,plan,remaining);await input.drain();
  const evidence=stageEvidence(input.stage,input.events());
  const item={at:Date.now(),kind:"CONTINUATION_TURN",round,plan,text,turn,evidence};turns.push(item);input.record(item);
 }
 // No terminal proof is derived from passive observation, and original turn remains explicit.
 return {turn,initial_turn:original,continuation_turns:turns,evidence:stageEvidence(input.stage,input.events()),memory_verified:memoryDone(input.stage,input.events())};
}
