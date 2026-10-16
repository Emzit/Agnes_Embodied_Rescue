import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
const R="/data-ssd/zhongchengkai/agnes",profile="local-dev";
const args=process.argv.slice(2),apply=args.includes("--apply");
const value=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const inside=(p:string)=>{const resolved=fs.realpathSync(p);if(!resolved.startsWith(R+"/"))throw Error("PATH_OUTSIDE_PROJECT");return resolved;};
if(path.resolve(process.cwd())!==R)throw Error("WORKSPACE_REQUIRED");
function approvalGuard(){
  if(!apply)return;
  const file=value("--approval");if(!file)throw Error("EXPLICIT_HUMAN_APPROVAL_REQUIRED");
  // The Python verifier checks the actual kernel flock owner, direct prepare
  // parent identity, fresh finite ROS/pose and the current config fingerprint.
  const code="import importlib.util,json,sys; s=importlib.util.spec_from_file_location('demo_prepare','scripts/demo-video/prepare-scene.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.verify_reconnect_transaction(sys.argv[1],int(sys.argv[2]),int(sys.argv[3]))))";
  const proof=JSON.parse(execFileSync("python3",["-B","-c",code,inside(file),String(process.pid),String(process.ppid)],
    {cwd:R,encoding:"utf8",timeout:10000}));
  if(proof.pass!==true)throw Error("ACTIVE_APPROVED_SCENE_PREPARATION_REQUIRED");
}
approvalGuard();
const owner=read(R+"/.agh-home-step7/data/daemon/owner.json");
const client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
await client.initialize();
const identity={profile,clientId:await client.clientId()},wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function guard(){
  const conf=read(R+"/artifacts/demo-ui-final/native-config.json");
  const ui:any=await client.call("_agnes/v1/session.projectUI",{sessionId:conf.session_id,surface:"web"});
  if(["running","waiting"].includes(ui.turns?.at(-1)?.status)||ui.pendingInputs?.length||
    ui.nodes?.some((n:any)=>n.kind==="approval"&&n.state!=="decided"))throw Error("NATIVE_SESSION_BUSY");
  return {session_id:conf.session_id,status:ui.turns?.at(-1)?.status??"IDLE"};
}
async function operation(receipt:any){
  for(let i=0;i<300;i++){
    const s=await client.resources.operation.get({profile,operationId:receipt.operationId});
    if(["completed","succeeded"].includes(s.state))return;
    if(["failed","cancelled","rolled-back"].includes(s.state))throw Error("RECONNECT_FAILED:"+JSON.stringify(s.lastSafeError??s.state));
    await wait(100);
  }throw Error("RECONNECT_TIMEOUT");
}
try{
  const native=await guard(),rows=[];
  for(const serverId of ["robot-mcp","envdoor"]){
    await guard();
    const def=await client.mcp.servers.get({profile,serverId});
    if(def.trust!=="trusted"||def.desired!=="enabled")throw Error("TRUSTED_ENABLED_MCP_REQUIRED:"+serverId);
    approvalGuard();
    if(apply)await operation(await client.mcp.servers.reconnect({...identity,serverId,expectedRevision:def.revision,
      commandId:"demo-same-scene-reconnect-"+serverId+"-"+Date.now()}));
    let state:any,items:any;
    for(let i=0;i<200;i++){
      state=await client.mcp.servers.status({profile,serverId});
      if(state.connectionState==="ready"){
        try{items=await client.mcp.servers.tools.list({profile,serverId});break;}
        catch(e:any){if(e.data?.code!=="MCP_CATALOG_UNAVAILABLE")throw e;}
      }
      if(!apply)throw Error("MCP_NOT_READY:"+serverId);
      await wait(100);
    }
    if(!items||state.connectionState!=="ready"||serverId==="robot-mcp"&&items.items.length!==8)throw Error("MCP_CATALOG_NOT_READY:"+serverId);
    rows.push({server_id:serverId,status:state.connectionState,tools:items.items.map((t:any)=>({name:t.name,description:t.description,inputSchema:t.inputSchema}))});
  }
  console.log(JSON.stringify({pass:true,mode:apply?"reconnect":"check",native,rows,model_calls:0,robot_commands:0}));
}finally{await client.close();}
