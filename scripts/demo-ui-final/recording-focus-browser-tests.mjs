import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Window} from '../../third_party/agnes-harness/node_modules/.pnpm/happy-dom@20.14.3/node_modules/happy-dom/lib/index.js';
const recorderSource=await fs.readFile('demo/final-dashboard/demo-recording.js','utf8');
const uiSource=(await fs.readFile('demo/final-dashboard/demo-ui.js','utf8')).split("const ctx=$('#live-map')")[0];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<500;i++){if(fn())return;await pause(2);}throw Error('Condition timed out');}
function setup({holdCapture=false,holdStart=false,reduceMotion=true,holdFocus=false}={}){
 const window=new Window({url:'http://127.0.0.1:4177/demo'}),document=window.document;
 document.write('<div class="head-right"></div><section id="presentation-controls" hidden></section><button id="enter-presentation"></button><button id="presentation-full"></button><button id="presentation-dual"></button><button id="exit-presentation"></button><iframe id="native-chat"></iframe>');
 window.scrollTo=()=>{};window.requestAnimationFrame=fn=>setTimeout(fn,1);
 // A broken root transition must never intercept this page's exit handling.
 let viewTransitions=0;document.startViewTransition=()=>{viewTransitions++;return {finished:new Promise(()=>{}),skipTransition(){}};};
 let releaseCapture,releaseStart,releaseFocus;const captureGate=new Promise(resolve=>{releaseCapture=resolve;}),startGate=new Promise(resolve=>{releaseStart=resolve;}),focusGate=new Promise(resolve=>{releaseFocus=resolve;});
 let stopped=0;
 let now=0,instance,focusAck=[],calls=[],captureCalls=0;
 const track={getSettings:()=>({displaySurface:'browser'}),stop(){stopped++;},addEventListener(){}};
 class Recorder {static isTypeSupported(){return true;}constructor(){instance=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}}
 window.MediaRecorder=Recorder;
 const fakeFetch=async(url,options={})=>{
  calls.push({url,options});let result;
  if(url.endsWith('/start')){if(holdStart)await startGate;result={id:'recording-fixture',upload_token:'fixture-token',limits:{chunkBytes:100000,maxSeconds:1200}};}
  else if(url.endsWith('/focus')){
   if(options.method==='POST'){focusAck.push(JSON.parse(options.body));result={id:'recording-fixture',run_id:'guided-demo-1',status:'ACKNOWLEDGED'};}
   else {if(holdFocus)await focusGate;result={id:'recording-fixture',run_id:'guided-demo-1',status:now>=15000?'READY':'WAITING',view:'dual',intent_token:'fixture-intent'};}
  }else result={status:'COMPLETE',video_url:'/synthetic-test-only'};
  return {ok:true,json:async()=>result};
 };
 const context=vm.createContext({window,document,navigator:{mediaDevices:{getDisplayMedia:async()=>{captureCalls++;if(holdCapture)await captureGate;return {getTracks:()=>[track],getVideoTracks:()=>[track]};}}},MediaRecorder:Recorder,fetch:fakeFetch,CustomEvent:window.CustomEvent,AbortSignal,
  location:window.location,URLSearchParams,matchMedia:()=>({matches:reduceMotion}),performance:{now:()=>now},
  setTimeout:(fn,ms)=>setTimeout(fn,ms===1000?2:ms),clearTimeout,setInterval,clearInterval,console});
 vm.runInContext('(function(){'+uiSource+'})();',context);
 vm.runInContext('(function(){'+recorderSource+'})();',context);
 return {window,document,focusAck,calls,advance:n=>{now=n;},releaseCapture,releaseStart,releaseFocus,get stopped(){return stopped;},get transitions(){return viewTransitions;},get captures(){return captureCalls;},get recording(){return instance;},
  start:()=>document.querySelector('#demo-recording-start').click(),stop:()=>window.demoRecording.stop()};
}
const tests=[];async function test(name,fn){await fn();tests.push({name,status:'PASS'});}
await test('real implementation opens full layout then switches/ACKs only after 15 seconds of continuous opening',async()=>{
 const h=setup();const iframe=h.document.querySelector('#native-chat');assert.equal(h.captures,0);
 h.start();await until(()=>h.document.body.dataset.recordingState==='RECORDING'&&h.document.body.classList.contains('presentation-on'));
 await pause(25);h.advance(14999);await pause(25);assert.equal(h.focusAck.length,0);assert.equal(h.document.body.classList.contains('presentation-dual'),false);
 h.advance(15001);await until(()=>h.focusAck.length===1);
 assert.equal(h.document.body.classList.contains('presentation-dual'),true);assert.equal(h.document.querySelector('#native-chat'),iframe);
 assert.equal(h.focusAck[0].view,'dual');assert.ok(h.focusAck[0].full_view_ms>=15000);assert.equal(h.focusAck[0].capture_active,true);
 assert.ok(h.calls.filter(x=>x.url.endsWith('/focus')).every(x=>x.options.headers['x-recording-token']==='fixture-token'));
 h.stop();await until(()=>h.document.body.dataset.recordingState==='COMPLETE');await h.window.happyDOM.close();
});
await test('manual layout selection cancels automatic switching instead of pulling the user back',async()=>{
 const h=setup();h.start();await until(()=>h.document.body.classList.contains('presentation-on'));await pause(20);
 h.advance(10000);h.document.querySelector('#presentation-dual').click();await pause(25);
 assert.equal(h.document.body.classList.contains('presentation-dual'),true);
 h.advance(30001);await pause(30);assert.equal(h.focusAck.length,0);assert.equal(h.window.demoRecording.getState().focus_canceled,true);
 h.stop();await until(()=>h.document.body.dataset.recordingState==='COMPLETE');await h.window.happyDOM.close();
});
await test('exiting while a focus response is pending cannot re-enter presentation or ACK; recording and native iframe remain intact',async()=>{
 const h=setup({holdFocus:true});const iframe=h.document.querySelector('#native-chat');
 h.document.querySelector('#enter-presentation').click();h.start();await until(()=>h.document.body.dataset.recordingState==='RECORDING');
 h.document.querySelector('#exit-presentation').click();assert.equal(h.document.body.classList.contains('presentation-on'),false);
 h.advance(30001);h.releaseFocus();await pause(30);
 assert.equal(h.document.body.classList.contains('presentation-on'),false);assert.equal(h.focusAck.length,0);
 assert.equal(h.recording.state,'recording');assert.equal(h.document.querySelector('#native-chat'),iframe);
 h.stop();await until(()=>h.document.body.dataset.recordingState==='COMPLETE');await h.window.happyDOM.close();
});
await test('canceling an unresolved browser chooser stops a late stream and never creates a server recording',async()=>{
 const h=setup({holdCapture:true});h.start();await until(()=>h.document.body.dataset.recordingState==='SELECTING');
 const cancel=h.document.querySelector('#demo-recording-stop');assert.equal(cancel.hidden,false);assert.match(cancel.textContent,/取消/);
 h.document.querySelector('#demo-exit-display').click();assert.equal(h.document.body.dataset.recordingState,'CANCELED');
 assert.equal(h.document.body.classList.contains('presentation-on'),false);
 h.releaseCapture();await until(()=>!h.window.demoRecording.getState().selection_pending);
 assert.equal(h.calls.length,0);assert.ok(h.stopped>=1);assert.equal(h.recording,undefined);
 assert.equal(h.document.querySelector('#demo-recording-start').disabled,false);await h.window.happyDOM.close();
});
await test('canceling after sharing but before the server reply aborts that server record without starting MediaRecorder',async()=>{
 const h=setup({holdStart:true});h.start();await until(()=>h.calls.some(x=>x.url.endsWith('/start')));
 h.stop();assert.equal(h.document.body.dataset.recordingState,'CANCELED');h.releaseStart();
 await until(()=>!h.window.demoRecording.getState().selection_pending);
 assert.equal(h.recording,undefined);assert.ok(h.stopped>=1);
 assert.ok(h.calls.some(x=>x.url.endsWith('/finish')&&JSON.parse(x.options.body).aborted));await h.window.happyDOM.close();
});
await test('exit applies immediately during animation, ignores stalled root transitions, and does not trap browser closing',async()=>{
 const h=setup({reduceMotion:false});h.document.querySelector('#enter-presentation').click();
 assert.equal(h.document.body.classList.contains('presentation-on'),true);
 h.document.querySelector('#exit-presentation').click();assert.equal(h.document.body.classList.contains('presentation-on'),false);
 assert.equal(h.transitions,0);await pause(420);assert.equal(h.document.body.classList.contains('presentation-on'),false);
 h.start();await until(()=>h.document.body.dataset.recordingState==='RECORDING');
 const closing=new h.window.Event('beforeunload',{cancelable:true});h.window.dispatchEvent(closing);
 assert.equal(closing.defaultPrevented,false);h.stop();await until(()=>h.document.body.dataset.recordingState==='COMPLETE');await h.window.happyDOM.close();
});
await test('stopping capture during opening cannot send a later focus ACK or restart capture',async()=>{
 const h=setup();h.start();await until(()=>h.document.body.classList.contains('presentation-on'));await pause(20);
 h.stop();await until(()=>h.document.body.dataset.recordingState==='COMPLETE');h.advance(30000);await pause(35);
 assert.equal(h.focusAck.length,0);assert.equal(h.captures,1);assert.equal(h.recording.state,'inactive');await h.window.happyDOM.close();
});
const report={kind:'ISOLATED_AUTO_FOCUS_BROWSER_TESTS_NO_REAL_CAPTURE',pass:true,tests};
await fs.writeFile('artifacts/demo-video-20261013/recording-focus-browser-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
