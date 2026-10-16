import fs from 'node:fs';
import {createClient,memoryJournal} from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
const R='/data-ssd/zhongchengkai/agnes',profile='local-dev',OUT=R+'/artifacts/demo-video-20261013';
if(process.cwd()!==R)throw Error('WORKSPACE_REQUIRED');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const active=read(OUT+'/active-run.json');
if(active.status!=='NEEDS_REVIEW'||!/^guided-demo-\d+$/.test(active.run_id))throw Error('STOPPED_RUN_REQUIRED');
const D=OUT+'/runs/'+active.run_id, approval=read(D+'/human-approval.json');
if(approval.authorized!==true||approval.run_id!==active.run_id||approval.session_id!==active.session_id||Date.parse(approval.expires_at)<Date.now())throw Error('ACTIVE_SCOPED_APPROVAL_REQUIRED');
function idle(){const r=read(R+'/artifacts/demo-ui-final/ros-state.json');if(Date.now()/1000-r.updated_at>5||r.navigation?.status!=='IDLE'||r.navigation?.motion_lease?.held||Object.values(r.velocity||{}).some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>.01))throw Error('ROBOT_NOT_IDLE');}
idle();
const owner=read(R+'/.agh-home-step7/data/daemon/owner.json'), client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});
await client.initialize();
try{
const ui:any=await client.call('_agnes/v1/session.projectUI',{sessionId:active.session_id,surface:'web'});
if(['running','waiting'].includes(ui.turns?.at(-1)?.status)||ui.pendingInputs?.length||ui.nodes?.some((n:any)=>n.kind==='approval'&&n.state!=='decided'))throw Error('NATIVE_BUSY');
const serverId='robot-mcp',def=await client.mcp.servers.get({profile,serverId});
if(def.trust!=='trusted'||def.desired!=='enabled')throw Error('TRUSTED_ENABLED_SERVER_REQUIRED');
idle();
const receipt=await client.mcp.servers.reconnect({profile,clientId:await client.clientId(),serverId,expectedRevision:def.revision,commandId:'demo-compact-result-reload-'+Date.now()});
for(let i=0;i<300;i++){
const op=await client.resources.operation.get({profile,operationId:receipt.operationId});
if(['completed','succeeded'].includes(op.state))break;
if(['failed','cancelled','rolled-back'].includes(op.state))throw Error('RECONNECT_FAILED');
if(i===299)throw Error('RECONNECT_TIMEOUT');
await new Promise(r=>setTimeout(r,100));
}
const state=await client.mcp.servers.status({profile,serverId});
if(state.connectionState!=='ready')throw Error('NOT_READY');
const result={at:new Date().toISOString(),run_id:active.run_id,server_id:serverId,status:state.connectionState,physical_reset:false,robot_actions:0,model_calls:0};
fs.appendFileSync(D+'/tool-reloads.jsonl',JSON.stringify(result)+'\n');console.log(JSON.stringify(result));
}finally{await client.close();}
