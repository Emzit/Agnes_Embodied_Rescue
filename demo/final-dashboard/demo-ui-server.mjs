import fs from 'node:fs';
import path from 'node:path';
const ROOT='/data-ssd/zhongchengkai/agnes', OUT=ROOT+'/artifacts/demo-ui-final', STATIC=ROOT+'/demo/final-dashboard';
const read=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
const json=(res,data,code=200)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
function file(res,p,type){try{const bytes=fs.readFileSync(p);res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);}catch{json(res,{error:'unavailable'},503);}}
export function cameraFresh(meta,now=Date.now()){const age=now-Date.parse(meta?.captured_at||'');return meta?.real_sensor===true&&Number.isFinite(age)&&age>=0&&age<2500;}
export function demoUiState(){
 const now=Date.now(), config=read(OUT+'/native-config.json'),session=read(OUT+'/native-session-state.json'),ros=read(OUT+'/ros-state.json');
 const camera=read(ROOT+'/artifacts/interactive-live/camera/latest-meta.json');
 const cameraAge=camera?now-Date.parse(camera.captured_at):null,rosAge=ros?now-ros.updated_at*1000:null,observerAge=session?now-Date.parse(session.observer_updated_at):null;
 const discovery=read(ROOT+'/.agh-home-step7/data/daemon/discovery.json');
 const provider=read(ROOT+'/artifacts/interactive-live/provider-runtime-status.json');
 const scenario=read(ROOT+'/artifacts/interactive-live/current-scenario.json');
 const registryPath=scenario?.layout?.registry?path.resolve(ROOT,scenario.layout.registry):ROOT+'/simulation/final_rescue/world_registry.json';
 const registry=registryPath.startsWith(ROOT+'/')?read(registryPath):null;
 const prior=read(ROOT+'/artifacts/interactive-live/current.json');
 return {mode:'LIVE',server_time:new Date().toISOString(),native:config?{...config,ws_url:discovery?.web?.url||config.ws_url,daemon_ready:discovery?.ready===true,observer_age_ms:observerAge,observer_fresh:session?.observer_connected===true&&!session?.observer_error&&observerAge!==null&&observerAge>=0&&observerAge<4000,provider_admission:provider?{pass:provider.pass,generated_at:provider.generated_at}:null}:null,session,ros:ros?{...ros,age_ms:rosAge,fresh:rosAge<2500,pose_fresh:rosAge<2500&&ros.pose_age_ms!==null&&ros.pose_age_ms<2500}:null,camera:{...camera,age_ms:cameraAge,live:cameraFresh(camera,now),image_url:'/api/demo-ui/camera.jpg'},registry:registry?{locations:registry.locations,doors:registry.doors}:null,scenario:scenario?{seed:scenario.seed,layout_id:scenario.layout_id}:null,previous_mission:prior?{mission_id:prior.mission_id,status:prior.status,task:prior.task,historical:true}:null};
}
const CAMERA_DIR=ROOT+'/artifacts/interactive-live/camera';
export function nextCameraFrame(req,res,after,{
 now=Date.now,readMeta=()=>read(CAMERA_DIR+'/latest-meta.json'),
 readFrame=name=>fs.readFileSync(CAMERA_DIR+'/'+name),pollMs=16,waitMs=1600,preferDisplay=false
}={}){
 let timer=null,closed=false;
 const deadline=now()+waitMs;
 const finish=()=>{closed=true;if(timer)clearTimeout(timer);res.off('close',finish);req.off('aborted',finish);};
 res.on('close',finish);req.on('aborted',finish);
 function send(){
  if(closed)return;
  const meta=readMeta();
  if(!cameraFresh(meta,now())){
   finish();json(res,{error:'NO_LIVE_CAMERA'},503);return;
  }
  if(after&&meta.frame_id===after){
   if(now()<deadline){timer=setTimeout(send,pollMs);return;}
   finish();res.writeHead(204,{'cache-control':'no-store'});res.end();return;
  }
  // JPEG is a display derivative of the exact same immutable sensor frame.
  // Keep camera.png and image_file lossless for evidence and model consumers.
  const jpeg=preferDisplay&&meta.display_file!=null;
  const name=jpeg?meta.display_file:meta.image_file;
  const valid=jpeg
   ? typeof name==='string'&&/^live-[a-zA-Z0-9-]+\.jpg$/.test(name)&&name===meta.frame_id+'.jpg'&&meta.display_mime_type==='image/jpeg'
   : !name||typeof name==='string'&&/^live-[a-zA-Z0-9-]+\.png$/.test(name);
  if(!valid){finish();json(res,{error:'INVALID_FRAME'},503);return;}
  try{
   const bytes=readFrame(name||'latest.png');
   finish();
   res.writeHead(200,{'content-type':jpeg?'image/jpeg':'image/png','cache-control':'no-store',
    'x-content-type-options':'nosniff','X-Frame-Id':meta.frame_id,
    'X-Captured-At':meta.captured_at,'X-Server-Time':String(now()),'X-Sensor-Timestamp':JSON.stringify(meta.timestamp)});
   res.end(bytes);
  }catch{finish();json(res,{error:'NO_LIVE_CAMERA'},503);}
 }
 send();
}
export function handleDemoUi(req,res,url){
 if(!['GET','HEAD'].includes(req.method))return false;
 if(url.pathname==='/'&&/:4188$/.test(req.headers.host||'')&&new URL(req.url,'http://127.0.0.1').pathname==='/'){res.writeHead(302,{location:'http://127.0.0.1:4177/demo','cache-control':'no-store'});res.end();return true;}
 if(url.pathname==='/'){file(res,STATIC+'/demo-ui.html','text/html; charset=utf-8');return true;}
 if(url.pathname==='/demo-ui.css'){file(res,STATIC+'/demo-ui.css','text/css; charset=utf-8');return true;}
 if(url.pathname==='/demo-ui.js'){file(res,STATIC+'/demo-ui.js','text/javascript; charset=utf-8');return true;}
 const reportName=url.pathname.slice('/api/demo-ui/report/'.length);
 if(url.pathname.startsWith('/api/demo-ui/report/')&&['WHAT_CHANGED.md','NATIVE_AGNES_INTEGRATION.md','UI_VALIDATION.md','DEMO_RUNBOOK.md','FINAL_HANDOFF.md'].includes(reportName)){file(res,OUT+'/'+reportName,'text/plain; charset=utf-8');return true;}
 if(url.pathname==='/api/demo-ui/skeletons/lotus_skeleton.json'){res.setHeader('Content-Disposition','attachment; filename="lotus_skeleton.json"');file(res,ROOT+'/maps/imported/lotus_demo/lotus_skeleton.json','application/json; charset=utf-8');return true;}
 if(url.pathname==='/api/demo-ui/state'){json(res,demoUiState());return true;}
 if(url.pathname==='/api/demo-ui/session'){json(res,read(OUT+'/native-session-state.json',{error:'observer_unavailable'}));return true;}
 if(url.pathname==='/api/demo-ui/map.png'){file(res,OUT+'/ros-map.png','image/png');return true;}
 if(url.pathname==='/api/demo-ui/camera.png'||url.pathname==='/api/demo-ui/camera.jpg'){
       nextCameraFrame(req,res,url.searchParams.get('after'),{preferDisplay:url.pathname.endsWith('.jpg')});return true;
 }
 return false;
}
