/** Independent real UI opening take. Never sends a model prompt or steer. */
import fs from "node:fs";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import {assertPreflight,assertFreeMotionLease} from "./verify-native-workflow.mts";
import {initialTask,baseTool,normalized} from "./demo-policy.mts";
const ROOT="/data-ssd/zhongchengkai/agnes",UI=ROOT+"/artifacts/demo-ui-final";
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const iso=()=>new Date().toISOString(),wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const flags=new Set(process.argv.slice(2));
if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
if(flags.size!==1||!["--check","--create"].some(f=>flags.has(f)))throw Error("Use --check or --create");
if(flags.has("--check")){
 console.log(JSON.stringify({ok:true,kind:"INDEPENDENT_REAL_UI_OPENER",preset:"standard",expected_ui_input:initialTask,sdk_prompt:false,sdk_steer:false,motion_approval:false,model_calls:false,stop:"Create request-stop.json in the printed take directory; SIGINT/SIGTERM also cancel the session."}));
 process.exit(0);
}
const before=read(UI+"/native-session-state.json"),rosBefore=read(UI+"/ros-state.json");
assertPreflight(before,rosBefore);assertFreeMotionLease();
const takeId="native-opener-"+Date.now(),DIR=ROOT+"/artifacts/demo-video-20261013/openers/"+takeId;
fs.mkdirSync(DIR,{recursive:true});
const append=(file:string,v:any)=>fs.appendFileSync(DIR+"/"+file,JSON.stringify(v)+"\n");
const save=(file:string,v:any)=>fs.writeFileSync(DIR+"/"+file,JSON.stringify(v,null,2)+"\n");
const owner=read(ROOT+"/.agh-home-step7/data/daemon/owner.json");
const client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
const safeRead=new Set(["get_robot_state","get_map","list_known_locations","get_world_state","get_observation","mission_get_state","world_memory_get"]);
const motion=new Set(["navigate_to","inspect_room","inspect_object","open_door","stop_robot"]);
const aborter=new AbortController(),deadline=Date.now()+180000;
let session:any,iterator:any,collector:any,reason:string|null=null,lastRos:any=null;
const calls=new Map<string,any>();
const end=(why:string)=>{reason??=why;aborter.abort();};
const signal=()=>end("PROCESS_INTERRUPTED");
process.on("SIGINT",signal);process.on("SIGTERM",signal);
const state=(status:string,extra:any={})=>{
 const v={take_id:takeId,session_id:session?.id,status,updated_at:iso(),directory:DIR,...extra};
 save("state.json",v);console.log(JSON.stringify(v));
};
async function permission(r:any,c:any){
 const tool=baseTool(String(r.toolCall?._meta?.["ai.agnes.harness"]?.tool||String(r.toolCall?.title||"").split(" ")[0]));
 let raw=r.toolCall?.rawInput;try{if(typeof raw==="string")raw=JSON.parse(raw);}catch{raw={};}
 const args=raw?.arguments??raw?.args??raw??{},matches=r.sessionId===session?.id;
 if(matches&&safeRead.has(tool)&&!aborter.signal.aborted&&!c.signal.aborted){
  append("permission-decisions.jsonl",{at:iso(),request_id:r.requestId,session_id:r.sessionId,tool,args,verdict:"allowed-once",scope:"Native safe read for the independent real UI opening"});
  return {verdict:"allowed-once"} as any;
 }
 if(matches&&motion.has(tool)&&!aborter.signal.aborted&&!c.signal.aborted){
  append("permission-decisions.jsonl",{at:iso(),request_id:r.requestId,session_id:r.sessionId,tool,args,verdict:"pending",scope:"No motion authorized by this opener; ordinary native request held until cancellation"});
  while(!aborter.signal.aborted&&!c.signal.aborted&&Date.now()<deadline)await wait(100);
  append("permission-decisions.jsonl",{at:iso(),request_id:r.requestId,tool,args,verdict:"rejected",reason:reason??"OPENER_WINDOW_ENDED"});
  return {verdict:"rejected"} as any;
 }
 append("permission-decisions.jsonl",{at:iso(),request_id:r.requestId,session_id:r.sessionId,tool,args,verdict:"rejected",reason:"OUTSIDE_OPENER_SAFE_READ_SCOPE"});
 return {verdict:"rejected"} as any;
}
save("preflight.json",{at:iso(),native:before,ros:rosBefore});
try{
 await client.initialize();
 const cfg=await client.config.get();
 if(cfg.provider?.id!=="agnes-ai"||cfg.provider?.model!=="agnes-3.0-flash")throw Error("AGNES_PROVIDER_REQUIRED");
 session=await client.session.new({cwd:ROOT,preset:"standard",sessionKey:takeId});
 await client.session.rename(session.id,"室内火灾人员搜寻");
 session.onPermissionRequest(permission);await session.attach();
 save("plan.json",{take_id:takeId,session_id:session.id,expected_ui_input:initialTask,preset:"standard",provider:"agnes-ai",model:"agnes-3.0-flash",sdk_prompt:false,sdk_steer:false,motion_approval:false,started_at:iso(),deadline:new Date(deadline).toISOString(),provenance:"Independent actual UI input/send opening take, to be editorially joined to a previously recorded real route body. It is not the same model invocation or a continuous single take.",previous_route_body_run:"guided-demo-1791910728138"});
 save("authorization.json",{basis:"Prior user authorization for complete recording and simulation operations; latest user requested actual typing and sending of the goal. This helper only prepares and observes a native session, approves safe reads, and never grants movement.",safe_read_tools:[...safeRead],motion:"Native motion requests remain pending until this opener is canceled."});
 iterator=session.events()[Symbol.asyncIterator]();
 collector=(async()=>{for(;;){
  const next=await iterator.next();if(next.done)break;
  const ev=next.value;append("native-events.jsonl",ev);
  if(ev.type==="user/message"){
   const text=(Array.isArray(ev.data?.content)?ev.data.content:[]).filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("\n");
   append("ui-user-input.jsonl",{observed_at:iso(),seq:ev.seq,ts:ev.ts,kind:ev.data?.kind,text,source:"Actual native user/message ledger; helper did not send this message",matches_expected_goal:text===initialTask});
   if(ev.data?.kind!=="runtime_context")state("UI_TASK_SENT",{actual_user_message_seq:ev.seq,actual_text:text,matches_expected_goal:text===initialTask});
  }
  if(ev.type==="tool/call")calls.set(ev.data.toolUseId,{tool:baseTool(ev.data.name??ev.data.toolName??ev.data.tool??""),args:ev.data.args??ev.data.arguments??{},call_seq:ev.seq});
  if(ev.type==="tool/result")append("tool-results.jsonl",{observed_at:iso(),event_seq:ev.seq,...calls.get(ev.data.toolUseId),result:normalized(ev.data.result??ev.data.content??ev.data)});
  if(ev.type==="turn/end")append("native-turn-end.jsonl",{observed_at:iso(),seq:ev.seq,data:ev.data});
 }})().catch((e:any)=>end("NATIVE_EVENT_STREAM_FAILED:"+String(e.message)));
 fs.writeFileSync(UI+"/native-session-target.json",JSON.stringify({session_id:session.id,reason:"Independent real UI task-input opening requested by the user",updated_at:iso()},null,2)+"\n");
 state("READY_FOR_UI_INPUT",{expected_ui_input:initialTask,stop_file:DIR+"/request-stop.json",expires_at:new Date(deadline).toISOString(),sdk_prompt:false,sdk_steer:false});
 while(!aborter.signal.aborted&&Date.now()<deadline){
  if(fs.existsSync(DIR+"/request-stop.json")){append("stop-request.jsonl",{at:iso(),request:read(DIR+"/request-stop.json")});end("EXPLICIT_OPENER_CAPTURE_ENDED");break;}
  const r=read(UI+"/ros-state.json");
  if(r.updated_at!==lastRos){lastRos=r.updated_at;append("ros-observer.jsonl",{observed_at:iso(),source:"Actual project ROS observer",state:r});}
  if(!Number.isFinite(r.updated_at)||Date.now()/1000-r.updated_at>5||Date.now()/1000-r.updated_at< -2)throw Error("ROS_OBSERVER_STALE");
  if(r.navigation?.motion_lease?.held||!r.velocity||["linear_x","linear_y","angular_z"].some(k=>!Number.isFinite(r.velocity[k])||Math.abs(r.velocity[k])>=.001))throw Error("UNEXPECTED_ROBOT_MOTION");
  await wait(250);
 }
 reason??="OPENER_WINDOW_ENDED";aborter.abort();
 await session.cancel();await wait(400);
 const finalRos=read(UI+"/ros-state.json");
 if(!Number.isFinite(finalRos.updated_at)||Date.now()/1000-finalRos.updated_at>5||Date.now()/1000-finalRos.updated_at< -2)throw Error("FINAL_ROS_OBSERVER_STALE");
 assertFreeMotionLease();
 if(finalRos.navigation?.motion_lease?.held||!finalRos.velocity||["linear_x","linear_y","angular_z"].some(k=>!Number.isFinite(finalRos.velocity[k])||Math.abs(finalRos.velocity[k])>=.001))throw Error("FINAL_ROBOT_IDLE_NOT_VERIFIED");
 save("final-ros-state.json",{at:iso(),state:finalRos});
 state("OPENER_COLLECTION_ENDED",{reason,native_session_canceled:true,robot_idle:true,sdk_prompt:false,sdk_steer:false});
}catch(e:any){
 reason??=String(e.message);aborter.abort();await session?.cancel().catch(()=>{});
 save("failure.json",{at:iso(),reason});state("FAILED",{reason});process.exitCode=1;
}finally{
 process.off("SIGINT",signal);process.off("SIGTERM",signal);
 await session?.detach().catch(()=>{});await client.close().catch(()=>{});
 await iterator?.return?.().catch(()=>{});await collector?.catch(()=>{});
}
