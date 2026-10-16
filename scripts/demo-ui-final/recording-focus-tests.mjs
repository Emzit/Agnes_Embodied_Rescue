import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {createRecordingHandler} from '../../demo/final-dashboard/demo-recording-server.mjs';
const root='/data-ssd/zhongchengkai/agnes/artifacts/demo-video-20261013';
const fixture=root+'/recordings/focus-test-'+randomUUID(),origin='http://127.0.0.1:4177';
const focusDirectory=fixture+'/focus-state',directory=fixture+'/captures';
await fs.mkdir(focusDirectory+'/runs',{recursive:true});
let now=Date.now();
const handler=createRecordingHandler({directory,focusDirectory,clock:()=>now});
async function call(route,{method='GET',body,bytes,token,headers={}}={}){
 const content=bytes??(body===undefined?undefined:Buffer.from(JSON.stringify(body)));
 const req=Readable.from(content?[content]:[]);req.method=method;req.url=route;
 req.headers={host:'127.0.0.1:4177','sec-fetch-site':'same-origin',...(method==='POST'?{origin,'content-type':bytes?'application/octet-stream':'application/json'}:{}),...(token?{'x-recording-token':token}:{}),...headers};
 let status,parts=[];const res=new Writable({write(chunk,_,done){parts.push(Buffer.from(chunk));done();}});
 res.writeHead=s=>{status=s;res.headersSent=true;};
 const done=new Promise((resolve,reject)=>{res.on('finish',resolve);res.on('error',reject);});
 handler(req,res,new URL(route,origin),{origin});await done;
 return {status,json:JSON.parse(Buffer.concat(parts).toString())};
}
const tests=[];
async function test(name,fn){await fn();tests.push({name,status:'PASS'});}
let recording,runId='guided-demo-1791999999999',runDir=focusDirectory+'/runs/'+runId,seq=0;
const route=()=>'/api/demo-ui/recordings/'+recording.id+'/focus';
const get=token=>call(route(),{token:token??recording.upload_token});
const ack=(intent,extra={})=>call(route(),{method:'POST',token:recording.upload_token,body:{run_id:runId,recording_id:recording.id,intent_token:intent.intent_token,view:'dual',layout_applied:true,capture_active:true,full_view_ms:15000,...extra}});
async function chunk(){return call('/api/demo-ui/recordings/'+recording.id+'/chunk?seq='+seq++,{method:'POST',token:recording.upload_token,bytes:Buffer.from('TECHNICAL_TEST_ONLY_NOT_REAL_CAPTURE')});}
async function state(status='RUNNING'){
 const value={run_id:runId,session_id:runId,status};
 await fs.writeFile(focusDirectory+'/active-run.json',JSON.stringify(value));await fs.writeFile(runDir+'/state.json',JSON.stringify(value));
}
await test('isolated fixture recording starts; focus storage outside project is refused',async()=>{
 assert.throws(()=>createRecordingHandler({focusDirectory:'/tmp/focus-test'}));
 const r=await call('/api/demo-ui/recordings/start',{method:'POST',body:{mime_type:'video/webm',display_surface:'browser'}});
 assert.equal(r.status,201);recording=r.json;
});
await test('focus requires upload token and cannot bind without actual active run evidence',async()=>{
 assert.equal((await get('bad')).status,403);assert.equal((await get()).json.status,'UNBOUND');
 await fs.mkdir(runDir);await state();
 await fs.writeFile(runDir+'/recording.json',JSON.stringify({id:recording.id,started_at:recording.started_at}));
 await fs.writeFile(runDir+'/prompts.jsonl',JSON.stringify({kind:'initial',at:now,text:'Simple real initial prompt'})+'\n');
 assert.equal((await get()).json.status,'UNBOUND'); // No actual uploaded chunk yet.
 await chunk();
 assert.equal((await get()).json.status,'WAITING');
});
await test('early ACK cannot skip opening or introduce a forged nonce',async()=>{
 const r=await ack({intent_token:'forged'});
 assert.equal(r.status,409);await assert.rejects(fs.stat(runDir+'/focus-ready.json'),{code:'ENOENT'});
});
let intent;
await test('fifteen seconds and fresh recording produce a run-bound intent',async()=>{
 now+=15001;await chunk();const r=await get();assert.equal(r.status,200);assert.equal(r.json.status,'READY');
 assert.equal(r.json.run_id,runId);assert.equal(r.json.view,'dual');intent=r.json;
 assert.equal((await get()).json.intent_token,intent.intent_token);
});
await test('ACK validates recording/run identities, real layout and capture state, and full opening time',async()=>{
 for(const change of [{run_id:'guided-demo-1'},{recording_id:randomUUID()},{intent_token:'bad'},{view:'full'},{layout_applied:false},{capture_active:false},{full_view_ms:14999},{full_view_ms:null}]){
  assert.equal((await ack(intent,change)).status,409);
 }
 await assert.rejects(fs.stat(runDir+'/focus-ready.json'),{code:'ENOENT'});
});
await test('cross-origin ACK is denied before creating focus-ready',async()=>{
 const r=await call(route(),{method:'POST',token:recording.upload_token,headers:{origin:'https://bad.invalid'},body:{}});
 assert.equal(r.status,403);await assert.rejects(fs.stat(runDir+'/focus-ready.json'),{code:'ENOENT'});
});
await test('stopped or replaced run invalidates previously issued intent',async()=>{
 await state('NEEDS_REVIEW');assert.equal((await ack(intent)).status,409);
 await state();
 const original=await fs.readFile(runDir+'/recording.json');
 await fs.writeFile(runDir+'/recording.json',JSON.stringify({id:randomUUID(),started_at:recording.started_at}));
 assert.equal((await ack(intent)).status,409);await fs.writeFile(runDir+'/recording.json',original);
});
await test('stale recording cannot release the runner even with a valid intent',async()=>{
 now+=15001;assert.equal((await ack(intent)).status,409);await chunk();
});
await test('successful dual-layout ACK is atomic, idempotent and retains run/recording provenance',async()=>{
 const r=await ack(intent);assert.equal(r.status,200);assert.equal(r.json.status,'ACKNOWLEDGED');
 const before=await fs.readFile(runDir+'/focus-ready.json'),data=JSON.parse(before);
 assert.equal(data.run_id,runId);assert.equal(data.recording_id,recording.id);assert.equal(data.view,'dual');assert.equal(data.opening_full_view_ms,15000);
 assert.equal((await ack(intent)).json.status,'ACKNOWLEDGED');assert.deepEqual(await fs.readFile(runDir+'/focus-ready.json'),before);
 assert.equal((await fs.readdir(runDir)).some(x=>x.endsWith('.tmp')),false);
});
await test('acknowledging view never changes permission decisions, prompts, plan or recording state',async()=>{
 assert.equal(JSON.parse(await fs.readFile(runDir+'/state.json')).status,'RUNNING');
 assert.equal(JSON.parse(await fs.readFile(directory+'/'+recording.id+'/metadata.json')).status,'RECORDING');
 assert.equal((await fs.readFile(runDir+'/prompts.jsonl','utf8')).trim().split('\n').length,1);
 await assert.rejects(fs.stat(runDir+'/permission-decisions.jsonl'),{code:'ENOENT'});
 await call('/api/demo-ui/recordings/'+recording.id+'/finish',{method:'POST',token:recording.upload_token,body:{aborted:true,reason:'ISOLATED_FOCUS_TEST_NOT_CAPTURE'}});
 assert.equal((await get()).json.status,'UNBOUND');
});

