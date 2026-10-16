/** Stop a known run operation through its existing ROS bridge; never a new bridge. */
import fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
const R="/data-ssd/zhongchengkai/agnes",B=R+"/runtime/motion-stop";
const ROS=R+"/artifacts/demo-ui-final/ros-state.json",LEASE=R+"/runtime/motion-control.lock";
const token=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
type Input={runId:string;operationIds:Iterable<string>;timeoutMs?:number};
type IO={now:()=>number;sleep:(ms:number)=>Promise<void>;read:(file:string)=>Promise<any>;
  writeRequest:(request:any)=>Promise<void>;readAck:(requestId:string)=>Promise<any>;id:()=>string};
async function read(file:string){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch{return null;}}
async function directory(file:string){
  try{await fs.mkdir(file,{mode:0o700});}catch(e:any){if(e.code!=="EEXIST")throw e;}
  const info=await fs.lstat(file);
  if(!info.isDirectory()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw Error("PRIVATE_STOP_DIRECTORY_REQUIRED");
}
async function writeRequest(request:any){
  await directory(B);await directory(B+"/requests");
  const file=B+"/requests/"+request.operation_id+".json";
  const temporary=file+"."+request.request_id+".tmp";
  await fs.writeFile(temporary,JSON.stringify(request),{mode:0o600,flag:"wx"});
  await fs.rename(temporary,file);
}
async function readAck(requestId:string){
  const file=B+"/results/"+requestId+".json";
  try{
    const info=await fs.lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)return null;
    return await read(file);
  }catch{return null;}
}
const safeRos=(r:any,now:number)=>Number.isFinite(now)&&r&&r.ros_domain_id===106&&Number.isFinite(r.updated_at)&&
  now/1000-r.updated_at>=0&&now/1000-r.updated_at<3&&Number.isFinite(r.pose_age_ms)&&r.pose_age_ms>=0&&r.pose_age_ms<2500;
const zero=(r:any)=>r?.velocity&&["linear_x","linear_y","angular_z"].every(k=>Number.isFinite(r.velocity[k])&&Math.abs(r.velocity[k])<.001);
const idle=(r:any)=>r?.navigation?.status==="IDLE"&&Array.isArray(r.navigation.active_goals)&&r.navigation.active_goals.length===0&&zero(r);
const sameOwner=(a:any,b:any)=>a&&b&&a.operation_id===b.operation_id&&a.pid===b.pid&&a.bridge_instance_id===b.bridge_instance_id;
/** Injectable I/O is for offline tests; production paths and effects are fixed below. */
export function createStopOwnedMotion(io:IO){
  return async({runId,operationIds,timeoutMs=130000}:Input)=>{
    if(!token(runId))throw Error("INVALID_RUN_ID");
    const allowed=new Set(operationIds);
    if([...allowed].some(id=>!token(id)))throw Error("INVALID_OPERATION_ID");
    if(!Number.isFinite(timeoutMs)||timeoutMs<0)throw Error("INVALID_STOP_TIMEOUT");
    const deadline=io.now()+Math.min(180000,Math.max(1000,timeoutMs));
    let initial:any=null,request:any=null,ack:any=null,last:any=null;
    while(io.now()<deadline){
      const ros=await io.read(ROS),lease=await io.read(LEASE);
      last=ros;
      if(!safeRos(ros,io.now())){
        if(!initial)return {verified:false,status:"REFUSED",reason:"FRESH_ROS_REQUIRED"};
        await io.sleep(100);continue;
      }
      const live=ros.navigation?.motion_lease;
      if(live?.held===false&&!lease&&idle(ros)){
        return {verified:true,status:ack&&["STOPPED","PENDING"].includes(ack.result?.status)?"STOPPED_BY_OWNER":"IDLE_VERIFIED",
          operation_id:initial?.operation_id??null,owner_ack:ack,
          evidence:{source:"fresh ROS state + zero velocity + no active goals + released project lease",
            updated_at:ros.updated_at,velocity:ros.velocity,active_goals:ros.navigation.active_goals}};
      }
      const owner=live?.owner;
      if(lease&&token(lease.operation_id)&&!allowed.has(lease.operation_id))
        return {verified:false,status:"REFUSED",reason:"OWNER_NOT_IN_RUN",operation_id:lease.operation_id};
      if(!sameOwner(owner,lease)||live?.held!==true){
        await io.sleep(100);continue; // wait for the read-only monitor to catch up
      }
      if(!allowed.has(owner.operation_id)||!Number.isSafeInteger(owner.pid)||owner.pid<=0||!token(owner.bridge_instance_id))
        return {verified:false,status:"REFUSED",reason:"OWNER_NOT_IN_RUN"};
      if(initial&&!sameOwner(initial,owner))
        return {verified:false,status:"REFUSED",reason:"OWNER_CHANGED",operation_id:owner.operation_id,owner_ack:ack};
      initial??={operation_id:owner.operation_id,pid:owner.pid,bridge_instance_id:owner.bridge_instance_id};
      // Renew only an unacknowledged/not-ready request. An accepted cancellation
      // is irreversible for that operation and does not need repeated stop calls.
      if(!request||io.now()/1000>=request.expires_at&&(!ack||ack.result?.reason==="OWNER_NOT_READY")){
        request={schema_version:1,action:"stop",request_id:io.id(),run_id:runId,...initial,
          issued_at:io.now()/1000,expires_at:io.now()/1000+12};
        await io.writeRequest(request);
      }
      const reply=await io.readAck(request.request_id);
      if(reply?.source==="actual_motion_owner_stop"&&reply.request_id===request.request_id&&
        reply.run_id===runId&&sameOwner(reply,initial))ack=reply;
      await io.sleep(100);
    }
    return {verified:false,status:ack?"PENDING":"FAILED",reason:ack?"STOP_NOT_YET_VERIFIED":"OWNER_ACK_UNAVAILABLE",
      operation_id:initial?.operation_id??null,owner_ack:ack,
      evidence:last?{updated_at:last.updated_at,velocity:last.velocity,navigation_status:last.navigation?.status}:null};
  };
}
export const stopOwnedMotion=createStopOwnedMotion({
  now:()=>Date.now(),sleep:ms=>new Promise(r=>setTimeout(r,ms)),read,writeRequest,readAck,id:()=>randomUUID(),
});
