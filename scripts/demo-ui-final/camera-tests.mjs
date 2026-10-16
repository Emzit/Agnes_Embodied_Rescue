import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import {Window} from '../../third_party/agnes-harness/node_modules/.pnpm/happy-dom@20.14.3/node_modules/happy-dom/lib/index.js';
import {nextCameraFrame} from '../../demo/final-dashboard/demo-ui-server.mjs';
const tests=[];
const test=async(name,fn)=>{await fn();tests.push({name,status:'PASS'});};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function response(){
 const res=new EventEmitter();res.headers={};
 res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;};
 res.end=bytes=>{res.bytes=bytes;res.ended=true;res.emit('close');};
 return res;
}
let stamp=Date.now(),meta={real_sensor:true,captured_at:new Date(stamp).toISOString(),frame_id:'live-run-1',image_file:'live-run-1.png',timestamp:{sec:1,nanosec:0}},reads=0;
const opts={readMeta:()=>meta,readFrame:name=>{reads++;assert.equal(name,meta.image_file);return Buffer.from('frame:'+name);},pollMs:5,waitMs:30};
await test('same sensor frame waits, new frame uses immutable manifest and exact timestamp',async()=>{
 const req=new EventEmitter(),res=response();
 nextCameraFrame(req,res,'live-run-1',opts);
 assert.equal(res.ended,undefined);assert.equal(reads,0);
 meta={...meta,frame_id:'live-run-2',image_file:'live-run-2.png'};
 await wait(12);assert.equal(res.status,200);assert.equal(res.headers['X-Frame-Id'],meta.frame_id);assert.equal(res.headers['X-Captured-At'],meta.captured_at);assert.equal(res.bytes.toString(),'frame:live-run-2.png');
 assert.equal(res.listenerCount('close'),0);assert.equal(req.listenerCount('aborted'),0);
});
await test('unchanged fresh frame times out without sending a duplicate PNG',async()=>{
 const res=response(),before=reads;
 nextCameraFrame(new EventEmitter(),res,meta.frame_id,opts);
 await wait(40);assert.equal(res.status,204);assert.equal(reads,before);
});
await test('stale real frame is rejected instead of looping cached pixels',async()=>{
 const good=meta;meta={...good,captured_at:new Date(stamp-3000).toISOString()};
 const res=response();nextCameraFrame(new EventEmitter(),res,null,opts);
 assert.equal(res.status,503);meta=good;
});
await test('aborted request stops its timer and releases all listeners',async()=>{
 const req=new EventEmitter(),res=response(),before=reads;
 nextCameraFrame(req,res,meta.frame_id,opts);req.emit('aborted');
 meta={...meta,frame_id:'live-run-3',image_file:'live-run-3.png'};
 await wait(12);assert.equal(res.ended,undefined);assert.equal(reads,before);
 assert.equal(res.listenerCount('close'),0);assert.equal(req.listenerCount('aborted'),0);
});
await test('frame manifest cannot escape camera directory',async()=>{
 const good=meta;meta={...good,image_file:'../../secret.png'};
 const res=response();nextCameraFrame(new EventEmitter(),res,null,opts);assert.equal(res.status,503);meta=good;
});

await test('display endpoint serves same-frame JPEG while PNG endpoint stays lossless',async()=>{
 const good=meta;meta={...good,display_file:good.frame_id+'.jpg',display_mime_type:'image/jpeg'};
 let paths=[];
 const local={...opts,readFrame:name=>{paths.push(name);return Buffer.from(name);}};
 const jpeg=response();nextCameraFrame(new EventEmitter(),jpeg,null,{...local,preferDisplay:true});
 assert.equal(jpeg.status,200);assert.equal(jpeg.headers['content-type'],'image/jpeg');
 assert.equal(jpeg.headers['X-Frame-Id'],meta.frame_id);
 const png=response();nextCameraFrame(new EventEmitter(),png,null,local);
 assert.equal(png.status,200);assert.equal(png.headers['content-type'],'image/png');
 assert.deepEqual(paths,[meta.display_file,meta.image_file]);meta=good;
});
await test('display endpoint falls back to same-frame PNG without optional JPEG',async()=>{
 const res=response();nextCameraFrame(new EventEmitter(),res,null,{...opts,preferDisplay:true});
 assert.equal(res.status,200);assert.equal(res.headers['content-type'],'image/png');
});
await test('display path, frame identity and content type must agree before reading',async()=>{
 const good=meta;
 for(const extra of [
  {display_file:'../outside.jpg',display_mime_type:'image/jpeg'},
  {display_file:'live-older-1.jpg',display_mime_type:'image/jpeg'},
  {display_file:good.frame_id+'.jpg',display_mime_type:'image/png'}
 ]){
  meta={...good,...extra};const res=response(),before=reads;
  nextCameraFrame(new EventEmitter(),res,null,{...opts,preferDisplay:true});
  assert.equal(res.status,503);assert.equal(reads,before);
 }
 meta=good;
});

