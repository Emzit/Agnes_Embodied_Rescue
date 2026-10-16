import assert from 'node:assert/strict';
import {Client} from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../../services/robot-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {root,out,save,startStack,probe,register,exec,sleep} from './common.mts';
const dir=process.env.FINAL_RUN_DIR!;let client:any,transport:any;const trace:any[]=[];
try{
 await startStack();await save(`${dir}/environment.json`,await probe());
 transport=new StdioClientTransport({command:process.execPath,args:[`${root}/services/robot-mcp/src/server.ts`],env:process.env as any,stderr:'pipe'});
 client=new Client({name:'final-physical-smoke',version:'1'},{capabilities:{}});await client.connect(transport);await register(transport.pid,false);
 const call=async(name:string,args:any={})=>{const r:any=await client.callTool({name,arguments:args},undefined,{timeout:260000});const d=r.structuredContent??JSON.parse(r.content[0].text);trace.push({name,args,result:d});console.log(name,JSON.stringify({status:d.status,reason:d.reason,code:d.code,labels:d.detections?.map((v:any)=>v.label)}));await save(`${dir}/smoke-trace.json`,trace);return d;};
 assert.equal((await client.listTools()).tools.length,8);await call('get_robot_state');await call('list_known_locations');
 let obs:any;for(let i=0;i<30;i++){obs=await call('get_observation');if(obs.camera.available)break;await sleep(200);}assert.ok(obs.camera.available&&obs.lidar.available);
 const weak=obs.semantic_objects.find((v:any)=>v.confidence<.8);assert.ok(weak);assert.equal((await call('inspect_object',{object_id:weak.id})).status,'SUCCEEDED');
 assert.equal((await call('navigate_to',{location:'Room_A'})).status,'SUCCEEDED');
 const a=await call('inspect_room',{location:'Room_A'});assert.equal(a.status,'SUCCEEDED');assert.ok(!a.detections.some((d:any)=>d.label==='person'));
 await sleep(2000);
 const blocked=await call('navigate_to',{location:'Corridor_A'});assert.equal(blocked.status,'FAILED');assert.equal(blocked.reason,'PATH_BLOCKED');
 const world=await call('get_world_state');assert.ok(world.blocked_routes.length);
 for(const location of ['Room_C','Side_Corridor','Room_B'])assert.equal((await call('navigate_to',{location})).status,'SUCCEEDED');
 const b=await call('inspect_room',{location:'Room_B'});assert.ok(b.detections.some((v:any)=>v.label==='person'));assert.ok((await call('stop_robot')).stopped);
 await save(`${dir}/acceptance.json`,{passed:true,nav2:true,sensors:true,world_model:true,perception:true,dynamic_collision:true,blocked:true,alternative_route:true,scripted_smoke_only:true,not_llm_mission:true});
}finally{await client?.close();await exec('/bin/bash',[`${root}/scripts/final-rescue/stop-stack.sh`],{env:process.env,timeout:40000});}
