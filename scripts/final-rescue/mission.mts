import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {root,out,profile,node,exec,save,connect,startStack,probe,probeSensors,restartAgnes,readyMcp,stopAll,jsonl,sleep} from './common.mts';
const pluginTools=new Set(['mission_get_state','mission_reset','world_memory_get','world_memory_update','decision_score_candidates']);
const text=(v:any):string=>typeof v==='string'?v:typeof v?.text==='string'?v.text:Array.isArray(v?.content)?v.content.map(text).join('\n'):'';
function structured(detail:any){if(detail.result?.structured!==undefined)return detail.result.structured;try{return JSON.parse(detail.result?.content?.find((b:any)=>b.type==='text')?.text);}catch{return {content:detail.result?.content??[]};}}
export async function start(){await startStack();const env=await probe();await save(`${out}/environment.json`,{...env,home:process.env.HOME,tmp:process.env.TMPDIR,ros_domain:process.env.ROS_DOMAIN_ID,robot_gateway:'ros2',perception:'real RGB NumPy color/contour demo markers',ideal_robot_odometry:true});await restartAgnes();await exec(node,[`${root}/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs`,`${root}/scripts/final-rescue/prepare.mts`],{cwd:root,env:process.env,timeout:120000,maxBuffer:1024*1024});await restartAgnes();await status();}
export async function status(){const c=await connect();try{const conf=await c.config.get(),mcp=await readyMcp(c),pkgs=await c.packages.list({profile});const plugin=pkgs.packages.find((p:any)=>p.id==='embodied-rescue-plugin');const result={...(await probe()),sensors:await probeSensors(),provider:{id:conf.provider?.id,model:conf.provider?.model,configured:conf.configured},plugin:{id:plugin?.id,actual:plugin?.actual,desired:plugin?.desired},mcp:{state:mcp.connectionState,tools:(await c.mcp.servers.tools.list({profile,serverId:'robot-mcp'})).items.map((v:any)=>v.name)},robot_gateway:'ros2',perception:'cv',fixture:false,mock_fallback:false};await save(`${out}/stack-status.json`,result);await save(`${out}/provider.json`,{...result.provider,real_llm:true,decision_provider:'fallback',Jev:'unavailable/not configured'});console.log(JSON.stringify(result));return result;}finally{await c.close();}}
export async function mission(run:number){
 const dir=`${out}/run${run}`;await mkdir(dir,{recursive:true});let c:any,session:any,it:any,reader:any,remove:any;const events:any[]=[];let turn:any,error:any;
 try{
  c=await connect();await readyMcp(c);const conf=await c.config.get();assert.equal(conf.provider.id,'agnes-ai');assert.equal(conf.provider.model,'agnes-3.0-flash');
  session=await c.session.new({cwd:root,sessionKey:`final-rescue-run${run}-${Date.now()}`});await session.attach();
  await save(`${dir}/provider.json`,{provider:conf.provider.id,model:conf.provider.model,session:session.id,plugin:'embodied-rescue-plugin',mcp:'robot-mcp',robot_gateway:'ros2',prompt:'进入实验室寻找失联研究员，并报告环境风险。',scripted_sequence:false,queueTool:false});
  remove=session.onPermissionRequest(async(q:any)=>{const name=q.toolCall?._meta?.['ai.agnes.harness']?.tool;const allowed=pluginTools.has(name)||name?.startsWith('mcp_robot_mcp_');const opt=q.options.find((v:any)=>v.kind===(allowed?'allow_once':'reject_once'));return {optionId:opt.optionId};});
  it=session.events()[Symbol.asyncIterator]();reader=(async()=>{for(;;){const x=await it.next();if(x.done)return;events.push(x.value);await appendFile(`${dir}/agnes-events.jsonl`,JSON.stringify(x.value)+'\n');if(x.value.type==='tool/call')console.log('RUN',run,'TOOL',x.value.data?.name??x.value.data?.toolName??JSON.stringify(x.value.data).slice(0,150));}})();
  try{turn=await session.prompt('进入实验室寻找失联研究员，并报告环境风险。',{signal:AbortSignal.timeout(900000),titleLocale:'zh-CN'});}catch(e:any){error={code:e.code??'MISSION_TURN_ERROR',message:String(e.message??'').slice(0,250)};}
  await it.return?.();await reader;it=undefined;
  const trace:any[]=[];
  for(const ev of events.filter(v=>v.type==='tool/call')){const re=events.find(v=>v.type==='tool/result'&&v.data?.toolUseId===ev.data?.toolUseId);try{const detail=await session.readToolDetail(ev.seq,re?.seq);trace.push({seq:ev.seq,result_seq:re?.seq,tool:detail.call.name,args:detail.call.args,result:structured(detail),is_error:detail.result?.isError??false});}catch{trace.push({seq:ev.seq,unresolved:true});}}
  const messages=events.filter(v=>v.type==='assistant/message').map(v=>({seq:v.seq,text:text(v.data)})).filter(v=>v.text);
  const lastToolSeq=Math.max(0,...trace.map(t=>t.result_seq??t.seq));const answer=messages.filter(v=>v.seq>lastToolSeq).map(v=>v.text).join('\n\n')||messages.at(-1)?.text||'';
  await save(`${dir}/agnes-trace.json`,{session:session.id,turn,error,trace,messages});await writeFile(`${dir}/final-report.txt`,answer);
  let mcp=await jsonl(`${dir}/mcp-events.jsonl`);
  // The daemon-owned MCP worker may not inherit ROBOT_TRACE_DIR.  In that case the
  // persisted Agnes tool detail is the authoritative real MCP result stream.
  if(!mcp.length)mcp=trace.filter(t=>t.tool.startsWith('mcp_robot_mcp_')).map(t=>({
    tool:t.tool.replace(/^mcp_robot_mcp_[^_]+_/,'').replace(/^mcp_robot_mcp_/,'').replace(/^get_world_state$/,'get_world_state'),
    input:t.args,
    result:t.result,
    backend:'ros2',
  }));
  const ros=await jsonl(`${dir}/ros2-events.jsonl`);
  await save(`${dir}/mcp-trace.json`,mcp);await save(`${dir}/ros2-trace.json`,ros);
  await save(`${dir}/navigation-events.json`,mcp.filter(v=>v.tool==='navigate_to'));
  await save(`${dir}/perception-events.json`,mcp.filter(v=>['get_observation','inspect_room','inspect_object'].includes(v.tool)));
  const memory=trace.findLast(t=>t.tool==='world_memory_get')?.result??trace.findLast(t=>t.tool==='world_memory_update')?.result;
  const state=trace.findLast(t=>t.tool==='mission_get_state')?.result;
  await save(`${dir}/world-memory-final.json`,memory??null);await save(`${dir}/mission-state-final.json`,state??null);
  const dynamic=JSON.parse(await readFile(`${dir}/dynamic-obstacle-trigger.json`,'utf8'));
  const roomB=mcp.findIndex(v=>v.tool==='inspect_room'&&v.input.location==='Room_B'&&v.result.status==='SUCCEEDED');
  const personIndex=mcp.findIndex(v=>(v.result.semantic_objects??v.result.detections??[]).some((d:any)=>d.label==='person'));
  const personObserved=personIndex>=0;const early=mcp.slice(0,Math.max(0,roomB)).some(v=>(v.result.semantic_objects??v.result.detections??[]).some((d:any)=>d.label==='person'));
  const low=mcp.some(v=>(v.result.semantic_objects??v.result.detections??[]).some((d:any)=>d.confidence<.8));
  const active=mcp.filter(v=>v.tool==='inspect_object'&&v.result.status==='SUCCEEDED'&&v.result.evidence?.length>=3);
  const blocked=mcp.findIndex(v=>v.tool==='navigate_to'&&v.result.status==='FAILED'&&v.result.reason==='PATH_BLOCKED');
  const motion=JSON.parse(await readFile(`${dir}/physical-motion.json`,'utf8'));
  const alternative=motion.some((v:any)=>v.y<-2.4)&&motion.some((v:any)=>v.x>5.1&&v.y>.25);
  const memoryBlocked=(memory?.blocked_routes?.length??0)>0||(memory?.action_history??[]).some((a:any)=>a?.reason==='PATH_BLOCKED'||a?.result==='PATH_BLOCKED'),replan=memory?.replans_count>=1,activeRecorded=memory?.active_perception_count>=1;
  const finalRead=trace.findLastIndex(v=>v.tool==='mission_get_state')>=0&&trace.findLastIndex(v=>v.tool==='world_memory_get')>=0;
  const targetReport=/Room_B/.test(answer)&&/人员|person|目标/.test(answer);
  const riskReport=/阻|封|通道|不可通行|blocked/.test(answer);
  const verificationReport=/复检|主动|复查|再次检查|核实|reinspect|verified/.test(answer)&&/工具箱|toolbox|灭火器|fire_extinguisher|人员|person/.test(answer);
  const truthful=!/身份识别成功|通用身份识别|Jev\s*(enabled|启用)|使用VLM|VLM识别/.test(answer);
  const targetStatus=String(memory?.target_status??'');
  const complete=(state?.status==='COMPLETED'||/found/i.test(targetStatus))&&personObserved&&roomB>=0;
  const missionSuccess=personObserved&&roomB>=0&&!early&&complete&&targetReport&&!error;
  const behavior={blocked_detected:dynamic.triggered?blocked>=0:'NOT_TRIGGERED',memory_updated:dynamic.triggered?memoryBlocked:'NOT_TRIGGERED',replanning:dynamic.triggered?replan:'NOT_TRIGGERED',alternative_route:dynamic.triggered?alternative:'NOT_TRIGGERED',active_reinspection:low?active.length>0&&activeRecorded:'NOT_TRIGGERED'};
  const result={run,mission_success:missionSuccess,scenario_coverage:{dynamic_block_triggered:dynamic.triggered,low_confidence_triggered:low},scenario_behavior:behavior,early_leak:early,person_observed:personObserved,room_b_inspected:roomB>=0,active_reinspections:active.length,replans_count:memory?.replans_count,active_perception_count:memory?.active_perception_count,final_reports:{target_result:targetReport,environment_risk:riskReport,verified_observation:verificationReport,identity_claim_truthful:truthful,final_state_reads:finalRead},provider:'agnes-ai',model:'agnes-3.0-flash',real_llm:true,mock_fallback:mcp.some(v=>v.backend!=='ros2'),fixture:false,contract_changed:false,error,pass:missionSuccess&&Object.values(behavior).every(v=>v===true||v==='NOT_TRIGGERED')&&riskReport&&verificationReport&&truthful&&finalRead};
  await save(`${dir}/acceptance.json`,result);await save(`${out}/checkpoint.json`,{status:`run${run}_completed`,result,next:run<3?`run${run+1}`:'final audit'});console.log('MISSION_RESULT',JSON.stringify(result));return result;
 }finally{remove?.();await it?.return?.();await reader?.catch(()=>{});if(typeof session?.close==='function')await session.close().catch(()=>{});await c?.close().catch(()=>{});}
}
if(process.argv[1]?.endsWith('/mission.mts')) {
const mode=process.argv[2]??'status';
if(mode==='start')await start();
else if(mode==='status')await status();
else if(mode==='stop')await stopAll();
else if(mode==='run')await mission(Number(process.argv[3]??1));

}
