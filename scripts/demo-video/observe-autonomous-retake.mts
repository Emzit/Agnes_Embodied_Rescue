/** Prepare and observe one new native UI session. Never prompt or steer the model. */
import fs from 'node:fs';
import path from 'node:path';
import { createClient,memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
import { assertPreflight,assertFreeMotionLease } from './verify-native-workflow.mts';
import { baseTool,normalized } from './demo-policy.mts';
import { stopOwnedMotion } from './stop-owned-motion.mts';
const ROOT='/data-ssd/zhongchengkai/agnes',UI=ROOT+'/artifacts/demo-ui-final';
if(process.cwd()!==ROOT)throw Error('WORKSPACE_REQUIRED');
const read=(f:string)=>JSON.parse(fs.readFileSync(f,'utf8')),iso=()=>new Date().toISOString(),wait=(n:number)=>new Promise(r=>setTimeout(r,n));
const active=read(ROOT+'/artifacts/demo-video/autonomous-retake-current.json'),DIR=path.resolve(active.directory),TASK='请找到一个待救援人员。';
if(!DIR.startsWith(ROOT+'/artifacts/demo-video/autonomous-retake-'))throw Error('CURRENT_RETAKE_DIRECTORY_REQUIRED');
const reset=read(DIR+'/scene-reset/after.json');if(reset.pass!==true||reset.status!=='READY_AT_START'||reset.doors_after.some((d:any)=>d.state!=='CLOSED'))throw Error('VERIFIED_RESET_REQUIRED');
assertPreflight(read(UI+'/native-session-state.json'),read(UI+'/ros-state.json'));assertFreeMotionLease();
const publicScene=read(ROOT+'/artifacts/interactive-live/current-scenario.json');
const registry=read(path.resolve(ROOT,publicScene.layout.registry));const locations=new Set(registry.locations.map((l:any)=>l.id));
const doors=new Set(reset.doors_after.map((d:any)=>d.door_id));
const reads=new Set(['get_robot_state','get_map','list_known_locations','get_world_state','get_observation','mission_get_state','world_memory_get']);
const memory=new Set(['mission_reset','world_memory_update','decision_score_candidates']);
const motions=new Set(['navigate_to','inspect_room','inspect_object','inspect_door','open_door','stop_robot']);
const append=(name:string,v:any)=>fs.appendFileSync(DIR+'/'+name,JSON.stringify(v)+'\n');
const save=(name:string,v:any)=>fs.writeFileSync(DIR+'/'+name,JSON.stringify(v,null,2)+'\n');
const owner=read(ROOT+'/.agh-home-step7/data/daemon/owner.json');const client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});
let session:any,iterator:any,collector:any,reason:string|null=null,lastRos:any=null,started=false,turnEnded=false;
const aborter=new AbortController(),ids=new Set<string>(),calls=new Map<string,any>(),expires=Date.now()+3600000;
const state=(status:string,extra:any={})=>{const value={status,session_id:session?.id,expected_ui_input:TASK,updated_at:iso(),directory:DIR,sdk_prompt:false,sdk_steer:false,route_guidance:false,...extra};save('session-state.json',value);console.log(JSON.stringify(value));};
async function permission(request:any,ctx:any){
 const tool=baseTool(String(request.toolCall?._meta?.['ai.agnes.harness']?.tool||String(request.toolCall?.title||'').split(' ')[0]));
 let raw=request.toolCall?.rawInput;try{if(typeof raw==='string')raw=JSON.parse(raw);}catch{raw={};}
 const args=raw?.arguments??raw?.args??raw??{};
 let allowed=request.sessionId===session?.id&&!aborter.signal.aborted&&!ctx.signal.aborted&&Date.now()<expires&&(reads.has(tool)||memory.has(tool)||motions.has(tool));
 if(tool==='navigate_to'||tool==='inspect_room')allowed&&=locations.has(args.location);
 if(tool==='inspect_door'||tool==='open_door')allowed&&=doors.has(args.door_id);
 append('native-permission-decisions.jsonl',{at:iso(),request_id:request.requestId,session_id:request.sessionId,tool,args,verdict:allowed?'allowed-once':'rejected',basis:'User explicitly authorized reset, single-task autonomous simulated search and recording; no route constraint or extra model instruction is added.'});
 return {verdict:allowed?'allowed-once':'rejected'}as any;
}
async function finishOwnedMotion(){
 const ros=read(UI+'/ros-state.json');if(!ros.navigation?.motion_lease?.held&&!ros.navigation?.active_goals?.length&&Object.values(ros.velocity||{}).every(v=>Math.abs(Number(v))<.001))return {verified:true,status:'ALREADY_IDLE',source:'Fresh ROS observer'};
 return await stopOwnedMotion({runId:session.id,operationIds:ids,timeoutMs:130000});
}
const onSignal=()=>{reason='PROCESS_INTERRUPTED';aborter.abort();};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
try{
 await client.initialize();const cfg=await client.config.get();if(cfg.provider?.id!=='agnes-ai'||cfg.provider?.model!=='agnes-3.0-flash')throw Error('AGNES_PROVIDER_REQUIRED');
 const sessionKey='autonomous-retake-'+Date.now();session=await client.session.new({cwd:ROOT,preset:'standard',sessionKey});await client.session.rename(session.id,'室内火灾人员自主搜寻');session.onPermissionRequest(permission);await session.attach();
 save('session-plan.json',{session_id:session.id,preset:'standard',provider:'agnes-ai',model:'agnes-3.0-flash',expected_ui_input:TASK,session_created_at:iso(),fresh_session:true,prior_chat_context_imported:false,sdk_prompt:false,sdk_steer:false,route_guidance:false,user_authorization:'User asked for a reset then one task and confirmed 按这个方式执行; ordinary native tool requests remain evaluated per call.'});
 iterator=session.events()[Symbol.asyncIterator]();collector=(async()=>{for(;;){const next=await iterator.next();if(next.done)break;const ev=next.value;append('native-events.jsonl',ev);
  if(ev.type==='user/message'){
   const text=(Array.isArray(ev.data?.content)?ev.data.content:[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');append('actual-ui-messages.jsonl',{observed_at:iso(),seq:ev.seq,kind:ev.data?.kind,text,expected:text===TASK,source:'Actual native ledger; this helper never sends prompt/steer'});
   if(ev.data?.kind!=='runtime_context'){started=true;state('TASK_SENT',{actual_text:text,matches_expected_goal:text===TASK});}
  }
  if(ev.type==='tool/call')calls.set(ev.data.toolUseId,{tool:baseTool(ev.data.name??ev.data.toolName??ev.data.tool??''),args:ev.data.args??ev.data.arguments??{},call_seq:ev.seq});
  if(ev.type==='tool/result'){
   const call=calls.get(ev.data.toolUseId)||{},result=normalized(ev.data.result??ev.data.content??ev.data);append('native-tool-results.jsonl',{at:iso(),event_seq:ev.seq,...call,result});
   if(result?.operation_id)ids.add(result.operation_id);if(result?.inspection_id)ids.add(result.inspection_id);
  }
  if(ev.type==='turn/end'){append('native-turn-end.jsonl',{at:iso(),seq:ev.seq,data:ev.data});turnEnded=true;state('NATIVE_TURN_ENDED',{turn:ev.data});}
 }})().catch(e=>{reason='EVENT_STREAM_FAILED:'+String(e.message);aborter.abort();});
 fs.writeFileSync(UI+'/native-session-target.json',JSON.stringify({session_id:session.id,reason:'Fresh single-task autonomous recording requested by user',updated_at:iso()},null,2)+'\n');
 state('READY_FOR_RECORDING_AND_UI_INPUT',{expected_ui_input:TASK,expires_at:new Date(expires).toISOString()});
 while(!aborter.signal.aborted&&Date.now()<expires){
  if(fs.existsSync(DIR+'/request-stop.json')){reason='RECORDING_AND_OBSERVATION_STOP_REQUEST';break;}
  const ros=read(UI+'/ros-state.json');if(ros.updated_at!==lastRos){lastRos=ros.updated_at;append('ros-observer.jsonl',{at:iso(),state:ros});}
  if(turnEnded&&!fs.existsSync(DIR+'/completed-turn-state.json'))save('completed-turn-state.json',{at:iso(),native:read(UI+'/native-session-state.json'),ros});
  await wait(500);
 }
 reason??='AUTHORIZED_WINDOW_ENDED';aborter.abort();if(started)await session.cancel();const stop=started?await finishOwnedMotion():{verified:true,status:'NO_TASK_SENT'};
 save('final-observation.json',{at:iso(),reason,stop,native:read(UI+'/native-session-state.json'),ros:read(UI+'/ros-state.json')});state('COLLECTION_ENDED',{reason,stop});
}catch(e:any){reason=String(e.message);aborter.abort();await session?.cancel().catch(()=>{});save('session-failure.json',{at:iso(),reason});state('FAILED',{reason});process.exitCode=1;}
finally{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);await session?.detach().catch(()=>{});await client.close().catch(()=>{});await iterator?.return?.().catch(()=>{});await collector?.catch(()=>{});}
