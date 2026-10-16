import fs from "node:fs";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {Ros2RobotGateway} from "../../services/robot-mcp/src/transport/ros2-gateway.ts";
import {postOpenWorld} from "./demo-policy.mts";
const ROOT="/data-ssd/zhongchengkai/agnes";
const args=process.argv.slice(2),arg=(n:string)=>{const i=args.indexOf(n);return i<0?null:args[i+1];};
const outArg=arg("--out")||"artifacts/workflow-speed-20261013";
if(!/^artifacts\/workflow-speed-20261013(?:\/[A-Za-z0-9_-]+)?$/.test(outArg))throw Error("BENCHMARK_OUTPUT_REQUIRED");
const OUT=ROOT+"/"+outArg,skipScan=args.includes("--skip-scan"),doorId=arg("--door")||"Right_Near_Door";
if(!["Right_Near_Door","Right_Middle_Door","Right_Front_Door"].includes(doorId))throw Error("DOOR_SCOPE_REQUIRED");
fs.mkdirSync(OUT,{recursive:true});
if(process.cwd()!==ROOT)throw Error("WORKSPACE_REQUIRED");
const save=(n:string,v:any)=>fs.writeFileSync(OUT+"/"+n,JSON.stringify(v,null,2)+"\n");
const read=(n:string)=>JSON.parse(fs.readFileSync(ROOT+"/"+n,"utf8"));
const ros=read("artifacts/demo-ui-final/ros-state.json"),native=read("artifacts/demo-ui-final/native-session-state.json");
if(Date.now()/1000-ros.updated_at>5||ros.navigation.status!=="IDLE"||ros.navigation.motion_lease?.held||
   Object.values(ros.velocity).some((v:any)=>!Number.isFinite(v)||Math.abs(v)>.01)||native.status==="RUNNING"||
   native.pending_approvals?.length||native.pending_inputs?.length)throw Error("SIMULATION_NOT_IDLE");
process.env.FINAL_RUN_DIR=OUT+"/trace";process.env.ROBOT_TRACE_DIR=process.env.FINAL_RUN_DIR;
fs.mkdirSync(process.env.FINAL_RUN_DIR,{recursive:true});
const require=createRequire(ROOT+"/services/robot-mcp/src/server.ts");
const {Client}=await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const {StdioClientTransport}=await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const gateway=new Ros2RobotGateway(),envClient=new Client({name:"workflow-speed-verification",version:"1.0.0"},{capabilities:{}});
const transport=new StdioClientTransport({command:ROOT+"/tools/node/bin/node",
 args:["--import",ROOT+"/third_party/agnes-harness/node_modules/tsx/dist/loader.mjs",ROOT+"/services/environment-interaction-mcp/server.ts"],
 env:Object.fromEntries(Object.entries(process.env).filter(([,v])=>typeof v==="string")) as Record<string,string>,stderr:"pipe"});
transport.stderr?.on("data",(b:any)=>fs.appendFileSync(OUT+"/environment-stderr.log",b));
let ownsMotion=false;
const events:any[]=[],timings:any={};
const emit=(phase:string,extra:any={})=>{const v={at:new Date().toISOString(),phase,...extra};events.push(v);save("progress.json",v);console.log(JSON.stringify(v));};
const wait=(n:number)=>new Promise(r=>setTimeout(r,n));
function normalize(r:any){if(r.structuredContent)return r.structuredContent;const t=r.content?.find((x:any)=>x.type==="text");return t?JSON.parse(t.text):r;}
async function call(name:string,args:any={}){const start=Date.now();const raw=await envClient.callTool({name,arguments:args},undefined,{timeout:55000});
 const result=normalize(raw);timings[name]=(Date.now()-start)/1000;save(name+"-result.json",result);emit(name,{seconds:timings[name],status:result.status});return result;}