const window=new Window({url:'http://127.0.0.1:4177/demo'}),document=window.document;
document.write(fs.readFileSync('demo/final-dashboard/demo-ui.html','utf8'));
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{}});
let blobCount=0,revoked=[],decodeResolve,rejectDecode=false,timers=[];
class Image {
 set src(v){this.url=v;}
 decode(){return rejectDecode?Promise.reject(Error('decode failed')):new Promise(resolve=>{decodeResolve=resolve;});}
}
const blobURL={createObjectURL:()=> 'blob:'+ ++blobCount,revokeObjectURL:url=>revoked.push(url)};
let servedFrame='live-ui-1',servedMime='image/jpeg',lastFetch=null;
const context=vm.createContext({document,window,location:window.location,URL:blobURL,URLSearchParams,AbortSignal,AbortController,performance,Image,
 ResizeObserver:class{observe(){}},setInterval:()=>{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},console,
 fetch:async url=>{lastFetch=url;return ({ok:true,status:200,headers:new Map([['content-type',servedMime],['x-frame-id',servedFrame],['x-captured-at',new Date(Date.now()+60000).toISOString()],['x-server-time',String(Date.now()+60000)]]),blob:async()=>new Blob(['image'])});}});
const source=fs.readFileSync('demo/final-dashboard/demo-ui.js','utf8').replace(/loadMapCatalog\(\);pollScene\(\);poll\(\);camera\(\);\s*$/,'');
vm.runInContext(source.replace('loadMapCatalog();pollScene();poll();camera();',''),context);
await test('frame stays visible until decoded, even with 60-second server clock skew',async()=>{
 vm.runInContext("oldBlob='blob:previous';lastFrameAt=Date.now();camFrame='live-ui-0';",context);
 document.querySelector('#camera-image').src='blob:previous';document.querySelector('#camera-image').hidden=false;
 const pending=vm.runInContext('camera()',context);await wait(0);
 assert.equal(document.querySelector('#camera-image').getAttribute('src'),'blob:previous');
 assert.equal(vm.runInContext('camBusy',context),true);
 decodeResolve();await pending;
 assert.equal(lastFetch.startsWith('/api/demo-ui/camera.jpg'),true);
 assert.equal(document.querySelector('#camera-image').getAttribute('src'),'blob:1');
 assert.equal(revoked.includes('blob:previous'),true);
});
await test('failed decode retains last fresh frame and releases new blob',async()=>{
 servedMime='image/png';servedFrame='live-ui-2';rejectDecode=true;await vm.runInContext('camera()',context);
 assert.equal(document.querySelector('#camera-image').getAttribute('src'),'blob:1');
 assert.equal(document.querySelector('#camera-image').hidden,false);
 assert.equal(revoked.includes('blob:2'),true);
});
await test('late decode during scene switch cannot relabel old-world frame live',async()=>{
 rejectDecode=false;servedFrame='live-ui-3';
 const pending=vm.runInContext('camera()',context);await wait(0);
 vm.runInContext("sceneBusy=true;noCamera('scene switch');",context);
 decodeResolve();await pending;assert.equal(document.querySelector('#camera-image').hidden,true);
 assert.equal(revoked.includes('blob:3'),true);
});
await window.happyDOM.close();
const report={generated_at:new Date().toISOString(),kind:'ISOLATED_CAMERA_REGRESSION_TESTS',pass:true,tests};
fs.mkdirSync('artifacts/camera-display-20261012',{recursive:true});
fs.writeFileSync('artifacts/camera-display-20261012/camera-tests.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