await test('finish arriving during focus publication prevents ACK and retains an interrupted source',async()=>{
 const started=await call('/api/demo-ui/recordings/start',{method:'POST',body:{mime_type:'video/webm',display_surface:'browser'}});
 recording=started.json;seq=0;runId='guided-demo-1791999999998';runDir=focusDirectory+'/runs/'+runId;
 await fs.mkdir(runDir);await state();await fs.writeFile(runDir+'/recording.json',JSON.stringify({id:recording.id,started_at:recording.started_at}));
 await fs.writeFile(runDir+'/prompts.jsonl',JSON.stringify({kind:'initial',at:now,text:'Another isolated initial prompt'})+'\n');
 await chunk();now+=15001;await chunk();const nextIntent=(await get()).json;
 const original=fs.writeFile;let ready,release;
 const reached=new Promise(resolve=>{ready=resolve;}),hold=new Promise(resolve=>{release=resolve;});
 fs.writeFile=async function(file,...args){const result=await original.call(this,file,...args);if(String(file).includes('/.focus-ready-')){ready();await hold;}return result;};
 let pending,finish;
 try{
  pending=ack(nextIntent);await reached;
  finish=call('/api/demo-ui/recordings/'+recording.id+'/finish',{method:'POST',token:recording.upload_token,body:{aborted:true,reason:'ISOLATED_RACE_TEST'}});
  await new Promise(resolve=>setTimeout(resolve,20));
 }finally{release();fs.writeFile=original;}
 assert.equal((await pending).status,409);assert.equal((await finish).json.status,'INTERRUPTED');
 await assert.rejects(fs.stat(runDir+'/focus-ready.json'),{code:'ENOENT'});
 assert.equal((await fs.readdir(runDir)).some(x=>x.endsWith('.tmp')),false);
});

const report={kind:'ISOLATED_AUTO_FOCUS_HTTP_TESTS_NO_ROBOT_OR_MODEL',pass:true,fixture,tests};
await fs.writeFile(root+'/recording-focus-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
