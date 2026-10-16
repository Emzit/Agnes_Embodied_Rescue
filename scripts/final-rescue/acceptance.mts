import {readFile,readdir,writeFile,cp} from 'node:fs/promises';
import {root,out,exec,node,save,startStack,probe,restartAgnes,stopAll,sleep} from './common.mts';
import {start,mission} from './mission.mts';
const tracked=new Map<number,string>();
async function identity(pid:number){try{const s=(await readFile(`/proc/${pid}/stat`,'utf8')).split(') ')[1].split(' ');return s[0]==='Z'?null:s[19];}catch{return null;}}
async function descendants(pid:number):Promise<number[]>{try{const tasks=await readdir(`/proc/${pid}/task`);const children=(await Promise.all(tasks.map(async t=>{try{return (await readFile(`/proc/${pid}/task/${t}/children`,'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);}catch{return [];}}))).flat();return [pid,...(await Promise.all([...new Set(children)].map(descendants))).flat()];}catch{return [];}}
async function track(){const pids:number[]=[];try{const r=JSON.parse(await readFile(`${root}/.runtime-final_rescue/processes.json`,'utf8'));pids.push(...r.entries.map((e:any)=>e.pid));}catch{}try{const r=JSON.parse(await readFile(`${out}/agnes-owned.json`,'utf8'));pids.push(r.pid);}catch{}for(const pid of pids)for(const child of await descendants(pid)){const id=await identity(child);if(id)tracked.set(child,id);}}
const results:any[]=[];let fatal:any;
const startRun=Number(process.env.FINAL_START_RUN??1);
for(let previous=1;previous<startRun;previous++){try{results.push(JSON.parse(await readFile(`${out}/run${previous}/acceptance.json`,'utf8')));}catch{}}
try{
 for(let run=startRun;run<=Number(process.env.FINAL_END_RUN??3);run++){
  process.env.FINAL_RUN_DIR=`${out}/run${run}`;process.env.ROBOT_TRACE_DIR=process.env.FINAL_RUN_DIR;
  await stopAll();
  console.log('RUN_START',run);
  if(run===1)await start();else {await startStack();await probe();await restartAgnes();}
  await track();
  try{results.push(await mission(run));}finally{await track();await stopAll();await sleep(1000);}
  if(!results.at(-1)?.pass){console.log('RUN_REQUIRES_DEBUG',run);break;}
 }
}catch(e:any){fatal={name:e.name,message:String(e.message).slice(0,500)};console.log('HARNESS_ERROR',JSON.stringify(fatal));}
finally{
 await track();await stopAll().catch(()=>{});await sleep(1000);
 const remaining=[];for(const [pid,id] of tracked)if(await identity(pid)===id)remaining.push(pid);
 await save(`${out}/process-cleanup.json`,{tracked:[...tracked].map(([pid,start_time])=>({pid,start_time})),remaining_pids:remaining,all_stopped:!remaining.length,preexisting_step7_web_ui_preserved:true});
 const all=[];for(let i=1;i<=3;i++){try{all.push(JSON.parse(await readFile(`${out}/run${i}/acceptance.json`,'utf8')));}catch{}}
 const success=all.filter(r=>r.mission_success).length,dynamic=all.filter(r=>r.scenario_coverage?.dynamic_block_triggered).length,active=all.filter(r=>r.active_reinspections>0).length;
 const summary={runs:all,completed_runs:all.length,mission_success:success,dynamic_block_coverage:dynamic,active_perception_coverage:active,all_pass:all.length===3&&all.every(r=>r.pass)&&dynamic>=2&&active>=2,cleanup:!remaining.length,fatal};
 await save(`${out}/robustness-summary.json`,summary);await save(`${out}/acceptance.json`,{passed:summary.all_pass&&!remaining.length,result:summary.all_pass&&!remaining.length?'PENDING_FINAL_REGRESSION_AUDIT':'FINAL_RESCUE_E2E_PARTIAL',...summary});
 if(!summary.all_pass||remaining.length)process.exitCode=1;
}