try{
 await envClient.connect(transport);
 await call("get_map");
 const startPose=await gateway.getState();
 if(!skipScan&&Math.hypot(startPose.pose.x,startPose.pose.y+6.7)>.35)throw Error("START_NOT_VERIFIED");
 let scan:any;
 if(!skipScan){
 const scanAt=Date.now(),accepted=await gateway.inspectRoom("Start");save("scan-accepted.json",accepted);
 if(!accepted.accepted||accepted.status!=="PENDING")throw Error("SCAN_NOT_ACCEPTED");
 ownsMotion=true;emit("continuous-scan-started",{inspection_id:accepted.inspection_id});
 let last="",deadline=Date.now()+180000;
 while(Date.now()<deadline){await wait(250);const state=await gateway.getState(),i=state.inspection;
   if(i?.inspection_id!==accepted.inspection_id)throw Error("SCAN_OWNER_CHANGED");
   const key=[i.phase,i.captured_views,i.analyzed_views].join(":");
   if(key!==last){emit("scan-progress",{scan_phase:i.phase,captured:i.captured_views,analyzed:i.analyzed_views});last=key;}
   if(i.terminal_known){scan=i.result;break;}
 }
 save("scan-result.json",scan);timings.scan_seconds=(Date.now()-scanAt)/1000;ownsMotion=false;
 if(scan?.status!=="SUCCEEDED"||scan.scan_views!==8||!scan.rotation_complete||Math.abs(scan.rotation_evidence.measured_radians-Math.PI*2)>.12)throw Error("SCAN_FAILED:"+scan?.reason);
 emit("continuous-scan-complete",{seconds:timings.scan_seconds,timing:scan.timing});
 }
 const navAt=Date.now(),nav=await gateway.navigateTo(doorId+"_interaction");save("navigate-result.json",nav);
 timings.navigate_rpc_seconds=(Date.now()-navAt)/1000;
 let navDone=nav.status==="SUCCEEDED";
 ownsMotion=nav.status==="PENDING";let deadline=Date.now()+180000;
 while(!navDone&&nav.status==="PENDING"&&Date.now()<deadline){await wait(250);const s=await gateway.getState();
   if(s.navigation_operation_id!==nav.operation_id)throw Error("NAVIGATION_OWNER_CHANGED");
   if(s.navigation_terminal_known){if(s.navigation_terminal_status!=="SUCCEEDED")throw Error("NAVIGATION_FAILED");navDone=true;}
 }
 ownsMotion=false;timings.navigation_seconds=(Date.now()-navAt)/1000;
 if(!navDone)throw Error("NAVIGATION_INCOMPLETE");
 emit("door-approach-complete",{seconds:timings.navigation_seconds,result_in_first_call:nav.status==="SUCCEEDED"});
 let inspected=await call("inspect_door",{door_id:doorId});
 if(inspected.status!=="SUCCEEDED"&&inspected.code==="DOOR_NOT_VISUALLY_OBSERVED")inspected=await call("inspect_door",{door_id:doorId});
 if(inspected.status!=="SUCCEEDED")throw Error("INSPECT_DOOR_FAILED:"+inspected.code);
 const opened=await call("open_door",{door_id:doorId});
 if(opened.status!=="SUCCEEDED"||opened.code!=="DOOR_OPEN_VERIFIED"||!postOpenWorld(opened))throw Error("OPEN_DOOR_NOT_VERIFIED:"+opened.code);
 const final=await gateway.getState();save("final-state.json",final);
 if(final.motion_owner||final.inspection_active||final.navigation_active||Math.abs(final.linear_velocity)>.01||Math.abs(final.angular_velocity)>.01)throw Error("ROBOT_NOT_STOPPED");
 const report={pass:true,at:new Date().toISOString(),kind:"ACTUAL_SIMULATION_TOOL_TIMING_NO_VIDEO",provider:"agnes-ai",model:"agnes-3.0-flash",
 timings,scan_timing:scan?.timing,door_id:doorId,open_stages:opened.timings_ms,duplicate_post_open_world_calls:0,
 robot_stopped:true,door_open:true,events,models_used:"Agnes vision through existing Harness",core_test_only:true};
 save("report.json",report);emit("PASS",{timings});
}catch(e:any){save("failure.json",{at:new Date().toISOString(),error:e.message,timings,events});emit("FAILED",{error:e.message});process.exitCode=1;
}finally{
 if(ownsMotion)await gateway.stop().catch(()=>{});
 await envClient.close().catch(()=>{});await transport.close().catch(()=>{});await gateway.close();
}
