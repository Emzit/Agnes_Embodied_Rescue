import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes';
const DEFAULT_DIR=ROOT+'/artifacts/demo-video-20261013/recordings';
const DEFAULT_FOCUS_DIR=ROOT+'/artifacts/demo-video-20261013';
const PREFIX='/api/demo-ui/recordings';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME=/^video\/webm(?:;codecs=(?:vp8|vp9|av1)(?:,opus)?)?$/;
export const RECORDING_LIMITS=Object.freeze({chunkBytes:16*1024*1024,totalBytes:1024*1024*1024,maxSeconds:1200,maxChunks:1500});
class RecordingError extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
const fail=(code,status)=>{throw new RecordingError(code,status);};
function json(res,value,status=200){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req,limit){
 const declared=Number(req.headers['content-length']);
 if(Number.isFinite(declared)&&declared>limit){req.resume();fail('BODY_TOO_LARGE',413);}
 const pieces=[];let size=0;
 const timer=setTimeout(()=>req.destroy(new RecordingError('UPLOAD_TIMEOUT',408)),30000);timer.unref?.();
 try{for await(const piece of req){size+=piece.length;if(size>limit){req.resume();fail('BODY_TOO_LARGE',413);}pieces.push(piece);}return Buffer.concat(pieces,size);}
 finally{clearTimeout(timer);}
}
async function jsonBody(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail('JSON_REQUIRED',415);
 try{const value=JSON.parse((await body(req,8192)).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_JSON');return value;}
 catch(e){if(e instanceof RecordingError)throw e;fail('INVALID_JSON');}
}
function publicMeta(meta){const {upload_token_hash,...value}=meta;return {...value,video_url:meta.status==='COMPLETE'?PREFIX+'/'+meta.id+'/video':null};}
function guardOrigin(req,origin,write){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))fail('INVALID_SERVICE_ORIGIN',500);
 if(req.headers.host!==new URL(origin).host)fail('HOST_MISMATCH',403);
 if(req.headers.origin&&req.headers.origin!==origin)fail('SAME_ORIGIN_REQUIRED',403);
 if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail('SAME_ORIGIN_REQUIRED',403);
 if(write&&req.headers.origin!==origin)fail('SAME_ORIGIN_REQUIRED',403);
}
export async function probeRecording(file,{maxSeconds=RECORDING_LIMITS.maxSeconds}={}){
 const executable=ROOT+'/runtime/ros2-jazzy/.pixi/envs/default/bin/ffprobe';
 return await new Promise((resolve,reject)=>{
  // Stream packet timestamps: browser WebM often omits container duration.
  // This is one bounded scan rather than buffering every packet as JSON.
  const child=spawn(executable,['-v','error','-select_streams','v:0','-show_entries','packet=pts_time,duration_time:format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate','-of','compact=p=1:nk=0',file],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
  let pending='',packetCount=0,first=Infinity,last=-Infinity,format=null,video=null,failure=null,killTimer=null;
  const stop=(code,status=422)=>{if(!failure)failure=new RecordingError(code,status);child.kill('SIGTERM');if(!killTimer){killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref?.();}};
  const timer=setTimeout(()=>stop('VALIDATION_TIMEOUT'),60000);timer.unref?.();
  function line(text){
   if(failure||!text)return;
   const parts=text.split('|'),kind=parts.shift(),values=Object.fromEntries(parts.map(part=>{const at=part.indexOf('=');return [part.slice(0,at),part.slice(at+1)];}));
   if(kind==='packet'){
    packetCount++;const pts=Number(values.pts_time),duration=Number(values.duration_time);
    if(Number.isFinite(pts)){first=Math.min(first,pts);last=Math.max(last,pts+(Number.isFinite(duration)&&duration>0?duration:0));if(last-first>maxSeconds)stop('VIDEO_DURATION_LIMIT',413);}
   }else if(kind==='stream')video=values;
   else if(kind==='format'){format=values;const duration=Number(values.duration);if(Number.isFinite(duration)&&duration>maxSeconds)stop('VIDEO_DURATION_LIMIT',413);}
  }
  child.stdout.on('data',chunk=>{
   if(failure)return;
   pending+=chunk.toString('utf8');let index;
   while((index=pending.indexOf('\n'))!==-1){line(pending.slice(0,index));pending=pending.slice(index+1);if(failure)break;}
   if(pending.length>8192)stop('INVALID_VIDEO_PROBE');
  });
  child.stderr.resume();
  child.on('error',()=>{clearTimeout(timer);clearTimeout(killTimer);reject(new RecordingError('FFPROBE_UNAVAILABLE',503));});
  child.on('close',code=>{
   clearTimeout(timer);clearTimeout(killTimer);if(pending&&!failure)line(pending);
   if(failure)return reject(failure);
   if(code!==0)return reject(new RecordingError('INVALID_WEBM',422));
   if(!/webm|matroska/.test(format?.format_name||'')||!video||!['vp8','vp9','av1'].includes(video.codec_name)||!(Number(video.width)>0&&Number(video.height)>0&&packetCount>0))return reject(new RecordingError('NO_DECODABLE_VIDEO',422));
   if(!Number.isFinite(first)||!Number.isFinite(last))return reject(new RecordingError('VIDEO_DURATION_UNAVAILABLE',422));
   const packetDuration=Math.max(0,last-first),containerDuration=Number(format.duration),duration=Math.max(packetDuration,Number.isFinite(containerDuration)?containerDuration:0);
   if(duration>maxSeconds)return reject(new RecordingError('VIDEO_DURATION_LIMIT',413));
   resolve({format,streams:[{...video,width:Number(video.width),height:Number(video.height),nb_read_packets:String(packetCount)}],duration_seconds:duration,duration_source:'actual_video_packet_pts_and_container',packet_time_range:{first_pts:first,last_end:last},validation:'ffprobe_container_video_packets_and_duration'});
  });
 });
}
export function createRecordingHandler({directory=DEFAULT_DIR,probe=probeRecording,clock=Date.now,limits=RECORDING_LIMITS,focusDirectory=DEFAULT_FOCUS_DIR}={}){
 const dir=path.resolve(directory);
 if(!dir.startsWith(DEFAULT_DIR+'/')&&dir!==DEFAULT_DIR)throw Error('Recording storage must stay in the authorized recording directory');
 const locks=new Set();
 const recordDir=id=>{if(!ID.test(id))fail('INVALID_RECORDING_ID');return path.join(dir,id);};
 async function save(meta){const target=recordDir(meta.id)+'/metadata.json',temporary=target+'.tmp-'+randomUUID();await fsp.writeFile(temporary,JSON.stringify(meta,null,2),{flag:'wx',mode:0o600});await fsp.rename(temporary,target);}
 async function load(id){try{const m=JSON.parse(await fsp.readFile(recordDir(id)+'/metadata.json','utf8'));if(m.id!==id)fail('INVALID_METADATA',500);return m;}catch(e){if(e instanceof RecordingError)throw e;fail('RECORDING_NOT_FOUND',404);}}
 function token(req,meta){const value=String(req.headers['x-recording-token']||'');const a=Buffer.from(createHash('sha256').update(value).digest('hex')),b=Buffer.from(meta.upload_token_hash||'');if(a.length!==b.length||!timingSafeEqual(a,b))fail('INVALID_RECORDING_TOKEN',403);}
 async function expire(meta){const overTime=meta.status==='RECORDING'&&clock()-Date.parse(meta.started_at)>limits.maxSeconds*1000+60000;const interruptedValidation=meta.status==='VALIDATING'&&clock()-Date.parse(meta.finished_at)>120000;if(overTime||interruptedValidation){meta.status='INTERRUPTED';meta.reason=interruptedValidation?'VALIDATION_INTERRUPTED':'TIME_LIMIT_REACHED';await save(meta);}return meta;}

 const focusRoot=path.resolve(focusDirectory),focusIntents=new Map(),focusLocks=new Set(),lifecycleTails=new Map(),finishingRecordings=new Set();
 async function acquireLifecycle(id){
  let release;const done=new Promise(resolve=>{release=resolve;}),previous=lifecycleTails.get(id)||Promise.resolve();
  const tail=previous.then(()=>done);lifecycleTails.set(id,tail);await previous;
  return ()=>{release();if(lifecycleTails.get(id)===tail)lifecycleTails.delete(id);};
 }
 if(focusRoot!==DEFAULT_FOCUS_DIR&&!focusRoot.startsWith(DEFAULT_FOCUS_DIR+'/'))throw Error('Focus state must stay in the authorized demo directory');
 const RUN_ID=/^guided-demo-\d+$/,OPENING_MS=15000;
 async function readFocusFile(file){
  const real=await fsp.realpath(file);
  if(!real.startsWith(focusRoot+'/'))fail('INVALID_FOCUS_PATH',500);
  const stat=await fsp.stat(real);if(stat.size>131072)fail('FOCUS_FILE_TOO_LARGE',500);
  return await fsp.readFile(real,'utf8');
 }
 async function focusContext(meta){
  if(finishingRecordings.has(meta.id)||meta.status!=='RECORDING'||!Number.isInteger(meta.chunk_count)||meta.chunk_count<1||!Number.isFinite(Date.parse(meta.updated_at))||Date.parse(meta.updated_at)>clock()||clock()-Date.parse(meta.updated_at)>15000)return null;
  try{
   const active=JSON.parse(await readFocusFile(focusRoot+'/active-run.json'));
   if(!RUN_ID.test(active.run_id||'')||!['READY_FOR_RECORDING','RUNNING'].includes(active.status))return null;
   const runDir=path.join(focusRoot,'runs',active.run_id);
   const state=JSON.parse(await readFocusFile(runDir+'/state.json'));
   const recording=JSON.parse(await readFocusFile(runDir+'/recording.json'));
   if(state.run_id!==active.run_id||state.session_id!==active.session_id||state.status!==active.status||
      recording.id!==meta.id||recording.started_at!==meta.started_at)return null;
   const logged=(await readFocusFile(runDir+'/prompts.jsonl')).trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}});
   const initial=logged.find(item=>item?.kind==='initial'&&typeof item.text==='string'&&item.text.trim());
   const promptAt=typeof initial?.at==='number'?initial.at:Date.parse(initial?.at);
   const recordingAt=Date.parse(meta.started_at);
   if(!Number.isFinite(promptAt)||!Number.isFinite(recordingAt)||promptAt<recordingAt||promptAt>clock()||recordingAt>clock())return null;
   let existing=null;
   try{existing=JSON.parse(await readFocusFile(runDir+'/focus-ready.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
   return {runId:active.run_id,runDir,promptAt,eligibleAt:Math.max(recordingAt,promptAt)+OPENING_MS,existing};
  }catch(e){if(e instanceof RecordingError)throw e;if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}
 }
 async function serveFocus(req,res,id){
  if(!['GET','POST'].includes(req.method))fail('METHOD_NOT_ALLOWED',405);
  const meta=await load(id);token(req,meta);
  const context=await focusContext(meta);
  if(!context){if(req.method==='POST')fail('FOCUS_RUN_NOT_ACTIVE',409);json(res,{id,status:'UNBOUND'});return;}
  const {runId,runDir,promptAt,eligibleAt,existing}=context;
  if(existing){
   if(existing.run_id!==runId||existing.recording_id!==id||existing.view!=='dual')fail('FOCUS_ALREADY_WRITTEN',409);
   json(res,{id,run_id:runId,status:'ACKNOWLEDGED',view:'dual'});return;
  }
  if(req.method==='GET'){
   if(clock()<eligibleAt){json(res,{id,run_id:runId,status:'WAITING',opening_ms:OPENING_MS,wait_ms:eligibleAt-clock()});return;}
   let intent=focusIntents.get(id);
   if(!intent||intent.runId!==runId||clock()-intent.issuedAt>60000){intent={runId,nonce:randomUUID(),issuedAt:clock()};focusIntents.set(id,intent);}
   json(res,{id,run_id:runId,status:'READY',view:'dual',opening_ms:OPENING_MS,intent_token:intent.nonce});return;
  }
  const input=await jsonBody(req),intent=focusIntents.get(id);
  if(input.run_id!==runId||input.recording_id!==id||input.view!=='dual'||input.layout_applied!==true||input.capture_active!==true||
     !Number.isFinite(input.full_view_ms)||input.full_view_ms<OPENING_MS||clock()<eligibleAt||
     !intent||intent.runId!==runId||input.intent_token!==intent.nonce||clock()-intent.issuedAt>60000)fail('FOCUS_ACK_REJECTED',409);
  if(focusLocks.has(id))fail('FOCUS_BUSY',409);focusLocks.add(id);
  const releaseLifecycle=await acquireLifecycle(id);
  try{
   // Recheck after reading the request body; stopped/replaced runs never receive an ACK.
   const current=await focusContext(await load(id));
   if(!current||current.runId!==runId||current.existing)fail('FOCUS_RUN_CHANGED',409);
   const acknowledgement={run_id:runId,recording_id:id,at:new Date(clock()).toISOString(),view:'dual',
    verified_by:'matching active MediaRecorder and applied dual-layout acknowledgement',
    initial_prompt_logged_at:new Date(promptAt).toISOString(),opening_full_view_ms:input.full_view_ms};
   // An exclusive create never overwrites a manual or earlier acknowledgement.
   const temporary=runDir+'/.focus-ready-'+randomUUID()+'.tmp';
   try{
    await fsp.writeFile(temporary,JSON.stringify(acknowledgement,null,2)+'\n',{flag:'wx',mode:0o600});
    const finalContext=await focusContext(await load(id));
    if(!finalContext||finalContext.runId!==runId||finalContext.existing||finishingRecordings.has(id))fail('FOCUS_RUN_CHANGED',409);
    // No asynchronous gap between the final stop-intent check and atomic publication.
    fs.linkSync(temporary,runDir+'/focus-ready.json');
   }finally{await fsp.unlink(temporary).catch(()=>{});}
   focusIntents.delete(id);json(res,{id,run_id:runId,status:'ACKNOWLEDGED',view:'dual'});
  }finally{releaseLifecycle();focusLocks.delete(id);}
 }
 async function serve(req,res,url,{origin='http://127.0.0.1:4177'}={}){
  const write=!['GET','HEAD'].includes(req.method);guardOrigin(req,origin,write);
  if(url.pathname==='/demo-recording.js'){
   if(!['GET','HEAD'].includes(req.method))fail('METHOD_NOT_ALLOWED',405);
   const source=await fsp.readFile(ROOT+'/demo/final-dashboard/demo-recording.js');res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:source);return;
  }
  if(url.pathname===PREFIX+'/start'){
   if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
   if(locks.has('start'))fail('RECORDING_BUSY',409);locks.add('start');
   try{
   const input=await jsonBody(req);if(!MIME.test(input.mime_type||''))fail('WEBM_REQUIRED',415);
   if(!['browser','window','unknown'].includes(input.display_surface))fail('SELECT_PROJECT_TAB_OR_WINDOW');
   await fsp.mkdir(dir,{recursive:true,mode:0o700});
   // A single recording per handler avoids accidental parallel desktop captures.
   for(const entry of await fsp.readdir(dir,{withFileTypes:true})){
    if(!entry.isDirectory()||!ID.test(entry.name))continue;
    if(locks.has(entry.name))fail('RECORDING_BUSY',409);locks.add(entry.name);
    try{const other=await expire(await load(entry.name));if(['RECORDING','VALIDATING'].includes(other.status))fail('RECORDING_ALREADY_ACTIVE',409);}
    finally{locks.delete(entry.name);}
   }
   const id=randomUUID(),uploadToken=randomUUID();await fsp.mkdir(recordDir(id),{mode:0o700});await fsp.mkdir(recordDir(id)+'/chunks',{mode:0o700});
   const meta={id,status:'RECORDING',started_at:new Date(clock()).toISOString(),updated_at:new Date(clock()).toISOString(),mime_type:input.mime_type,display_surface:input.display_surface,upload_token_hash:createHash('sha256').update(uploadToken).digest('hex'),chunk_count:0,bytes:0,limits,source:'user_selected_browser_display_capture',route_mode:'preset_route_demonstration',raw_recording_retained:true};
   await save(meta);json(res,{...publicMeta(meta),upload_token:uploadToken},201);return;
   }finally{locks.delete('start');}
  }
  const match=url.pathname.match(/^\/api\/demo-ui\/recordings\/([^/]+)\/(chunk|finish|status|video|focus)$/);
  if(!match)fail('RECORDING_ROUTE_NOT_FOUND',404);
  const [,id,action]=match;recordDir(id);
  if(action==='focus'){await serveFocus(req,res,id);return;}
  if(['chunk','finish'].includes(action)){
   if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
   // Acquire before the first asynchronous read; never reuse a pre-lock snapshot.
   if(locks.has(id))fail('RECORDING_BUSY',409);locks.add(id);
   if(action==='finish')finishingRecordings.add(id);
   const releaseLifecycle=action==='finish'?await acquireLifecycle(id):null;
   try{
    const meta=await load(id);token(req,meta);await expire(meta);
    if(action==='chunk'){
     if(meta.status!=='RECORDING')fail('RECORDING_NOT_ACTIVE',409);
     if(!/^application\/octet-stream(?:;|$)/i.test(req.headers['content-type']||''))fail('BINARY_CHUNK_REQUIRED',415);
     const seq=Number(url.searchParams.get('seq'));if(!/^\d+$/.test(url.searchParams.get('seq')||'')||seq!==meta.chunk_count)fail('CHUNK_OUT_OF_ORDER',409);
     if(seq>=limits.maxChunks)fail('CHUNK_LIMIT_REACHED',413);
     const bytes=await body(req,limits.chunkBytes);if(!bytes.length)fail('EMPTY_CHUNK');if(meta.bytes+bytes.length>limits.totalBytes)fail('RECORDING_SIZE_LIMIT',413);
     const file=recordDir(id)+'/chunks/'+String(seq).padStart(6,'0')+'.bin';await fsp.writeFile(file,bytes,{flag:'wx',mode:0o600});
     meta.chunk_count++;meta.bytes+=bytes.length;meta.updated_at=new Date(clock()).toISOString();await save(meta);json(res,{id,status:meta.status,accepted_sequence:seq,chunk_count:meta.chunk_count,bytes:meta.bytes});return;
    }
    const input=await jsonBody(req);
    if(input.aborted===true){
     if(meta.status==='COMPLETE')fail('RECORDING_ALREADY_COMPLETE',409);
     meta.status='INTERRUPTED';meta.reason=String(input.reason||'CAPTURE_INTERRUPTED').slice(0,120);meta.finished_at=new Date(clock()).toISOString();await save(meta);json(res,publicMeta(meta));return;
    }
    if(meta.status==='COMPLETE'){json(res,publicMeta(meta));return;}
    if(meta.status!=='RECORDING')fail('RECORDING_NOT_ACTIVE',409);
    if(input.chunk_count!==meta.chunk_count||meta.chunk_count===0)fail('INCOMPLETE_UPLOAD',409);
    if(!Number.isFinite(input.duration_ms)||input.duration_ms<1||input.duration_ms>limits.maxSeconds*1000+10000)fail('INVALID_CAPTURE_DURATION');
    const wallMs=clock()-Date.parse(meta.started_at);if(wallMs>limits.maxSeconds*1000+60000)fail('TIME_LIMIT_REACHED',413);
    meta.status='VALIDATING';meta.finished_at=new Date(clock()).toISOString();meta.capture_duration_ms=input.duration_ms;meta.duration_source='browser_monotonic_clock';await save(meta);
    const temporary=recordDir(id)+'/source.webm.part',final=recordDir(id)+'/source.webm';let handle;
    try{
     handle=await fsp.open(temporary,'wx',0o600);const digest=createHash('sha256');
     for(let seq=0;seq<meta.chunk_count;seq++){const bytes=await fsp.readFile(recordDir(id)+'/chunks/'+String(seq).padStart(6,'0')+'.bin');digest.update(bytes);await handle.writeFile(bytes);}
     await handle.sync();await handle.close();handle=null;await fsp.rename(temporary,final);meta.sha256=digest.digest('hex');meta.probe=await probe(final,{maxSeconds:limits.maxSeconds});if(!Number.isFinite(meta.probe.duration_seconds)||meta.probe.duration_seconds>limits.maxSeconds)fail('VIDEO_DURATION_LIMIT',413);meta.status='COMPLETE';meta.validated_at=new Date(clock()).toISOString();await save(meta);json(res,publicMeta(meta));
    }catch(e){await handle?.close().catch(()=>{});await fsp.unlink(temporary).catch(()=>{});meta.status='INVALID';meta.reason=e.code||'VIDEO_VALIDATION_FAILED';await save(meta);throw e instanceof RecordingError?e:new RecordingError('VIDEO_VALIDATION_FAILED',422);}
    return;
   }finally{releaseLifecycle?.();if(action==='finish')finishingRecordings.delete(id);locks.delete(id);}
  }
  if(!['GET','HEAD'].includes(req.method))fail('METHOD_NOT_ALLOWED',405);
  // Status and playback only read the atomically published snapshot.
  const meta=await load(id);
  if(action==='status'){json(res,publicMeta(meta));return;}
  if(meta.status!=='COMPLETE')fail('VIDEO_NOT_VALIDATED',409);
  const file=recordDir(id)+'/source.webm',stat=await fsp.stat(file);let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const range=String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);if(!range)fail('INVALID_RANGE',416);start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=stat.size)fail('INVALID_RANGE',416);status=206;}
  res.writeHead(status,{'content-type':'video/webm','content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','x-content-type-options':'nosniff','content-disposition':'inline; filename="agnes-demo-'+id+'.webm"',...(status===206?{'content-range':'bytes '+start+'-'+end+'/'+stat.size}:{})});
  if(req.method==='HEAD'){res.end();return;}await pipeline(fs.createReadStream(file,{start,end}),res);
 }
 return function handle(req,res,url,options={}){
  if(url.pathname!=='/demo-recording.js'&&!url.pathname.startsWith(PREFIX+'/'))return false;
  void serve(req,res,url,options).catch(e=>{if(res.headersSent){res.destroy();return;}json(res,{error:e instanceof RecordingError?e.code:'RECORDING_IO_ERROR'},e.status||500);});
  return true;
 };
}
export const handleDemoRecording=createRecordingHandler();
