import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable,Writable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRecordingHandler,probeRecording,RECORDING_LIMITS} from '../../demo/final-dashboard/demo-recording-server.mjs';
const ROOT='/data-ssd/zhongchengkai/agnes',BASE=ROOT+'/artifacts/demo-video-20261013/recordings';
const directory=BASE+'/isolated-test-'+randomUUID(),origin='http://127.0.0.1:4177';
await fs.mkdir(directory,{recursive:true});
const handle=createRecordingHandler({directory});
const results=[];
async function test(name,fn){await fn();results.push({name,status:'PASS'});}
async function call(url,options={}){
 const data=options.bytes??(options.body===undefined?undefined:Buffer.from(JSON.stringify(options.body)));
 const req=Readable.from(data?[data]:[]);req.method=options.method||'GET';req.url=url;req.headers={host:'127.0.0.1:4177','sec-fetch-site':'same-origin',...(req.method==='POST'?{origin,'content-type':options.bytes?'application/octet-stream':'application/json'}:{}),...(options.token?{'x-recording-token':options.token}:{}),...(data?{'content-length':String(data.length)}:{}),...options.headers};
 let status,headers,chunks=[];
 const res=new Writable({write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback();}});
 res.writeHead=(s,h)=>{status=s;headers=h;res.headersSent=true;};
 const done=new Promise((resolve,reject)=>{res.on('finish',resolve);res.on('error',reject);});
 assert.equal((options.handler||handle)(req,res,new URL(url,origin),{origin}),true);await done;
 const bytes=Buffer.concat(chunks);let json;try{json=JSON.parse(bytes.toString());}catch{}
 return {status,headers,bytes,json};
}
const begin=()=>call('/api/demo-ui/recordings/start',{method:'POST',body:{mime_type:'video/webm;codecs=vp8',display_surface:'browser'}});
const post=(run,action,body)=>call('/api/demo-ui/recordings/'+run.id+'/'+action,{method:'POST',token:run.upload_token,body});
await test('storage constructor refuses paths outside the workspace recording area',()=>assert.throws(()=>createRecordingHandler({directory:'/tmp/recording'})));
await test('unrelated routes return false without accepting a recording',()=>assert.equal(handle({}, {},new URL('/unrelated',origin)),false));
await test('cross-origin and forged-host writes are rejected before touching disk',async()=>{
 for(const headers of [{origin:'https://attacker.invalid'},{host:'attacker.invalid'},{'sec-fetch-site':'cross-site'}]){
  const r=await call('/api/demo-ui/recordings/start',{method:'POST',body:{mime_type:'video/webm',display_surface:'browser'},headers});assert.equal(r.status,403);
 }
 assert.deepEqual(await fs.readdir(directory),[]);
});
await test('unsupported MIME and desktop capture are refused',async()=>{
 assert.equal((await call('/api/demo-ui/recordings/start',{method:'POST',body:{mime_type:'video/mp4',display_surface:'browser'}})).status,415);
 assert.equal((await call('/api/demo-ui/recordings/start',{method:'POST',body:{mime_type:'video/webm',display_surface:'monitor'}})).status,400);
});
let run;
await test('server-generated recording ID and upload token are required; only one active capture',async()=>{
 const r=await begin();assert.equal(r.status,201);run=r.json;assert.match(run.id,/^[0-9a-f-]{36}$/);assert.ok(run.upload_token);assert.equal((await begin()).status,409);
 const rejected=await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=0',{method:'POST',token:'wrong',bytes:Buffer.from('bad')});assert.equal(rejected.status,403);
 const status=await call('/api/demo-ui/recordings/'+run.id+'/status');assert.equal(status.json.upload_token,undefined);assert.equal(status.json.upload_token_hash,undefined);
});
await test('path traversal, invalid sequences, oversized body and empty chunks cannot create files',async()=>{
 for(const bad of ['..%2Foutside','%252e%252e','not-an-id'])assert.equal((await call('/api/demo-ui/recordings/'+bad+'/status')).status,400);
 assert.equal((await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=1',{method:'POST',token:run.upload_token,bytes:Buffer.from('wrong')})).status,409);
 assert.equal((await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=0',{method:'POST',token:run.upload_token,bytes:Buffer.from('wrong'),headers:{'content-length':String(RECORDING_LIMITS.chunkBytes+1)}})).status,413);
 assert.equal((await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=0',{method:'POST',token:run.upload_token,bytes:Buffer.alloc(0)})).status,400);
 assert.deepEqual(await fs.readdir(path.join(directory,run.id,'chunks')),[]);
});
const fixture=directory+'/synthetic-fixture.webm';
await promisify(execFile)(ROOT+'/runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:size=192x128:rate=10','-t','0.6','-c:v','libvpx','-an','-n',fixture],{cwd:ROOT});
const bytes=await fs.readFile(fixture),parts=[bytes.subarray(0,53),bytes.subarray(53)];
await test('ordered binary chunks are immutable and incomplete uploads cannot finish',async()=>{
 let response=await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=0',{method:'POST',token:run.upload_token,bytes:parts[0]});assert.equal(response.status,200);
 assert.equal((await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=0',{method:'POST',token:run.upload_token,bytes:Buffer.from('overwrite')})).status,409);
 assert.deepEqual(await fs.readFile(path.join(directory,run.id,'chunks','000000.bin')),parts[0]);
 assert.equal((await post(run,'finish',{chunk_count:2,duration_ms:600})).status,409);
 response=await call('/api/demo-ui/recordings/'+run.id+'/chunk?seq=1',{method:'POST',token:run.upload_token,bytes:parts[1]});assert.equal(response.status,200);
});
await test('actual ffprobe validates concatenated WebM; original bytes and hash remain exact',async()=>{
 const response=await post(run,'finish',{chunk_count:2,duration_ms:600});assert.equal(response.status,200);assert.equal(response.json.status,'COMPLETE');
 assert.equal(response.json.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(response.json.probe.streams[0].width,192);assert.ok(Number(response.json.probe.streams[0].nb_read_packets)>0);
 assert.deepEqual(await fs.readFile(path.join(directory,run.id,'source.webm')),bytes);
 assert.equal((await post(run,'finish',{chunk_count:2,duration_ms:600})).json.status,'COMPLETE');
 assert.equal((await post(run,'finish',{aborted:true})).status,409);
});
await test('validated video supports full and range playback without exposing upload secrets',async()=>{
 const full=await call('/api/demo-ui/recordings/'+run.id+'/video');assert.equal(full.status,200);assert.deepEqual(full.bytes,bytes);
 const range=await call('/api/demo-ui/recordings/'+run.id+'/video',{headers:{range:'bytes=4-19'}});assert.equal(range.status,206);assert.deepEqual(range.bytes,bytes.subarray(4,20));
 assert.equal((await call('/api/demo-ui/recordings/'+run.id+'/video',{headers:{range:'bytes=999999-'}})).status,416);
 assert.equal((await call('/api/demo-ui/recordings/'+run.id+'/video',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
});
await test('invalid WebM retains evidence, marks failure and removes temporary assembly file',async()=>{
 const bad=(await begin()).json;
 await call('/api/demo-ui/recordings/'+bad.id+'/chunk?seq=0',{method:'POST',token:bad.upload_token,bytes:Buffer.from('not a real video')});
 const result=await post(bad,'finish',{chunk_count:1,duration_ms:600});assert.equal(result.status,422);
 const meta=(await call('/api/demo-ui/recordings/'+bad.id+'/status')).json;assert.equal(meta.status,'INVALID');
 assert.equal((await call('/api/demo-ui/recordings/'+bad.id+'/video')).status,409);
 assert.equal((await fs.stat(path.join(directory,bad.id,'source.webm'))).isFile(),true);
 await assert.rejects(fs.stat(path.join(directory,bad.id,'source.webm.part')),{code:'ENOENT'});
 assert.equal((await fs.readdir(path.join(directory,bad.id,'chunks'))).length,1);
});
await test('explicit interrupted capture releases the recording slot while preserving received fragments',async()=>{
 const stopped=(await begin()).json;
 await call('/api/demo-ui/recordings/'+stopped.id+'/chunk?seq=0',{method:'POST',token:stopped.upload_token,bytes:parts[0]});
 assert.equal((await post(stopped,'finish',{aborted:true,reason:'ISOLATED_TEST_CANCEL'})).json.status,'INTERRUPTED');
 assert.equal((await fs.readdir(path.join(directory,stopped.id,'chunks'))).length,1);
 const next=(await begin()).json;assert.ok(next.id);await post(next,'finish',{aborted:true});
});
await test('same-ID lock is held before metadata read, so a competing abort cannot invalidate a pending write',async()=>{
 const concurrent=(await begin()).json,metaPath=path.join(directory,concurrent.id,'metadata.json');
 const originalRead=fs.readFile;let captured=false,notifyReady,resume;
 const ready=new Promise(resolve=>{notifyReady=resolve;}),held=new Promise(resolve=>{resume=resolve;});
 fs.readFile=async function(file,...args){
  const result=await originalRead.call(this,file,...args);
  if(String(file)===metaPath&&!captured){captured=true;notifyReady();await held;}
  return result;
 };
 let pending;
 try{
  pending=call('/api/demo-ui/recordings/'+concurrent.id+'/chunk?seq=0',{method:'POST',token:concurrent.upload_token,bytes:parts[0]});
  await ready;
  const competing=await post(concurrent,'finish',{aborted:true,reason:'COMPETING_CANCEL'});
  assert.equal(competing.status,409);assert.equal(competing.json.error,'RECORDING_BUSY');
 }finally{resume();fs.readFile=originalRead;}
 assert.equal((await pending).status,200);
 const latest=JSON.parse(await fs.readFile(metaPath,'utf8'));assert.equal(latest.status,'RECORDING');assert.equal(latest.chunk_count,1);
 await post(concurrent,'finish',{aborted:true});
});
await test('GET status never expires or writes metadata; a locked start cleans expired records',async()=>{
 let now=Date.now();const isolated=directory+'/expired-status';const handler=createRecordingHandler({directory:isolated,clock:()=>now,limits:{...RECORDING_LIMITS,maxSeconds:1}});
 const first=(await call('/api/demo-ui/recordings/start',{method:'POST',handler,body:{mime_type:'video/webm',display_surface:'browser'}})).json;
 const metaPath=path.join(isolated,first.id,'metadata.json'),before=await fs.readFile(metaPath);
 now+=62000;const result=await call('/api/demo-ui/recordings/'+first.id+'/status',{handler});
 assert.equal(result.json.status,'RECORDING');assert.deepEqual(await fs.readFile(metaPath),before);
 const next=await call('/api/demo-ui/recordings/start',{method:'POST',handler,body:{mime_type:'video/webm',display_surface:'browser'}});assert.equal(next.status,201);
 assert.equal(JSON.parse(await fs.readFile(metaPath,'utf8')).status,'INTERRUPTED');
 await call('/api/demo-ui/recordings/'+next.json.id+'/finish',{method:'POST',handler,token:next.json.upload_token,body:{aborted:true}});
});
await test('real packet PTS rejects overlong live WebM even with missing container duration and a false short client duration',async()=>{
 const liveFixture=directory+'/synthetic-live-no-duration.webm';
 await promisify(execFile)(ROOT+'/runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg',['-v','error','-f','lavfi','-i','color=c=green:size=192x128:rate=10','-t','2','-c:v','libvpx','-live','1','-an','-n',liveFixture],{cwd:ROOT});
 const probe=await probeRecording(liveFixture,{maxSeconds:5});assert.equal(Number.isFinite(Number(probe.format.duration)),false);assert.ok(probe.duration_seconds>=1.9);
 const isolated=directory+'/duration-limit',handler=createRecordingHandler({directory:isolated,limits:{...RECORDING_LIMITS,maxSeconds:1}});
 const recording=(await call('/api/demo-ui/recordings/start',{method:'POST',handler,body:{mime_type:'video/webm',display_surface:'browser'}})).json;
 assert.equal((await call('/api/demo-ui/recordings/'+recording.id+'/chunk?seq=0',{method:'POST',handler,token:recording.upload_token,bytes:await fs.readFile(liveFixture)})).status,200);
 const result=await call('/api/demo-ui/recordings/'+recording.id+'/finish',{method:'POST',handler,token:recording.upload_token,body:{chunk_count:1,duration_ms:500}});
 assert.equal(result.status,413);assert.equal(result.json.error,'VIDEO_DURATION_LIMIT');
 const status=(await call('/api/demo-ui/recordings/'+recording.id+'/status',{handler})).json;assert.equal(status.status,'INVALID');assert.equal(status.video_url,null);
 await assert.rejects(fs.stat(path.join(isolated,recording.id,'source.webm.part')),{code:'ENOENT'});
});
const report={kind:'ISOLATED_RECORDING_API_TESTS_SYNTHETIC_VIDEO_NOT_DEMO',pass:true,generated_at:new Date().toISOString(),directory,tests:results};
await fs.writeFile(ROOT+'/artifacts/demo-video-20261013/recording-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
