import fs from 'node:fs';
import {beginPackageProfileTransaction,restorePackageProfileTransaction} from './profile-package-transaction.mjs';
import {createClient,memoryJournal} from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
const ROOT='/data-ssd/zhongchengkai/agnes',OUT=ROOT+'/artifacts/demo-ui-final',profile='local-dev';
const [mode,job]=process.argv.slice(2);if(!/^[a-f0-9-]{36}$/.test(job||''))throw Error('INVALID_JOB');
const dir=OUT+'/scene-switch/jobs/'+job;
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p:string,v:any)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2)+'\n');fs.renameSync(p+'.tmp',p);};
const owner=read(ROOT+'/.agh-home-step7/data/daemon/owner.json');
const client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});await client.initialize();
const identity={profile,clientId:await client.clientId()},wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const command=(n:string)=>'scene-'+job+'-'+n+'-'+Date.now();
async function op(receipt:any,kind='resource'){
 for(let n=0;n<600;n++){
  const v=kind==='package'?await client.packages.operation.get({profile,operationId:receipt.operationId}):await client.resources.operation.get({profile,operationId:receipt.operationId});
  save(dir+'/operation-'+kind+'-'+receipt.operationId+'.json',v);
  if(['failed','cancelled','rolled-back'].includes(v.state))throw Error('RESOURCE_OPERATION_FAILED:'+JSON.stringify(v.error||v.lastSafeError||v.state));
  if(['succeeded','completed'].includes(v.state))return v;await wait(100);
 }throw Error('RESOURCE_OPERATION_TIMEOUT');
}
async function guard(){
 const conf=read(OUT+'/native-config.json');
 const t:any=await client.call('_agnes/v1/session.projectUI',{sessionId:conf.session_id,surface:'web'});
 const last=t.turns?.at(-1);
 if(last&&['running','waiting'].includes(last.status)||t.pendingInputs?.length||t.nodes?.some((n:any)=>n.kind==='approval'&&n.state!=='decided'))throw Error('NATIVE_SESSION_BUSY');
 return {session_id:conf.session_id,turn_status:last?.status||'IDLE',upto:t.upto,checked_at:new Date().toISOString()};
}
try{
 if(mode==='check'){save(dir+'/native-before.json',await guard());}
 else if(mode==='disable'){
  await guard();
  const servers=[];
  for(const serverId of ['robot-mcp','envdoor']){
   const d=await client.mcp.servers.get({profile,serverId});
   if(d.trust!=='trusted'||d.desired!=='enabled')throw Error('EXISTING_MCP_NOT_READY:'+serverId);
   servers.push({serverId,desired:d.desired,trust:d.trust,definition:d.definition});
  }
  const plugin=(await client.packages.list({profile})).packages.find((x:any)=>x.id==='embodied-rescue-plugin');
  if(plugin?.actual!=='running'||!plugin.trusted||plugin.desired!=='enabled')throw Error('EXISTING_PLUGIN_NOT_READY');
  save(dir+'/resources-before.json',{servers,plugin:{id:plugin.id,integrity:plugin.integrity,trusted:plugin.trusted}});
  for(const row of servers){
   const d=await client.mcp.servers.get({profile,serverId:row.serverId});
   await op(await client.mcp.servers.disable({...identity,serverId:row.serverId,expectedRevision:d.revision,commandId:command('disable-'+row.serverId)}));
  }
  // AGH refuses package disable while profile.yaml still declares it. Withdraw only
  // this already-trusted declaration, then use the official package lifecycle.
  beginPackageProfileTransaction({profilePath:ROOT+'/.agh-home-step7/profiles/local-dev/profile.yaml',jobDir:dir,packageId:plugin.id});
  await op(await client.packages.disable({...identity,id:plugin.id,commandId:command('plugin-disable')}),'package');
 }
 else if(mode==='enable'){
  try{
  const before=read(dir+'/resources-before.json'),rows=[];
  for(const row of before.servers){
   const d=await client.mcp.servers.get({profile,serverId:row.serverId});
   if(d.trust!==row.trust)throw Error('MCP_TRUST_CHANGED');
   if(d.desired!=='enabled')await op(await client.mcp.servers.enable({...identity,serverId:row.serverId,expectedRevision:d.revision,commandId:command('enable-'+row.serverId)}));
   let status:any;
   for(let n=0;n<200;n++){status=await client.mcp.servers.status({profile,serverId:row.serverId});if(status.connectionState==='ready')break;await wait(100);}
   const tools=await client.mcp.servers.tools.list({profile,serverId:row.serverId});
   if(status.connectionState!=='ready'||row.serverId==='robot-mcp'&&tools.items.length!==8)throw Error('MCP_NOT_READY:'+row.serverId);
   rows.push({serverId:row.serverId,state:status.connectionState,tools:tools.items.map((x:any)=>x.name)});
  }
  let plugin=(await client.packages.list({profile})).packages.find((x:any)=>x.id===before.plugin.id);
  if(plugin?.integrity!==before.plugin.integrity||!plugin?.trusted)throw Error('PLUGIN_IDENTITY_CHANGED');
  if(plugin.desired!=='enabled')await op(await client.packages.enable({...identity,id:plugin.id,expectedInstalledIntegrity:before.plugin.integrity,commandId:command('plugin-enable')}),'package');
  for(let n=0;n<100;n++){plugin=(await client.packages.list({profile})).packages.find((x:any)=>x.id===before.plugin.id);if(plugin?.actual==='running')break;await wait(100);}
  if(plugin?.actual!=='running')throw Error('PLUGIN_NOT_RUNNING');
  save(dir+'/resources-after.json',{rows,plugin:{id:plugin.id,actual:plugin.actual,integrity:plugin.integrity}});
  }finally{save(dir+'/profile-restoration.json',restorePackageProfileTransaction(dir));}
 }
 else if(mode==='session'){
  const plan=read(dir+'/plan-public.json'),s=await client.session.new({cwd:ROOT,preset:'standard',sessionKey:'demo-ui-native-'+Date.now()});
  await client.session.rename(s.id,'Agnes · '+plan.map_name+' · seed '+plan.seed);
  const target={session_id:s.id,map_id:plan.map_id,seed:plan.seed,job_id:job,created_at:new Date().toISOString(),reason:'new physical world; fresh native Session and reloaded plugin memory'};
  save(dir+'/native-after.json',target);save(OUT+'/native-session-target.json',target);
 }else throw Error('INVALID_MODE');
 console.log(JSON.stringify({pass:true,mode,job}));
}finally{await client.close();}
