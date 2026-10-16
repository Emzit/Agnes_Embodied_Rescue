import fs from 'node:fs';
import {createClient,memoryJournal} from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
const R='/data-ssd/zhongchengkai/agnes';if(process.cwd()!==R)throw Error('WORKSPACE_REQUIRED');
const owner=JSON.parse(fs.readFileSync(R+'/.agh-home-step7/data/daemon/owner.json','utf8'));
const c=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});await c.initialize();
const out=R+'/artifacts/demo-project-film-20261014/revision-autonomous-v12';
try{
 const clientId=await c.clientId(),profile='local-dev',source={type:'file' as const,ref:'file:./packages/embodied-rescue-plugin'};
 const before=await c.packages.list({profile});fs.writeFileSync(out+'/plugin-list-before.json',JSON.stringify(before,null,2));
 const receipt=await c.packages.inspect({profile,clientId,commandId:'target-evidence-inspect-'+Date.now(),source});
 let op:any;for(let i=0;i<100;i++){op=await c.packages.operation.get({profile,operationId:receipt.operationId});if(['completed','failed','cancelled'].includes(op.state))break;await new Promise(r=>setTimeout(r,200));}
 fs.writeFileSync(out+'/plugin-inspection.json',JSON.stringify(op,null,2));
 const current=(before as any).packages.find((p:any)=>p.id==='embodied-rescue-plugin'), preview=op.preview;
 if(op.state!=='completed'||!current.trusted||current.desired!=='enabled'||preview.capabilityHash!==current.capabilityHash||Object.values(preview.capabilityDiff).some((v:any)=>Array.isArray(v)&&v.length))throw Error('UNCHANGED_ALREADY_TRUSTED_CAPABILITIES_REQUIRED');
 const update=await c.packages.update({profile,clientId,commandId:'target-evidence-update-'+Date.now(),id:current.id,source,expectedIntegrity:preview.integrity,activation:{expectedInstalledIntegrity:current.integrity,expectedActiveIntegrity:current.actualIntegrity,trust:{integrity:preview.integrity,capabilityHash:preview.capabilityHash}}});
 for(let i=0;i<180;i++){op=await c.packages.operation.get({profile,operationId:update.operationId});if(['completed','failed','cancelled','rolled-back'].includes(op.state))break;await new Promise(r=>setTimeout(r,200));}
 fs.writeFileSync(out+'/plugin-update.json',JSON.stringify(op,null,2));if(op.state!=='completed')throw Error('PACKAGE_UPDATE_FAILED:'+JSON.stringify(op.error));
 const after=await c.packages.list({profile});fs.writeFileSync(out+'/plugin-list-after.json',JSON.stringify(after,null,2));console.log(JSON.stringify({status:op.state,operation:op.operation,preview_integrity:preview.integrity,capabilities_unchanged:true}));
}finally{await c.close();}
