import fs from 'node:fs';
import {createClient,memoryJournal} from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
const ROOT='/data-ssd/zhongchengkai/agnes',OUT=ROOT+'/artifacts/demo-ui-final';
const conf=JSON.parse(fs.readFileSync(OUT+'/native-config.json','utf8')),owner=JSON.parse(fs.readFileSync(ROOT+'/.agh-home-step7/data/daemon/owner.json','utf8'));
const client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});await client.initialize();
const permission=async(q:any)=>{const n=q.toolCall?._meta?.['ai.agnes.harness']?.tool||'';const allow=/mcp_robot_mcp_.*_(get_robot_state|list_known_locations)$/.test(n);const opt=q.options.find((x:any)=>x.kind===(allow?'allow_once':'reject_once'));if(!opt)throw Error('NO_MATCHING_PERMISSION');return{optionId:opt.optionId};};
const session=await client.session.load(conf.session_id,{cwd:ROOT,onPermissionRequest:permission});
const events:any[]=[];const iterator=session.events()[Symbol.asyncIterator]();const reader=(async()=>{for(;;){const n=await iterator.next();if(n.done)return;events.push(n.value);}})();
let turn:any,error:any;
try{turn=await session.prompt('现在机器人在哪里？请只读调用真实 Robot MCP 的 get_robot_state，报告 map 坐标、朝向和导航状态。禁止移动、停止、修改任务或调用其他动作。',{titleLocale:'zh-CN',signal:AbortSignal.timeout(120000)});}catch(e:any){error={code:e.code,message:e.message};}
await iterator.return?.();await reader;
const calls=events.filter(e=>e.type==='tool/call'),results=events.filter(e=>e.type==='tool/result');
const record={session_id:session.id,source:'SDK integration regression against the exact native Web Session; browser input not claimed',turn,error,tool_calls:calls,tool_results:results,assistant:events.filter(e=>e.type==='assistant/message'),pass:!error&&turn?.reason==='completed'&&calls.some(e=>/get_robot_state$/.test(e.data.name))};
fs.writeFileSync(OUT+'/readonly-test.json',JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({pass:record.pass,session_id:session.id,reason:turn?.reason,error}));
await client.close();
