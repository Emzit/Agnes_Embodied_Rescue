/** Reload changed sensor source through the supported native MCP lifecycle. No robot/model calls. */
import fs from "node:fs";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
import {assertPreflight,assertFreeMotionLease} from "./verify-native-workflow.mts";
const ROOT="/data-ssd/zhongchengkai/agnes",UI=ROOT+"/artifacts/demo-ui-final",profile="local-dev";
if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
const flags=new Set(process.argv.slice(2));
if(flags.size!==1||!["--check","--apply"].some(v=>flags.has(v)))throw Error("Use --check or --apply");
const apply=flags.has("--apply"),read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const target=read(UI+"/native-session-target.json");
function guard(){
 const native=read(UI+"/native-session-state.json"),ros=read(UI+"/ros-state.json");
 assertPreflight(native,ros);assertFreeMotionLease();
 if(native.session_id!==target.session_id)throw Error("NATIVE_TARGET_NOT_OBSERVED");
 return {native_session_id:native.session_id,native_status:native.status,observer_updated_at:native.observer_updated_at,ros_updated_at:ros.updated_at,pose:ros.pose,velocity:ros.velocity,motion_lease:ros.navigation.motion_lease};
}
const before=guard(),owner=read(ROOT+"/.agh-home-step7/data/daemon/owner.json");
const client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
await client.initialize();
try{
 const config=await client.config.get();
 if(config.provider?.id!=="agnes-ai"||config.provider?.model!=="agnes-3.0-flash")throw Error("AGNES_PROVIDER_REQUIRED");
 const ui:any=await client.call("_agnes/v1/session.projectUI",{sessionId:target.session_id,surface:"web"});
 if(["running","waiting"].includes(ui.turns?.at(-1)?.status)||ui.pendingInputs?.length||
    ui.nodes?.some((n:any)=>n.kind==="approval"&&n.state!=="decided"))throw Error("NATIVE_SESSION_BUSY");
 const results:any[]=[];
 for(const serverId of ["robot-mcp","envdoor"]){
  guard();
  const def=await client.mcp.servers.get({profile,serverId});
  if(def.trust!=="trusted"||def.desired!=="enabled")throw Error("TRUSTED_ENABLED_MCP_REQUIRED:"+serverId);
  let receipt:any=null;
  if(apply){
   guard();
   receipt=await client.mcp.servers.reconnect({profile,serverId,clientId:await client.clientId(),expectedRevision:def.revision,
    commandId:"sensor-schema-correction-reload-"+serverId+"-"+Date.now()});
   for(let i=0;;i++){
    const operation=await client.resources.operation.get({profile,operationId:receipt.operationId});
    if(["completed","succeeded"].includes(operation.state))break;
    if(["failed","cancelled","rolled-back"].includes(operation.state))throw Error("MCP_RELOAD_FAILED:"+serverId);
    if(i>=300)throw Error("MCP_RELOAD_TIMEOUT:"+serverId);
    await new Promise(r=>setTimeout(r,100));
   }
  }
  let state:any,tools:any;
  for(let i=0;;i++){
   state=await client.mcp.servers.status({profile,serverId});
   if(state.connectionState==="ready"){
    try{tools=await client.mcp.servers.tools.list({profile,serverId});break;}
    catch(e:any){if(e.data?.code!=="MCP_CATALOG_UNAVAILABLE")throw e;}
   }
   if(!apply||i>=200)throw Error("MCP_NOT_READY:"+serverId);
   await new Promise(r=>setTimeout(r,100));
  }
  if(serverId==="robot-mcp"&&tools.items.length!==8)throw Error("ROBOT_CATALOG_INCOMPLETE");
  results.push({server_id:serverId,connection_state:state.connectionState,tool_count:tools.items.length,receipt});
 }
 const result={at:new Date().toISOString(),status:"PASS",mode:apply?"apply":"check",before,after:guard(),servers:results,
   provider:"agnes-ai",model:"agnes-3.0-flash",model_calls:0,robot_commands:0,physical_reset:false};
 if(apply){const out=ROOT+"/artifacts/perception-failures";fs.mkdirSync(out,{recursive:true});fs.appendFileSync(out+"/mcp-reloads.jsonl",JSON.stringify(result)+"\n");}
 console.log(JSON.stringify(result));
}finally{await client.close();}
