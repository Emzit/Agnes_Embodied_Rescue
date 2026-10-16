import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createClient,memoryJournal} from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
import {JsonlBridge} from '../../services/robot-mcp/src/transport/jsonl-bridge.ts';
export const root='/data-ssd/zhongchengkai/agnes',out=process.env.FINAL_ARTIFACTS_ROOT??`${root}/artifacts/final_rescue`,profile='local-dev';
export const node=`${root}/tools/node/bin/node`,cli=`${root}/third_party/agnes-harness/packages/cli/dist/local/agnes.mjs`,pixi=`${root}/tools/pixi/bin/pixi`,runArgs=['run','--locked','-m',`${root}/runtime/ros2-jazzy/pixi.toml`];
export const exec=promisify(execFile),sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export const save=async(path:string,value:any)=>{await mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
export async function connect(){const owner=JSON.parse(await readFile(`${root}/.agh-home-step7/data/daemon/owner.json`,'utf8'));const c:any=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});await c.initialize();return c;}
export async function agnesCli(args:string[],env=process.env){return exec(node,[cli,...args],{cwd:root,env,timeout:60000,maxBuffer:4*1024*1024});}
export async function register(pid:number|undefined,group=true){if(pid)await exec('/usr/bin/python3',[`${root}/scripts/phase9d/stack.py`,'register',String(pid),group?'group':'pid'],{env:process.env});}
export async function startStack(){
 await writeFile(`${root}/logs/final_rescue/stack.log`,'');
 const stream=createWriteStream(`${root}/logs/final_rescue/stack.log`);
 const stack=spawn('/bin/bash',[`${root}/scripts/final-rescue/start-stack.sh`],{env:process.env,detached:true,stdio:['ignore','pipe','pipe']});stack.stdout!.pipe(stream);stack.stderr!.pipe(stream);
 for(let i=0;i<100;i++){const log=await readFile(`${root}/logs/final_rescue/stack.log`,'utf8');if(log.includes('FINAL_RESCUE_STACK_STARTED'))return stack;if(stack.exitCode!==null)throw Error('STACK_EXITED');await sleep(100);}
 throw Error('STACK_START_TIMEOUT');
}
export async function probe(){const b=new JsonlBridge(pixi,[...runArgs,'python',`${root}/simulation/phase9d/observer.py`]);await register(b.child.pid);try{let lifecycle:any;for(let i=0;i<40;i++){lifecycle=await b.request('lifecycle',{},15000);if(Object.values(lifecycle).every(v=>v==='active'))break;await sleep(250);}if(!Object.values(lifecycle).every(v=>v==='active'))throw Error('NAV2_NOT_READY');return {lifecycle,graph:await b.request('graph')};}finally{await b.close();}}
export async function restartAgnes(){await agnesCli(['daemon','stop']).catch(()=>{});await agnesCli(['daemon','start']);for(let i=0;i<50;i++){try{const c=await connect();const conf=await c.config.get();await c.close();if(conf.configured && conf.provider?.id==='agnes-ai'&&conf.provider?.model==='agnes-3.0-flash'){const owner=JSON.parse(await readFile(`${root}/.agh-home-step7/data/daemon/owner.json`,'utf8'));await save(`${out}/agnes-owned.json`,owner);return;}}catch{}await sleep(200);}throw Error('AGNES_NOT_READY');}
export async function stopAll(){let own:any;try{own=JSON.parse(await readFile(`${out}/agnes-owned.json`,'utf8'));const cur=JSON.parse(await readFile(`${root}/.agh-home-step7/data/daemon/owner.json`,'utf8'));if(cur.pid===own.pid)await agnesCli(['daemon','stop']);}catch{}await exec('/bin/bash',[`${root}/scripts/final-rescue/stop-stack.sh`],{timeout:40000,env:process.env});}
export async function readyMcp(c:any){for(let i=0;i<100;i++){const s=await c.mcp.servers.status({profile,serverId:'robot-mcp'});if(s.connectionState==='ready')return s;await sleep(200);}throw Error('MCP_NOT_READY');}
export async function jsonl(path:string){try{return (await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));}catch{return [];}}

export async function probeSensors(){const b=new JsonlBridge('/bin/bash',[`${root}/services/robot-mcp/ros2_bridge/launch_bridge.sh`]);await register(b.child.pid);try{for(let i=0;i<40;i++){const o=await b.request('get_observation',{},15000);if(o.camera.available&&o.lidar.available&&o.perception_status==='AVAILABLE')return {camera:o.camera,lidar:o.lidar,perception:o.perception_status,pose:o.robot_pose};await sleep(200);}throw Error('SENSORS_NOT_READY');}finally{await b.close();}}
