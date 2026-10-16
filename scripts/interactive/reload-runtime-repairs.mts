/** Reload repaired project-owned MCP services while idle, without resetting the scene. */
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
const R="/data-ssd/zhongchengkai/agnes",profile="local-dev",out=R+"/artifacts/runtime-diagnostics-20261014/navigation-camera";
if(process.cwd()!==R)throw Error("WORKSPACE_REQUIRED");
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
function idle(){
 const n=read(R+"/artifacts/demo-ui-final/native-session-state.json"),s=read(R+"/artifacts/demo-ui-final/ros-state.json");
 if(n.status==="RUNNING"||n.pending_approvals?.length||n.pending_inputs?.length)throw Error("NATIVE_SESSION_BUSY");
 if(Date.now()/1000-s.updated_at>3||s.navigation?.active_goals?.length||s.navigation?.motion_lease?.held||
    Object.values(s.velocity??{}).some(v=>typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>.001))throw Error("ROBOT_NOT_IDLE");
 execFileSync("python3",["-B","-c","import fcntl,sys; f=open(sys.argv[1],'rb'); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); fcntl.flock(f,fcntl.LOCK_UN)",R+"/runtime/motion-control.lock"],{cwd:R,stdio:"pipe",timeout:3000});
 return {session_id:n.session_id,native_status:n.status,pose:s.pose,velocity:s.velocity,at:s.updated_at};
}
const before=idle(),owner=read(R+"/.agh-home-step7/data/daemon/owner.json");
const c=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
await c.initialize();
try{
 const ui:any=await c.call("_agnes/v1/session.projectUI",{sessionId:before.session_id,surface:"web"});
 if(["running","waiting"].includes(ui.turns?.at(-1)?.status)||ui.pendingInputs?.length||ui.nodes?.some((n:any)=>n.kind==="approval"&&n.state!=="decided"))throw Error("NATIVE_SESSION_BUSY");
 const rows=[];
 for(const serverId of ["robot-mcp","envdoor"]){
  idle();const def=await c.mcp.servers.get({profile,serverId});
  if(def.trust!=="trusted"||def.desired!=="enabled")throw Error("TRUSTED_ENABLED_SERVER_REQUIRED");
  const receipt=await c.mcp.servers.reconnect({profile,serverId,clientId:await c.clientId(),expectedRevision:def.revision,commandId:"repair-camera-navigation-"+serverId+"-"+Date.now()});
  for(let i=0;;i++){const op=await c.resources.operation.get({profile,operationId:receipt.operationId});
   if(["completed","succeeded"].includes(op.state))break;
   if(["failed","cancelled","rolled-back"].includes(op.state)||i>=300)throw Error("RECONNECT_FAILED");
   await new Promise(r=>setTimeout(r,100));}
  const state=await c.mcp.servers.status({profile,serverId});
  const tools=await c.mcp.servers.tools.list({profile,serverId});
  if(state.connectionState!=="ready"||serverId==="robot-mcp"&&tools.items.length!==8)throw Error("CATALOG_NOT_READY");
  rows.push({serverId,state:state.connectionState,tool_count:tools.items.length,receipt});
 }
 const report={status:"PASS",at:new Date().toISOString(),before,after:idle(),rows,reset:false,motion_goals:0,model_calls:0,implicit_shutdown_zero_velocity_allowed:true};
 fs.writeFileSync(out+"/owned-mcp-reload.json",JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify(report));
}finally{await c.close();}
