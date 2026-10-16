// Explicit browser recording of the real page. No robot actions or model calls.
const API='/api/demo-ui/recordings';
const $=selector=>document.querySelector(selector);
const supported=!!(navigator.mediaDevices?.getDisplayMedia&&window.MediaRecorder);
const wrap=document.createElement('div');wrap.id='demo-recording-controls';wrap.className='recording-controls';
wrap.innerHTML='<button type="button" id="demo-fullscreen" aria-pressed="false">全屏</button><span id="demo-fullscreen-hint" role="status" aria-live="polite"></span><button type="button" id="demo-recording-start">录制演示</button><button type="button" id="demo-recording-stop" hidden>停止录制</button><span id="demo-recording-state" role="status" aria-live="polite">准备录制</span><a id="demo-recording-result" hidden target="_blank" rel="noopener">查看原始视频 ↗</a>';
($('#presentation-controls')||$('.head-right')||document.body).append(wrap);
const style=document.createElement('style');style.textContent='.recording-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px}.recording-controls [hidden]{display:none!important}#demo-recording-state,#demo-fullscreen-hint{max-width:340px;color:#687481}#demo-fullscreen-hint:empty{display:none}body[data-recording-state="RECORDING"] #demo-recording-state{color:#ba352d}#demo-recording-stop{border-color:#d88982;color:#a82c23}';document.head.append(style);
const startButton=$('#demo-recording-start'),stopButton=$('#demo-recording-stop'),statusText=$('#demo-recording-state'),resultLink=$('#demo-recording-result');
let active=null;
let selecting=null;
let fullscreenPending=false;
const fullscreenButton=$('#demo-fullscreen'),fullscreenHint=$('#demo-fullscreen-hint');
const exitButton=document.createElement('button');exitButton.id='demo-exit-display';exitButton.type='button';exitButton.textContent='退出展示';exitButton.hidden=true;exitButton.title='退出演示或全屏；取消尚未开始的录制请求';
document.body.append(exitButton);
style.textContent+='#demo-exit-display{position:fixed;top:10px;right:12px;z-index:1000;background:#fff;box-shadow:0 2px 12px #0002;min-height:34px}#demo-exit-display[hidden]{display:none!important}';
function updateExitButton(){exitButton.hidden=!(document.fullscreenElement||document.body.classList.contains('presentation-on')||selecting);}
exitButton.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('demo-display-exit-request')));
window.addEventListener('demo-presentation-view-changed',updateExitButton);
window.addEventListener('demo-display-exited',()=>{cancelSelection();cancelAutomaticFocus();updateExitButton();});
const canFullscreen=()=>document.fullscreenEnabled===true&&typeof document.documentElement.requestFullscreen==='function'&&typeof document.exitFullscreen==='function';
function updateFullscreen(){
 const entered=!!document.fullscreenElement;
 fullscreenButton.textContent=entered?'退出全屏':'全屏';
 fullscreenButton.setAttribute('aria-pressed',String(entered));
 fullscreenButton.disabled=fullscreenPending||(!entered&&!canFullscreen());
 if(!entered&&!canFullscreen())fullscreenHint.textContent='当前浏览器不支持页面全屏，请在独立 Chrome / Edge 窗口打开同一地址。';
 else if(!fullscreenPending)fullscreenHint.textContent='';
}
fullscreenButton.addEventListener('click',async()=>{
 if(fullscreenPending)return;
 if(!document.fullscreenElement&&!canFullscreen()){updateFullscreen();return;}
 fullscreenPending=true;fullscreenButton.disabled=true;fullscreenHint.textContent='';
 let errorMessage='';
 try{
  // Only an explicit click enters/exits fullscreen; this never starts recording.
  if(document.fullscreenElement)await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
 }catch{errorMessage='未能进入全屏，请在独立 Chrome / Edge 窗口打开同一地址，或使用浏览器的全屏按钮。';}
 finally{fullscreenPending=false;updateFullscreen();if(errorMessage)fullscreenHint.textContent=errorMessage;}
});
document.addEventListener('fullscreenchange',()=>{
 updateFullscreen();updateExitButton();
 if(!document.fullscreenElement&&active)cancelAutomaticFocus();
});
updateFullscreen();
function announce(status,text,details={}){
 statusText.textContent=text;document.body.dataset.recordingState=status;
 window.dispatchEvent(new CustomEvent('demo-recording-state',{detail:{status,...details}}));
}
async function request(route,{method='GET',body,token,timeout=35000,binary=false}={}){
 const response=await fetch(API+route,{method,headers:{...(body!==undefined?{'content-type':binary?'application/octet-stream':'application/json'}:{}),...(token?{'x-recording-token':token}:{})},body:body===undefined?undefined:binary?body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(timeout)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'HTTP '+response.status);return result;
}

function recordingActive(run){return active===run&&!run.stopping&&!run.error&&run.recorder?.state==='recording';}
function cancelAutomaticFocus(){if(active){active.focusCanceled=true;clearTimeout(active.focusTimer);}}
window.addEventListener('demo-presentation-manual-change',cancelAutomaticFocus);
window.addEventListener('demo-presentation-view-changed',event=>{
 if(active&&(!event.detail?.active||event.detail?.view!=='full'))active.fullViewAt=undefined;
});
function requestRecordingLayout(run,view){
 return new Promise((resolve,reject)=>{
  const requestId=run.id+':layout:'+(run.layoutSequence=(run.layoutSequence||0)+1);
  const cleanup=()=>{clearTimeout(timeout);window.removeEventListener('demo-recording-layout-applied',done);};
  const done=event=>{const d=event.detail;if(d?.id!==run.id||d.request_id!==requestId)return;cleanup();d.applied===true&&d.view===view?resolve():reject(Error(d.canceled?'LAYOUT_CANCELED':'LAYOUT_NOT_APPLIED'));};
  const timeout=setTimeout(()=>{cleanup();reject(Error('LAYOUT_ACK_TIMEOUT'));},5000);
  window.addEventListener('demo-recording-layout-applied',done);
  window.dispatchEvent(new CustomEvent('demo-recording-layout-request',{detail:{id:run.id,request_id:requestId,view}}));
 });
}
async function advanceFocus(run){
 if(!recordingActive(run)||run.focusDone||run.focusCanceled)return;
 try{
  const intent=await request('/'+run.id+'/focus',{token:run.token,timeout:5000});
  if(!recordingActive(run)||run.focusCanceled||intent.id!==run.id)return;
  if(intent.status==='ACKNOWLEDGED'){run.focusDone=true;return;}
  if(!intent.run_id||!['WAITING','READY'].includes(intent.status))return;
  if(run.focusRunId&&run.focusRunId!==intent.run_id)throw Error('FOCUS_RUN_CHANGED');
  run.focusRunId=intent.run_id;
  if(run.fullViewAt===undefined){
   await requestRecordingLayout(run,'full');
   if(!recordingActive(run)||run.focusCanceled)return;
   run.fullViewAt=performance.now();
  }
  // Preserve an actual full-page opening, even when browser/network latency delayed binding.
  const fullViewMs=performance.now()-run.fullViewAt;
  if(intent.status!=='READY'||fullViewMs<15000)return;
  await requestRecordingLayout(run,'dual');
  if(!recordingActive(run)||run.focusCanceled)return;
  const acknowledgement=await request('/'+run.id+'/focus',{method:'POST',token:run.token,timeout:5000,
   body:{run_id:intent.run_id,recording_id:run.id,intent_token:intent.intent_token,view:'dual',
    layout_applied:true,capture_active:true,full_view_ms:fullViewMs}});
  if(recordingActive(run)&&acknowledgement.status==='ACKNOWLEDGED')run.focusDone=true;
 }catch(error){
  if(recordingActive(run)&&!run.focusCanceled)window.dispatchEvent(new CustomEvent('demo-recording-focus-state',{detail:{id:run.id,status:'RETRYING',error:error.message}}));
 }finally{
  if(recordingActive(run)&&!run.focusDone&&!run.focusCanceled)run.focusTimer=setTimeout(()=>void advanceFocus(run),1000);
 }
}

function release(run){clearInterval(run.timer);clearTimeout(run.limit);clearTimeout(run.focusTimer);run.stream?.getTracks().forEach(track=>track.stop());}
function cancelSelection(){
 const run=selecting;if(!run||run.canceled)return;
 run.canceled=true;release(run);stopButton.hidden=true;
 announce('CANCELED','录制请求已取消。若共享选择窗口仍打开，请按 Esc 关闭。');
 // getDisplayMedia has no abort API. Its eventual stream is immediately stopped below.
 updateExitButton();
}
function stop(){
 if(selecting){cancelSelection();return;}
 if(!active||active.stopping)return;active.stopping=true;stopButton.disabled=true;
 announce('SAVING','正在保存并验证真实录屏…',{id:active.id});
 if(active.recorder?.state!=='inactive')active.recorder.stop();else void finish(active);
}
async function finish(run){
 if(run.finishing)return;run.finishing=true;const duration=Math.round(performance.now()-run.started);
 release(run);
 try{
  await run.queue;if(run.error)throw run.error;
  const result=await request('/'+run.id+'/finish',{method:'POST',token:run.token,timeout:90000,body:{chunk_count:run.sequence,duration_ms:duration}});
  if(result.status!=='COMPLETE')throw Error(result.reason||'VIDEO_NOT_VALIDATED');
  resultLink.href=result.video_url;resultLink.hidden=false;
  announce('COMPLETE','原始录屏已保存至服务器，验证通过',{id:run.id,result});
 }catch(error){
  // A lost finish response must not relabel an already validated server recording as failed.
  const recovered=run.id?await request('/'+run.id+'/status').catch(()=>null):null;
  if(recovered?.status==='COMPLETE'){resultLink.href=recovered.video_url;resultLink.hidden=false;announce('COMPLETE','原始录屏已保存至服务器，验证通过',{id:run.id,result:recovered});return;}
  if(run.id)await request('/'+run.id+'/finish',{method:'POST',token:run.token,body:{aborted:true,reason:error.message}}).catch(()=>{});
  announce('FAILED','录制未完成：'+error.message+'；已接收的原始分片保留在服务器',{id:run.id,error:error.message});
 }finally{if(active===run)active=null;startButton.disabled=false;stopButton.hidden=true;stopButton.disabled=false;updateExitButton();}
}
// Never trap tab/window closing with beforeunload. Accepted raw chunks remain on the server.
window.addEventListener('pagehide',()=>{cancelSelection();if(active&&!active.stopping)stop();});
async function start(){
 if(active||selecting)return;
 if(!supported){announce('UNSUPPORTED','当前浏览器不支持网页录屏，请在 Chrome / Edge 打开同一地址。');return;}
 startButton.disabled=true;resultLink.hidden=true;stopButton.hidden=false;stopButton.disabled=false;stopButton.textContent='取消录制请求';announce('SELECTING','请选择当前项目标签页或专用窗口；录制上限 20 分钟 / 1 GiB。');
 let run={stream:null,queue:Promise.resolve(),sequence:0,pendingBytes:0,error:null,started:performance.now(),canceled:false};
 selecting=run;updateExitButton();
 try{
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(value=>MediaRecorder.isTypeSupported(value));if(!mime)throw Error('浏览器没有可用的 WebM 编码器');
  // This call stays in the explicit button gesture. The user chooses the capture surface.
  run.stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',monitorTypeSurfaces:'exclude',surfaceSwitching:'exclude'});
  if(run.canceled){release(run);return;}
  const videoTrack=run.stream.getVideoTracks()[0],surface=videoTrack?.getSettings().displaySurface||'unknown';
  if(surface==='monitor')throw Error('请选择项目标签页或专用窗口，不要选择整个桌面');
  const result=await request('/start',{method:'POST',body:{mime_type:mime,display_surface:surface}});
  Object.assign(run,{id:result.id,token:result.upload_token,started:performance.now()});
  if(run.canceled){release(run);await request('/'+run.id+'/finish',{method:'POST',token:run.token,body:{aborted:true,reason:'USER_CANCELED_BEFORE_RECORDING'}}).catch(()=>{});return;}
  selecting=null;stopButton.textContent='停止录制';updateExitButton();
  run.recorder=new MediaRecorder(run.stream,{mimeType:mime,videoBitsPerSecond:6000000});active=run;
  run.recorder.ondataavailable=event=>{
   if(!event.data.size||run.error)return;
   if(event.data.size>result.limits.chunkBytes){run.error=Error('CHUNK_TOO_LARGE');stop();return;}
   run.pendingBytes+=event.data.size;
   if(run.pendingBytes>64*1024*1024){run.error=Error('UPLOAD_TOO_SLOW');stop();return;}
   const sequence=run.sequence++;
   run.queue=run.queue.then(async()=>{
    if(run.error)return;
    try{await request('/'+run.id+'/chunk?seq='+sequence,{method:'POST',token:run.token,body:event.data,binary:true});}
    catch(error){run.error=error;stop();}
    finally{run.pendingBytes-=event.data.size;}
   });
  };
  run.recorder.onerror=event=>{run.error=Error(event.error?.message||'MEDIA_RECORDER_ERROR');stop();};
  run.recorder.onstop=()=>void finish(run);
  videoTrack.addEventListener('ended',stop,{once:true});
  run.recorder.start(1000);stopButton.hidden=false;
  run.timer=setInterval(()=>{if(!run.stopping){const seconds=Math.floor((performance.now()-run.started)/1000);announce('RECORDING','录制中 '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'),{id:run.id,seconds});}},1000);
  run.limit=setTimeout(stop,result.limits.maxSeconds*1000);
  announce('RECORDING','录制中 0:00',{id:run.id});
  void advanceFocus(run);
 }catch(error){
  release(run);if(run.id)await request('/'+run.id+'/finish',{method:'POST',token:run.token,body:{aborted:true,reason:error.message}}).catch(()=>{});
  if(active===run)active=null;startButton.disabled=false;stopButton.hidden=true;if(!run.canceled)announce('FAILED',error.name==='NotAllowedError'?'未开始录制：屏幕共享尚未授权。':'未开始录制：'+error.message);
 }finally{
  if(selecting===run)selecting=null;
  if(active!==run){startButton.disabled=false;stopButton.hidden=true;stopButton.disabled=false;stopButton.textContent='停止录制';}
  updateExitButton();
 }
}
startButton.addEventListener('click',start);stopButton.addEventListener('click',stop);
window.demoRecording={stop,getState:()=>({status:document.body.dataset.recordingState||'IDLE',id:active?.id||null,selection_pending:!!selecting,focus_canceled:active?.focusCanceled===true})};
if(!supported){startButton.disabled=true;announce('UNSUPPORTED','当前浏览器不支持网页录屏，请在 Chrome / Edge 打开同一地址。');}
else announce('IDLE','真实网页录制上限 20 分钟 / 1 GiB；复杂画面可能提前达到大小限制。');
