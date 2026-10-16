import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
const ROOT='/data-ssd/zhongchengkai/agnes';
const BUILTINS=[
 {id:'classic',name:'经典地图',kind:'PHYSICAL_MAP',description:'原有经典救援拓扑；切换后以新 seed 随机布置物品。',physical_activation:'SELECT_TO_ACTIVATE'},
 {id:'office-fire',name:'室内办公室',kind:'PHYSICAL_MAP',description:'按用户草图搭建的四房间室内办公室；封闭天花板、三排电脑工位、默认关闭且可开启的房门。',physical_activation:'SELECT_TO_ACTIVATE'}
];
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
const within=p=>{const v=path.resolve(p);if(!v.startsWith(ROOT+'/'))fail(400,'路径不在 Agnes 工作区');return v;};
const normalName=v=>{
 if(typeof v!=='string')fail(400,'请为骨架命名（1–40 个字符）');
 const name=v.normalize('NFKC').trim();
 if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/.test(name))fail(400,'名称需为 1–40 个字符，不能含控制字符');
 return name;
};
const nameKey=v=>normalName(v).toLocaleLowerCase('zh-CN');
export function createMapCatalog({store=ROOT+'/artifacts/demo-ui-final/map-catalog.json',evidenceDir=ROOT+'/artifacts/import-skeleton-showcase'}={}){
 store=within(store);evidenceDir=within(evidenceDir);
 const readStore=()=>{
  if(!fs.existsSync(store))return {version:1,entries:[]};
  let data;try{data=JSON.parse(fs.readFileSync(store,'utf8'));}catch{fail(503,'地图目录损坏；保留原文件，请联系工程人员恢复');}
  if(data.version!==1||!Array.isArray(data.entries))fail(503,'地图目录格式不可用');
  return data;
 };
 const list=()=>({entries:[...BUILTINS,...readStore().entries.map(({id,name,created_at})=>({id,name,created_at,kind:'PHYSICAL_MAP',description:'用户上传骨架；预览不激活，确认切换才重建物理场景。',physical_activation:'SELECT_TO_ACTIVATE'}))],selection_scope:'CONFIRMED_TRANSACTIONAL_PHYSICAL_SCENE_SWITCH'});
 const evidence=uploadId=>{
  if(typeof uploadId!=='string'||!/^[a-f0-9]{32}$/.test(uploadId))fail(400,'上传记录 ID 无效');
  const p=path.join(evidenceDir,'preview-'+uploadId+'.json');
  let data;try{data=JSON.parse(fs.readFileSync(p,'utf8'));}catch{fail(404,'上传预览记录不存在');}
  if(data.upload_id!==uploadId||!data.validation?.pass||!data.preview?.geometry||data.physical_activation!=='NOT_ACTIVATED')fail(422,'只能保存已通过校验的静态骨架');
  const source=path.join(evidenceDir,'uploads',uploadId+'.json');
  let hash;try{hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');}catch{fail(404,'骨架源文件不存在');}
  if(hash!==data.source_sha256)fail(409,'骨架源文件与校验证据不一致');
  return data;
 };
 const detail=id=>{
  if(id==='classic'){
   const preview=JSON.parse(execFileSync('python3',[ROOT+'/scripts/demo-ui-final/classic-map-geometry.py'],{cwd:ROOT,timeout:5000,encoding:'utf8'}));
   return {...BUILTINS.find(x=>x.id===id),...preview};
  }
  if(id==='office-fire'){
   const file='office_fire/office_skeleton.json';
   const s=JSON.parse(fs.readFileSync(ROOT+'/maps/imported/'+file,'utf8'));
   return {...BUILTINS.find(x=>x.id===id),geometry:Object.fromEntries(['boundary','walls','rooms','corridors','doors','start_poses','static_obstacles'].map(k=>[k,s[k]||[]])),metadata:s.metadata};
  }
  const entry=readStore().entries.find(x=>x.id===id);if(!entry)fail(404,'地图骨架不存在');
  const data=evidence(entry.upload_id);
  return {...entry,kind:'STATIC_PREVIEW',physical_activation:'NOT_ACTIVATED',geometry:data.preview.geometry,validation:data.validation,source_sha256:data.source_sha256};
 };
 const register=(value={})=>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'请求必须是 JSON 对象');
  let {name,upload_id}=value;
  name=normalName(name);const data=readStore();
  if([...BUILTINS,...data.entries].some(x=>nameKey(x.name)===nameKey(name)))fail(409,'这个地图名称已存在，请使用其他名称');
  if(data.entries.length>=100)fail(409,'已达到 100 份自定义骨架上限');
  evidence(upload_id);
  const entry={id:'map-'+crypto.randomUUID(),name,upload_id,created_at:new Date().toISOString()};
  data.entries.push(entry);
  fs.mkdirSync(path.dirname(store),{recursive:true});
  const tmp=store+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,store);
  return detail(entry.id);
 };
 return {list,detail,register};
}
const catalog=createMapCatalog();
const send=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
export async function handleMapCatalog(req,res,url,{origin='http://127.0.0.1:4177',instance=catalog}={}){
 const base='/api/demo-ui/maps';
 if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return false;
 try{
  if(req.method==='GET'){
   if(url.pathname===base)send(res,200,instance.list());
   else if(url.pathname===base+'/runtime')send(res,200,sceneRuntime());
   else {const id=url.pathname.slice(base.length+1);if(!/^(classic|office-fire|map-[a-f0-9-]{36})$/.test(id))fail(404,'地图骨架不存在');send(res,200,instance.detail(id));}
  }else if(req.method==='POST'&&[base,base+'/activate'].includes(url.pathname)){
   if(req.headers.origin!==origin||!['same-origin',undefined].includes(req.headers['sec-fetch-site']))fail(403,'只允许同源保存骨架');
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)fail(413,'保存请求过大');chunks.push(chunk);}
   let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'请求不是合法 JSON');}
   if(url.pathname===base)send(res,201,instance.register(value));
   else send(res,202,activateScene(value,instance));
  }else fail(405,'不支持此操作');
 }catch(e){send(res,Number.isInteger(e.code)?e.code:503,{error:'map_catalog_error',message:e.code?e.message:'地图目录暂不可用，请重试'});}
 return true;
}

