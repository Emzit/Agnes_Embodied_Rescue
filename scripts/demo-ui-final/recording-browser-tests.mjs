import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Window} from '../../third_party/agnes-harness/node_modules/.pnpm/happy-dom@20.14.3/node_modules/happy-dom/lib/index.js';
const source=await fs.readFile('demo/final-dashboard/demo-recording.js','utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await wait(5);}throw Error('test timed out');}
const tests=[];
async function test(name,fn){await fn();tests.push({name,status:'PASS'});}
function setup({surface='browser',denied=false,failChunk=false,holdFirst=false,fullscreen=true,fullscreenReject=false}={}){
 const window=new Window({url:'http://127.0.0.1:4177/demo'}),document=window.document;
 document.write('<div class="head-right"></div><div id="presentation-controls"></div><iframe id="native-chat"></iframe>');
 let fullscreenElement=null,fullscreenRequests=0,fullscreenExits=0;
 Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:fullscreen});
 Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreenElement});
 document.documentElement.requestFullscreen=async()=>{fullscreenRequests++;if(fullscreenReject)throw Error('ISOLATED_FULLSCREEN_DENIED');fullscreenElement=document.documentElement;document.dispatchEvent(new window.Event('fullscreenchange'));};
 document.exitFullscreen=async()=>{fullscreenExits++;fullscreenElement=null;document.dispatchEvent(new window.Event('fullscreenchange'));};
 const calls=[];let captures=0,stopped=0,instance,inFlight=0,maxInFlight=0,release;
 const blocked=new Promise(r=>{release=r;});
 const track={getSettings:()=>({displaySurface:surface}),stop:()=>{stopped++;},addEventListener(){}};
 class Recorder{
  static isTypeSupported(){return true;}
  constructor(){instance=this;this.state='inactive';}
  start(){this.state='recording';}
  emit(text){this.ondataavailable?.({data:new Blob([text],{type:'video/webm'})});}
  stop(){this.state='inactive';this.emit('final');queueMicrotask(()=>this.onstop?.());}
 }
 window.MediaRecorder=Recorder;
 const navigator={mediaDevices:{getDisplayMedia:async()=>{captures++;if(denied)throw Object.assign(Error('permission denied'),{name:'NotAllowedError'});return {getVideoTracks:()=>[track],getTracks:()=>[track]};}}};
 const fetch=async(url,options={})=>{
  calls.push({url,options});let body;
  if(url.endsWith('/start'))body={id:'test-recording',upload_token:'test-token',limits:{chunkBytes:16777216,maxSeconds:1200}};
  else if(url.includes('/chunk?')){
   inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);if(holdFirst&&url.endsWith('seq=0'))await blocked;await wait(3);inFlight--;
   if(failChunk)return {ok:false,status:500,json:async()=>({error:'ISOLATED_UPLOAD_FAILURE'})};body={accepted:true};
  }else if(url.endsWith('/status'))body={status:'RECORDING'};
  else body=JSON.parse(options.body||'{}').aborted?{status:'INTERRUPTED'}:{status:'COMPLETE',video_url:'/api/demo-ui/recordings/test-recording/video'};
  return {ok:true,status:200,json:async()=>body};
 };
 vm.runInContext(source,vm.createContext({window,document,navigator,MediaRecorder:Recorder,fetch,Blob,CustomEvent:window.CustomEvent,AbortSignal,performance,setTimeout,clearTimeout,setInterval,clearInterval,console}));
 return {window,document,calls,start:()=>document.querySelector('#demo-recording-start').click(),stop:()=>window.demoRecording.stop(),get recorder(){return instance;},get captures(){return captures;},get stopped(){return stopped;},get maxInFlight(){return maxInFlight;},get fullscreenRequests(){return fullscreenRequests;},get fullscreenExits(){return fullscreenExits;},escapeFullscreen(){fullscreenElement=null;document.dispatchEvent(new window.Event('fullscreenchange'));},release};
}
await test('module initialization never opens screen permission or sends API calls',async()=>{
 const h=setup();assert.equal(h.captures,0);assert.equal(h.calls.length,0);assert.ok(h.document.querySelector('#presentation-controls #demo-recording-controls'));await h.window.happyDOM.close();
});
await test('user denial makes no recording and releases the button',async()=>{
 const h=setup({denied:true});h.start();await until(()=>h.document.body.dataset.recordingState==='FAILED');assert.equal(h.calls.length,0);assert.equal(h.document.querySelector('#demo-recording-start').disabled,false);await h.window.happyDOM.close();
});
await test('whole desktop selection is stopped before the server starts a recording',async()=>{
 const h=setup({surface:'monitor'});h.start();await until(()=>h.document.body.dataset.recordingState==='FAILED');assert.equal(h.calls.length,0);assert.equal(h.stopped,1);await h.window.happyDOM.close();
});
await test('project window capture is allowed, chunks upload strictly serially, final chunk saves before validation',async()=>{
 const h=setup({surface:'window',holdFirst:true});h.start();await until(()=>h.document.body.dataset.recordingState==='RECORDING');h.recorder.emit('first');h.recorder.emit('second');
 await until(()=>h.calls.some(x=>x.url.includes('/chunk?')));assert.equal(h.calls.filter(x=>x.url.includes('/chunk?')).length,1);h.release();h.stop();
 await until(()=>h.document.body.dataset.recordingState==='COMPLETE');
 const chunkCalls=h.calls.filter(x=>x.url.includes('/chunk?'));assert.deepEqual(chunkCalls.map(x=>x.url.split('seq=')[1]),['0','1','2']);assert.equal(h.maxInFlight,1);
 const finish=h.calls.find(x=>x.url.endsWith('/finish'));assert.equal(JSON.parse(finish.options.body).chunk_count,3);assert.equal(h.stopped,1);assert.equal(h.document.querySelector('#demo-recording-result').hidden,false);assert.equal(h.window.demoRecording.getState().id,null);await h.window.happyDOM.close();
});
await test('upload failure stops capture, preserves interrupted server record, never claims a playable result',async()=>{
 const h=setup({failChunk:true});h.start();await until(()=>h.document.body.dataset.recordingState==='RECORDING');h.recorder.emit('first');
 await until(()=>h.document.body.dataset.recordingState==='FAILED');
 assert.equal(h.stopped,1);assert.ok(h.calls.some(x=>x.url.endsWith('/finish')&&JSON.parse(x.options.body).aborted));assert.equal(h.document.querySelector('#demo-recording-result').hidden,true);await h.window.happyDOM.close();
});
await test('fullscreen is never automatic and explicit clicks toggle only the real Fullscreen API',async()=>{
 const h=setup();const button=h.document.querySelector('#demo-fullscreen');
 assert.equal(h.fullscreenRequests,0);assert.equal(button.textContent,'全屏');button.click();
 await until(()=>!button.disabled&&button.textContent==='退出全屏');
 assert.equal(h.document.fullscreenElement,h.document.documentElement);assert.equal(button.getAttribute('aria-pressed'),'true');
 assert.equal(h.fullscreenRequests,1);assert.equal(h.captures,0);assert.equal(h.calls.length,0);
 button.click();await until(()=>!button.disabled&&button.textContent==='全屏');
 assert.equal(h.fullscreenExits,1);assert.equal(h.document.fullscreenElement,null);assert.equal(h.document.body.dataset.recordingState,'IDLE');
 button.click();await until(()=>button.textContent==='退出全屏');h.escapeFullscreen();assert.equal(button.textContent,'全屏');assert.equal(button.getAttribute('aria-pressed'),'false');await h.window.happyDOM.close();
});
await test('unsupported fullscreen presents an independent browser fallback without disabling recording',async()=>{
 const h=setup({fullscreen:false});const button=h.document.querySelector('#demo-fullscreen');
 assert.equal(button.disabled,true);assert.match(h.document.querySelector('#demo-fullscreen-hint').textContent,/独立 Chrome \/ Edge/);
 assert.equal(h.document.querySelector('#demo-recording-start').disabled,false);assert.equal(h.fullscreenRequests,0);assert.equal(h.captures,0);assert.equal(h.calls.length,0);await h.window.happyDOM.close();
});
await test('fullscreen rejection restores control and cannot mutate recording status or trigger capture',async()=>{
 const h=setup({fullscreenReject:true});const button=h.document.querySelector('#demo-fullscreen');button.click();
 await until(()=>!button.disabled);assert.equal(button.textContent,'全屏');assert.match(h.document.querySelector('#demo-fullscreen-hint').textContent,/未能进入全屏/);
 assert.equal(h.document.body.dataset.recordingState,'IDLE');assert.equal(h.captures,0);assert.equal(h.calls.length,0);await h.window.happyDOM.close();
});
const report={kind:'ISOLATED_FAKE_BROWSER_RECORDING_TESTS_NO_CAPTURE',generated_at:new Date().toISOString(),pass:true,tests};
await fs.writeFile('artifacts/demo-video-20261013/recording-browser-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
