import fs from 'node:fs';
import {createClient,memoryJournal} from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
import {normalizeToolResult,evaluateMission} from '../interactive/mission-evaluator.mts';
const ROOT='/data-ssd/zhongchengkai/agnes',OUT=ROOT+'/artifacts/demo-ui-final';
const read=(name:string,fall:any=null)=>{try{return JSON.parse(fs.readFileSync(OUT+'/'+name,'utf8'));}catch{return fall;}};
const save=(name:string,data:any)=>{const p=OUT+'/'+name;fs.mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(p+'.tmp',p);};
const text=(v:any):string=>typeof v==='string'?v:typeof v?.text==='string'?v.text:Array.isArray(v?.content)?v.content.map(text).join('\n'):'';
const owner=JSON.parse(fs.readFileSync(ROOT+'/.agh-home-step7/data/daemon/owner.json','utf8'));
const client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});await client.initialize();
let initial:any=read('native-session-state.json',{}),sessionId=initial.session_id;
if(!sessionId){const s=await client.session.new({cwd:ROOT,preset:'standard',sessionKey:'demo-ui-native-'+Date.now()});sessionId=s.id;await client.session.rename(sessionId,'Agnes 救援机器人 · 现场演示');}
// projectUI/readToolDetail are the native Workbench's supported read APIs.
// No load, attach, prompt, approval callback, or worker close in this monitor.
const provider=await client.config.get();
let config:any={session_id:sessionId,web_url:'http://127.0.0.1:4177/?session='+encodeURIComponent(sessionId),workspace:ROOT,provider:{id:provider.provider?.id,model:provider.provider?.model,route:provider.provider?.route},native_assets:'third_party/agnes-harness/packages/cli/dist/local/web'};
const cache=new Map<string,any>();let lastUpto=-1,lastHealth=0;
async function health(){
 let mcp:any,tools:any;
 try{mcp=await client.mcp.servers.status({profile:'local-dev',serverId:'robot-mcp'});tools=await client.mcp.servers.tools.list({profile:'local-dev',serverId:'robot-mcp'});}
 catch(e:any){mcp={connectionState:'unavailable',error:String(e.message||e)};tools={items:[]};}
 const plugins=await client.packages.list({profile:'local-dev'});
 const p=plugins.packages.find((x:any)=>x.id==='embodied-rescue-plugin');
 const d=JSON.parse(fs.readFileSync(ROOT+'/.agh-home-step7/data/daemon/discovery.json','utf8'));
 config={...config,ws_url:d.web.url,origin:d.web.origin,checked_at:new Date().toISOString(),robot_mcp:{state:mcp.connectionState,tools:tools.items.map((x:any)=>x.name)},plugin:p?{id:p.id,actual:p.actual,desired:p.desired,trusted:p.trusted}:null};
 save('native-config.json',config);lastHealth=Date.now();
}
async function detail(n:any){
 const key=n.seq+':'+(n.resultSeq||'pending');if(cache.has(key))return cache.get(key);
 let offset=0,parts:Buffer[]=[];
 do{
  const chunk:any=await client.call('_agnes/v1/session.readToolDetail',{sessionId,callSeq:n.seq,...(n.resultSeq?{resultSeq:n.resultSeq}:{}),offset,maxBytes:262144});
  parts.push(Buffer.from(chunk.data,'base64'));if(chunk.nextOffset===null)break;offset=chunk.nextOffset;
  if(offset>4*1024*1024)throw Error('TOOL_DETAIL_TOO_LARGE_FOR_MONITOR');
 }while(true);
 const value=JSON.parse(Buffer.concat(parts).toString('utf8'));cache.set(key,value);save('native-sessions/'+encodeURIComponent(sessionId)+'/tool-'+n.seq+'-'+(n.resultSeq||'pending')+'.json',{session_id:sessionId,call_seq:n.seq,result_seq:n.resultSeq,detail:value});return value;
}
function evaluationMap() {
  try {
    const active=read('active-map.json');
    if (!active?.registry?.startsWith(ROOT+'/')) return undefined;
    const locations=JSON.parse(fs.readFileSync(active.registry,'utf8')).locations;
    const registryPath=active.registry.slice(0,active.registry.lastIndexOf('/'))+'/interaction-registry.json';
    const doors=JSON.parse(fs.readFileSync(registryPath,'utf8')).doors;
    return {locations,doors};
  } catch { return undefined; }
}
function spanTimes(span:any,lookup:any={}){if(!span)return lookup;if(span.toolUseId)lookup[span.toolUseId]=span;for(const child of span.children||[])spanTimes(child,lookup);return lookup;}
while(true){
 try{
  const target=read('native-session-target.json');
  if(target?.session_id && target.session_id!==sessionId){
   sessionId=target.session_id;cache.clear();lastUpto=-1;lastHealth=0;
   config={...config,session_id:sessionId,web_url:'http://127.0.0.1:4177/?session='+encodeURIComponent(sessionId)};
  }
  if(Date.now()-lastHealth>10000)await health();
  const timeline:any=await client.call('_agnes/v1/session.projectUI',{sessionId,surface:'web'});
  const turn=timeline.turns?.at(-1),ids=new Set(turn?.nodeIds||[]),nodes=timeline.nodes.filter((n:any)=>ids.has(n.id)),user=nodes.findLast((n:any)=>n.kind==='user'),times=spanTimes(turn?.trace);
  let events:any[]=[];
  for(const n of nodes.filter((n:any)=>n.kind==='tool')){
   const d=await detail(n),ts=times[n.toolUseId];
   events.push({sequence:n.seq,type:'tool_call',timestamp:ts?.startedAt||turn?.startedAt,tool:n.name,tool_call_id:n.toolUseId,args:d.call?.args||{},native_node_id:n.id,call_seq:n.seq});
   if(n.resultSeq&&d.result)events.push({sequence:n.resultSeq,type:'tool_result',timestamp:ts?.endedAt||turn?.endedAt||null,tool:n.name,tool_call_id:n.toolUseId,result:normalizeToolResult(d.result),native_node_id:n.id,call_seq:n.seq,result_seq:n.resultSeq});
  }
  events.sort((a,b)=>a.sequence-b.sequence);
  const report=nodes.filter((n:any)=>n.kind==='assistant'&&n.text).at(-1)?.text||'',task=text(user);
  let outcome:any=null,status=turn?(['running','waiting'].includes(turn.status)?'RUNNING':turn.status==='cancelled'?'CANCELED':turn.status==='failed'?'FAILED':'COMPLETED'):'IDLE';
  if(turn&&!['running','waiting'].includes(turn.status)){
   outcome=evaluateMission(task,events,report,turn.status==='completed'?null:{code:turn.reason||turn.status,...turn.error},turn.status==='cancelled',undefined,null,evaluationMap());
   if(/get_robot_state|机器人.*(哪里|位置|状态)|where.*robot|当前.*位置/i.test(task)&&!events.some((e:any)=>e.type==='tool_result'&&/get_robot_state$/.test(e.tool)&&Number.isFinite(e.result?.pose?.x)))outcome={...outcome,status:'FAILED',reasons:[...(outcome.reasons||[]),'READONLY_ROBOT_STATE_NOT_OBSERVED'],decision:{status:'FAILED',reasons:['READONLY_ROBOT_STATE_NOT_OBSERVED']}};
   status=outcome.status;
  }
  const pending=nodes.filter((n:any)=>n.kind==='approval'&&n.state!=='decided');
  let stage=status==='IDLE'?'等待原生聊天任务':status==='RUNNING'?'Agent 正在思考':'真实 turn 结束 · '+status;
  if(status==='RUNNING'&&events.length)stage='工具 · '+events.at(-1).tool;
  if(pending.length)stage='请在原生聊天中批准工具';
  const state={session_id:sessionId,mission_id:turn?'native-'+sessionId+'-turn-'+turn.turn:null,prompt_turn_id:turn?.id||null,last_seq:timeline.upto,task:task||null,status,stage,events,report,outcome,pending_approvals:pending.map((n:any)=>({summary:n.summary,request_seq:n.requestSeq})),pending_inputs:timeline.pendingInputs,started_at:turn?.startedAt,finished_at:turn?.endedAt,turn_end:turn?{status:turn.status,reason:turn.reason,endSeq:turn.endSeq}:null,observer_updated_at:new Date().toISOString(),observer_connected:client.connectionState==='connected',source:'official native Workbench projectUI + full readToolDetail; read-only monitor'};
  save('native-session-state.json',state);
  if(timeline.upto!==lastUpto){
   save('native-projection.json',timeline);save('native-sessions/'+encodeURIComponent(sessionId)+'/projection.json',timeline);
   fs.appendFileSync(OUT+'/projection-changes.jsonl',JSON.stringify({observed_at:new Date().toISOString(),session_id:sessionId,upto:timeline.upto,turn:turn?.id,status,tool_calls:events.filter((x:any)=>x.type==='tool_call').map((x:any)=>({name:x.tool,call_seq:x.call_seq,tool_call_id:x.tool_call_id}))})+'\n');
   if(outcome)save('native-sessions/'+encodeURIComponent(sessionId)+'/turn-'+turn.turn+'.json',state);lastUpto=timeline.upto;
  }
 }catch(e:any){const state=read('native-session-state.json',{session_id:sessionId,status:'UNKNOWN'});save('native-session-state.json',{...state,observer_updated_at:new Date().toISOString(),observer_connected:false,observer_error:String(e.message||e).slice(0,300)});fs.appendFileSync(OUT+'/observer-errors.log',new Date().toISOString()+' '+String(e.message||e)+'\n');}
 await new Promise(resolve=>setTimeout(resolve,750));
}