const SWITCH=ROOT+'/artifacts/demo-ui-final/scene-switch';
const jsonFile=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const stamp=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2)+'\n');fs.renameSync(p+'.tmp',p);};
export function sceneRuntime(){
 const state=jsonFile(SWITCH+'/current-job.json');
 // Do not auto-retry an interrupted physical mutation on refresh.
 if(state?.status==='RUNNING'&&Date.now()/1000-(state.updated_at||state.started_at)>300){
  state.status='INTERRUPTED';state.phase='切换进程状态不明；需要工程恢复，禁止自动重试';
 }
 let active=jsonFile(ROOT+'/artifacts/demo-ui-final/active-map.json');
 if(!active){
  const current=jsonFile(ROOT+'/artifacts/interactive-live/current-scenario.json');
  active={map_id:current?.layout_id==='layout_c'?'classic':null,map_name:current?.layout_id==='layout_c'?'经典地图':'未登记的当前物理场景',seed:current?.seed,layout_id:current?.layout_id,status:'EXISTING_SCENE',activation:'READ_EXISTING_SCENARIO_POINTER'};
 }
 const builtin=BUILTINS.find(entry=>entry.id===active?.map_id);
 if(builtin)active={...active,map_name:builtin.name};
 return {active,job:state};
}
export function activateScene(value,instance=catalog){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'请求必须是 JSON 对象');
 const {id,request_id:job}=value;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(job||''))fail(400,'缺少有效幂等请求 ID');
 instance.detail(id);
 const dir=SWITCH+'/jobs/'+job,prior=jsonFile(dir+'/status.json');
 if(prior){if(prior.requested_map!==id)fail(409,'请求 ID 已用于其他地图');return {job:prior,idempotent:true};}
 const runtime=sceneRuntime();
 if(['RUNNING','INTERRUPTED'].includes(runtime.job?.status))fail(409,'已有场景切换尚未结束；请等待或联系工程恢复');
 const r=jsonFile(ROOT+'/artifacts/demo-ui-final/ros-state.json'),n=jsonFile(ROOT+'/artifacts/demo-ui-final/native-session-state.json');
 if(!r||Date.now()/1000-r.updated_at>3||r.navigation?.status!=='IDLE'||r.navigation?.active_goals?.length||r.navigation?.motion_lease?.held)fail(409,'机器人状态不明、导航未空闲或运动锁被占用；未切换');
 if(!n?.observer_connected||Date.now()-Date.parse(n.observer_updated_at)>4000||!['IDLE','SUCCEEDED','PARTIAL','FAILED','CANCELED','COMPLETED'].includes(n.status)||n.pending_approvals?.length||n.pending_inputs?.length)fail(409,'原生会话正在执行任务或监控失联；未切换');
 const state={job_id:job,requested_map:id,status:'RUNNING',phase:'等待安全检查',started_at:Date.now()/1000,updated_at:Date.now()/1000};
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/status.json',JSON.stringify(state),{flag:'wx',mode:0o600});stamp(SWITCH+'/current-job.json',state);
 const log=fs.openSync(dir+'/worker.log','a',0o600);
 try{
  const child=spawn('python3',[ROOT+'/scripts/demo-ui-final/scene-switch.py',id,job],{cwd:ROOT,env:{...process.env,ROS_DOMAIN_ID:'106',GZ_PARTITION:'agnes_final_rescue'},detached:true,stdio:['ignore',log,log]});
  child.on('error',e=>{const failed={...state,status:'FAILED',phase:'无法启动切换进程',error:e.message,finished_at:Date.now()/1000};stamp(dir+'/status.json',failed);stamp(SWITCH+'/current-job.json',failed);});
  stamp(dir+'/worker-pid.json',{pid:child.pid,command:'scripts/demo-ui-final/scene-switch.py',job});child.unref();
 }finally{fs.closeSync(log);}
 return {job:state,idempotent:false};
}
