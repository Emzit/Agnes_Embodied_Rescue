const $=s=>document.querySelector(s);
if(new URLSearchParams(location.search).has('monitor'))document.body.classList.add('monitor-only');
let sceneBusy=false,mapEntries=[],sceneState=null,selectedMap=null,mapSelectionTouched=false;
let latest=null,sessionUrl=null,mapImage=null,mapWalls=null,mapHash=null,zoom=1,trail=[],lastSession=null,lastFrameAt=0,oldBlob=null,camBusy=false,camToken=0,camFrame=null,camAbort=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v?new Date(v).toLocaleTimeString('zh-CN',{hour12:false}):'—';
const base=n=>String(n||'').replace(/^mcp_robot_mcp_[^_]+_/,'').replace(/^mcp_robot_mcp_/,'');
// Presentation is a reversible layout choice; it never sends tasks or modifies native chat.
const presentationOriginalMonitorOnly=document.body.classList.contains('monitor-only');
let presentationMode=false,presentationView='full',presentationFallbackTimer=null,presentationRevision=0,automaticPresentationSuppressed=false;
async function setPresentation(active,view='full',{automatic=false}={}){
 const nextView=active&&view==='dual'?'dual':'full';
 if(!automatic){
  automaticPresentationSuppressed=true;
  window.dispatchEvent(new CustomEvent('demo-presentation-manual-change',{detail:{active,view:nextView}}));
 }
 if(automatic&&automaticPresentationSuppressed)return false;
 const revision=++presentationRevision;
 clearTimeout(presentationFallbackTimer);
 document.body.classList.remove('presentation-fallback','presentation-transition');
 // Layout changes take effect immediately. Root ViewTransition snapshots blocked exit clicks.
 presentationMode=active;presentationView=nextView;
 document.body.classList.toggle('monitor-only',!active&&presentationOriginalMonitorOnly);
 document.body.classList.toggle('presentation-on',active);
 document.body.classList.toggle('presentation-dual',nextView==='dual');
 $('#presentation-controls').hidden=!active;
 $('#enter-presentation').setAttribute('aria-expanded',String(active));
 $('#presentation-full').setAttribute('aria-pressed',String(nextView==='full'));
 $('#presentation-dual').setAttribute('aria-pressed',String(nextView==='dual'));
 window.dispatchEvent(new CustomEvent('demo-presentation-view-changed',{detail:{active,view:nextView,automatic}}));
 const focusTarget=active?$(nextView==='dual'?'#presentation-dual':'#presentation-full'):$('#enter-presentation');
 focusTarget.focus({preventScroll:true});
 window.scrollTo({top:0,behavior:'instant'});
 if(active&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  document.body.classList.add('presentation-fallback');
  presentationFallbackTimer=setTimeout(()=>document.body.classList.remove('presentation-fallback'),400);
  await new Promise(resolve=>setTimeout(resolve,400));
 }
 return revision===presentationRevision&&presentationMode===active&&presentationView===nextView;
}
window.addEventListener('demo-recording-state',event=>{
 if(event.detail?.status==='SELECTING')automaticPresentationSuppressed=false;
});
window.addEventListener('demo-recording-layout-request',async event=>{
 const detail=event.detail,state=window.demoRecording?.getState();
 if(!detail||!['full','dual'].includes(detail.view)||state?.status!=='RECORDING'||state.id!==detail.id)return;
 const revision=presentationRevision;
 if(automaticPresentationSuppressed){
  window.dispatchEvent(new CustomEvent('demo-recording-layout-applied',{detail:{...detail,applied:false,canceled:true}}));return;
 }
 const changed=await setPresentation(true,detail.view,{automatic:true});
 await new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve)));
 const current=window.demoRecording?.getState();
 const applied=changed&&!automaticPresentationSuppressed&&presentationRevision===revision+1&&current?.status==='RECORDING'&&current.id===detail.id&&presentationMode&&presentationView===detail.view&&
  document.body.classList.contains('presentation-dual')===(detail.view==='dual');
 window.dispatchEvent(new CustomEvent('demo-recording-layout-applied',{detail:{...detail,applied,canceled:automaticPresentationSuppressed}}));
});
function exitPresentation(){
 void setPresentation(false);
 // Closing a display does not cancel native tool approvals or the robot's task.
 window.dispatchEvent(new CustomEvent('demo-display-exited'));
 if(document.fullscreenElement&&typeof document.exitFullscreen==='function')void document.exitFullscreen().catch(()=>{});
}
$('#enter-presentation').onclick=()=>setPresentation(true,'full');
$('#presentation-full').onclick=()=>setPresentation(true,'full');
$('#presentation-dual').onclick=()=>setPresentation(true,'dual');
$('#exit-presentation').onclick=exitPresentation;
window.addEventListener('demo-display-exit-request',exitPresentation);
document.addEventListener('keydown',event=>{
 // Escape always leaves this page's display; native Harness iframe keys stay inside its iframe.
 if(event.repeat||event.isComposing)return;
 if(event.key==='Escape'&&(presentationMode||document.fullscreenElement)){
  exitPresentation();return;
 }
 if(event.defaultPrevented||document.querySelector('dialog[open]'))return;
 const target=event.target;
 if(document.activeElement?.tagName==='IFRAME'||target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
 if(event.altKey&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&event.code==='KeyD'){
  event.preventDefault();setPresentation(true,presentationMode&&presentationView==='dual'?'full':'dual');
 }
});

const ctx=$('#live-map').getContext('2d');
function canvasSize(canvas){const r=canvas.getBoundingClientRect(),d=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);return {c,w:r.width,h:r.height};}
function viewBounds(data){const m=data?.ros?.map;if(!m)return {x:-3,y:-7,w:15,h:11};const o=m.origin,ls=data.registry?.locations||[],bs=ls.map(x=>x.bounds).filter(Boolean);if(bs.length){const x=Math.min(...bs.map(b=>b.min_x),data.ros?.pose?.x??0)-.35,y=Math.min(...bs.map(b=>b.min_y),data.ros?.pose?.y??0)-.35;return{x,y,w:Math.max(...bs.map(b=>b.max_x),data.ros?.pose?.x??0)+.35-x,h:Math.max(...bs.map(b=>b.max_y),data.ros?.pose?.y??0)+.35-y};}return{x:o.x,y:o.y,w:m.width*m.resolution,h:m.height*m.resolution};}
// Furniture is omitted only from the display; ROS occupancy stays untouched.
function alignedMapGeometry(){
 const g=mapDecoration?.geometry,m=latest?.ros?.map;
 if(!g||!m||mapDecoration.layoutId!==latest?.scenario?.layout_id)return null;
 const bound=g.boundary;if(!bound||Math.abs(bound.min_x-m.origin.x)>.01||Math.abs(bound.min_y-m.origin.y)>.01)return null;
 const liveRooms=(latest.registry?.locations||[]).filter(l=>l.type==='room'&&l.bounds);
 if(!liveRooms.length||!liveRooms.every(l=>{const room=(g.rooms||[]).find(r=>r.id===l.id);return room&&['min_x','max_x','min_y','max_y'].every(k=>Number.isFinite(room.bounds?.[k])&&Math.abs(room.bounds[k]-l.bounds[k])<.001);}))return null;
 return g;
}
function mapFurnitureBounds(){
 return (alignedMapGeometry()?.static_obstacles||[]).filter(o=>/^office_workstation_[1-6]$/.test(o.id)&&['min_x','max_x','min_y','max_y'].every(k=>Number.isFinite(o.bounds?.[k]))).map(o=>o.bounds);
}
function wallMask(img){
 const mask=document.createElement('canvas');mask.width=img.naturalWidth;mask.height=img.naturalHeight;
 const c=mask.getContext('2d');c.drawImage(img,0,0);
 const d=c.getImageData(0,0,mask.width,mask.height).data,path=new Path2D(),m=latest?.ros?.map;
 // Same inclusive rounded cell footprint as the map compiler, so table edges vanish too.
 const furniture=m?mapFurnitureBounds().map(b=>({x0:Math.round((b.min_x-m.origin.x)/m.resolution),x1:Math.round((b.max_x-m.origin.x)/m.resolution),y0:m.height-1-Math.round((b.max_y-m.origin.y)/m.resolution),y1:m.height-1-Math.round((b.min_y-m.origin.y)/m.resolution)})):[];
 // Contiguous occupied-cell runs form one solid outline, not shifted thin copies.
 for(let y=0;y<mask.height;y++){
  let start=-1;
  for(let x=0;x<=mask.width;x++){
   const i=(y*mask.width+x)*4,occupied=x<mask.width&&d[i]<128&&d[i+1]<128&&d[i+2]<128&&d[i+3]>0&&!furniture.some(b=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1);
   if(occupied&&start<0)start=x;
   if(!occupied&&start>=0){path.rect(start,y,x-start,1);start=-1;}
  }
 }
 return path;
}
// Map decoration uses only static registry geometry; dynamic markers remain ROS-backed.
let mapHoverHits=[],mapRoomKeySignature='',mapDecoration=null,mapDecorationPending=null;
const roomPalette=[
 {fill:'#dfefff',ink:'#407499'},
 {fill:'#dff4e8',ink:'#408564'},
 {fill:'#f0e3fa',ink:'#956aad'},
 {fill:'#ffedc9',ink:'#ab793c'},
];
const roomDisplayNames={Large_Room:'大房间',Right_Near_Room:'右后小室',Right_Middle_Room:'右中小室',Right_Front_Room:'右前小室',Room_A:'房间 A',Room_B:'房间 B',Room_C:'房间 C'};
function mapRooms(data){
 return (data?.registry?.locations||[]).filter(loc=>loc.type==='room'&&loc.bounds).map((loc,i)=>({
  loc,code:'R'+(i+1),name:roomDisplayNames[loc.id]||(/[\u3400-\u9fff]/.test(loc.name||'')?loc.name:'房间 '+(i+1)),...roomPalette[i%roomPalette.length],
 }));
}
function renderRoomKey(rooms){
 const key=$('#map-room-key');if(!key)return;
 const signature=JSON.stringify(rooms.map(r=>[r.loc.id,r.code,r.name,r.loc.name,r.fill,r.ink]));
 if(signature===mapRoomKeySignature)return;mapRoomKeySignature=signature;
 key.innerHTML=rooms.map(r=>'<span class="map-room-chip" tabindex="0" title="'+esc((r.loc.name||r.name)+' · '+r.loc.id)+'" aria-label="'+esc(r.code+' '+(r.loc.name||r.name))+'" style="--room-color:'+r.fill+';--room-ink:'+r.ink+'"><span class="map-room-code">'+r.code+'</span><span class="map-room-name">'+esc(r.name)+'</span></span>').join('');
}
function mapPill(c,x,y,w,h,fill){
 c.save();c.fillStyle=fill;c.strokeStyle='#ffffff';c.lineWidth=2;c.shadowColor='#596c8018';c.shadowBlur=5;c.shadowOffsetY=2;c.beginPath();c.roundRect(x-w/2,y-h/2,w,h,h/2);c.fill();c.stroke();c.restore();
}
function drawStartMarker(c,a){
 c.save();c.translate(a.x,a.y);c.shadowColor='#236b4733';c.shadowBlur=8;
 c.fillStyle='#fff';c.strokeStyle='#4c9270';c.lineWidth=2;c.beginPath();c.arc(0,0,13,0,Math.PI*2);c.fill();c.stroke();c.shadowBlur=0;
 c.strokeStyle='#38805a';c.lineWidth=1.8;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(-7,-1);c.lineTo(0,-7);c.lineTo(7,-1);c.moveTo(-5,-2);c.lineTo(-5,6);c.lineTo(5,6);c.lineTo(5,-2);c.moveTo(-1.7,6);c.lineTo(-1.7,1);c.lineTo(1.7,1);c.lineTo(1.7,6);c.stroke();c.restore();
}
function renderMap(){
 const {c,w,h}=canvasSize($('#live-map'));mapHoverHits=[];
 const background=c.createLinearGradient(0,0,w,h);background.addColorStop(0,'#fffaf0');background.addColorStop(1,'#edf6ef');c.fillStyle=background;c.fillRect(0,0,w,h);
 c.fillStyle='#dbe6db';for(let y=16;y<h;y+=24)for(let x=16;x<w;x+=24){c.beginPath();c.arc(x,y,.8,0,Math.PI*2);c.fill();}
 if(sceneBusy){const tooltip=$('#map-hover');if(tooltip)tooltip.hidden=true;c.fillStyle='#73777e';c.font='15px Inter,system-ui';c.textAlign='center';c.fillText('正在切换物理场景 · 等待新 ROS2 /map 与 TF',w/2,h/2);return;}
 if(!latest?.ros?.map)return;
 const b=viewBounds(latest),s=Math.min((w-42)/b.w,(h-46)/b.h)*zoom,cx=b.x+b.w/2,cy=b.y+b.h/2;
 const p=(x,y)=>({x:w/2+(x-cx)*s,y:(h-20)/2-(y-cy)*s});
 const m=latest.ros.map,o=m.origin,locations=latest.registry?.locations||[],rooms=mapRooms(latest);
 renderRoomKey(rooms);
 function drawOccupancy(){
  if(!mapImage)return;const top=p(o.x,o.y+m.height*m.resolution);c.save();c.translate(top.x,top.y);c.rotate(-o.yaw);
  if(mapWalls){
   // One mask from actual occupied cells remains the authoritative visible wall outline.
   const cell=m.resolution*s;c.scale(cell,cell);c.lineJoin='round';c.lineCap='round';
   c.fillStyle=c.strokeStyle='#52748b';c.lineWidth=Math.max(0,7/cell-1);c.shadowColor='#547a8b30';c.shadowBlur=4;c.shadowOffsetY=3;
   if(c.lineWidth>0)c.stroke(mapWalls);c.fill(mapWalls);
   c.shadowBlur=0;c.shadowOffsetY=0;c.fillStyle=c.strokeStyle='#a9cbd7';c.lineWidth=Math.max(0,3/cell-1);
   if(c.lineWidth>0)c.stroke(mapWalls);c.fill(mapWalls);
  }
  c.restore();
 }
 const floor=alignedMapGeometry()?.boundary;
 if(floor){const a=p(floor.min_x,floor.max_y);c.save();c.fillStyle='#fffdf7';c.shadowColor='#728e7c28';c.shadowBlur=12;c.shadowOffsetY=6;c.beginPath();c.roundRect(a.x,a.y,(floor.max_x-floor.min_x)*s,(floor.max_y-floor.min_y)*s,12);c.fill();c.restore();}
 for(const loc of locations){
  if(!loc.bounds||!['room','corridor'].includes(loc.type))continue;
  const a=p(loc.bounds.min_x,loc.bounds.max_y),rw=(loc.bounds.max_x-loc.bounds.min_x)*s,rh=(loc.bounds.max_y-loc.bounds.min_y)*s,room=rooms.find(r=>r.loc.id===loc.id),inset=Math.min(3,rw/8,rh/8);
  c.fillStyle=room?.fill||'#fffdf7';c.beginPath();c.roundRect(a.x+inset,a.y+inset,rw-2*inset,rh-2*inset,Math.min(10,rw/6,rh/6));c.fill();
  if(room){c.save();c.strokeStyle='#ffffff99';c.lineWidth=2;c.beginPath();c.moveTo(a.x+inset+7,a.y+inset+5);c.lineTo(a.x+rw-inset-7,a.y+inset+5);c.stroke();c.restore();}
  if(room)mapHoverHits.push({x:a.x,y:a.y,w:rw,h:rh,label:room.code+' · '+(loc.name||room.name)});
 }
 drawOccupancy();
 const activeNavigation=latest.ros.navigation?.status==='ACTIVE';
 const call=(latest.session?.events||[]).findLast(e=>e.type==='tool_call'&&base(e.tool)==='navigate_to'),target=activeNavigation?locations.find(l=>l.id===call?.args?.location&&l.pose):null;
 const targetPoint=target?p(target.pose.x,target.pose.y):null;
 if(activeNavigation&&latest.ros.plan_received_at&&Date.now()-latest.ros.plan_received_at*1000<3000&&Array.isArray(latest.ros.plan)){
  c.setLineDash([5,5]);c.strokeStyle='#6e96c5';c.lineWidth=2;c.lineCap='round';c.beginPath();latest.ros.plan.forEach((v,i)=>{const a=p(v.x,v.y);i?c.lineTo(a.x,a.y):c.moveTo(a.x,a.y)});c.stroke();c.setLineDash([]);
 }
 const robot=latest.ros.pose_fresh&&latest.ros.pose?p(latest.ros.pose.x,latest.ros.pose.y):null;
 for(const room of rooms){
  const rb=room.loc.bounds,a=p((rb.min_x+rb.max_x)/2,(rb.min_y+rb.max_y)/2),available=(rb.max_x-rb.min_x)*s-14;
  if(available<20||robot&&Math.hypot(a.x-robot.x,a.y-robot.y)<27||targetPoint&&Math.hypot(a.x-targetPoint.x,a.y-targetPoint.y)<27)continue;
  const full=available>=48,width=full?48:28;mapPill(c,a.x,a.y,width,26,'#ffffffdf');
  c.strokeStyle=room.ink;c.lineWidth=1.4;c.lineJoin='round';
  if(full){c.beginPath();c.rect(a.x-16,a.y-6,9,12);c.moveTo(a.x-13,a.y+6);c.lineTo(a.x-13,a.y-3);c.lineTo(a.x-8,a.y-4);c.stroke();c.beginPath();c.arc(a.x-10,a.y+1,.8,0,Math.PI*2);c.fillStyle=room.ink;c.fill();}
  c.fillStyle=room.ink;c.font='600 11px Inter,system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(room.code,a.x+(full?8:0),a.y+.5);c.textBaseline='alphabetic';
 }
 const start=locations.find(loc=>loc.id==='Start'&&loc.pose)||locations.find(loc=>loc.type==='start'&&loc.pose);
 if(start){const a=p(start.pose.x,start.pose.y);drawStartMarker(c,a);mapHoverHits.push({x:a.x-16,y:a.y-16,w:32,h:32,label:'起点 · '+(start.name||start.id)});}
 if(targetPoint){
  c.strokeStyle='#5a83bb';c.fillStyle='#eef4ff';c.lineWidth=2;c.beginPath();c.arc(targetPoint.x,targetPoint.y,12,0,Math.PI*2);c.fill();c.stroke();c.beginPath();c.arc(targetPoint.x,targetPoint.y,4,0,Math.PI*2);c.fillStyle='#5a83bb';c.fill();
  mapHoverHits.push({x:targetPoint.x-14,y:targetPoint.y-14,w:28,h:28,label:'导航目标 · '+(target.name||target.id)});
 }
 if(robot){
  c.strokeStyle='#F4772D';c.lineWidth=2.5;c.lineCap='round';c.lineJoin='round';c.beginPath();trail.forEach((v,i)=>{const a=p(v.x,v.y);i?c.lineTo(a.x,a.y):c.moveTo(a.x,a.y)});c.stroke();
  const pose=latest.ros.pose;c.save();c.translate(robot.x,robot.y);c.rotate(-pose.yaw);c.shadowColor='#f4772d44';c.shadowBlur=9;
  c.fillStyle='#fffdf0';c.beginPath();c.arc(0,0,17,0,Math.PI*2);c.fill();c.shadowBlur=0;
   c.fillStyle='#F4772D';c.strokeStyle='#fff';c.lineWidth=2.5;c.lineJoin='round';c.beginPath();c.moveTo(15,0);c.lineTo(-10,-8);c.lineTo(-6.5,0);c.lineTo(-10,8);c.closePath();c.fill();c.stroke();c.restore();
  mapHoverHits.push({x:robot.x-17,y:robot.y-17,w:34,h:34,label:'机器人 · 实时位置'});
 }
 const scale=Math.max(1,Math.round(50/s));c.fillStyle='#5c6d7d';c.fillRect(14,h-18,scale*s,2);c.fillRect(14,h-22,1,6);c.fillRect(14+scale*s,h-22,1,6);c.textAlign='left';c.font='10px Inter,system-ui';c.fillText(scale+' m',14,h-27);
}
async function loadMapDecoration(runtime){
 const active=runtime?.active,id=active?.map_id,layoutId=active?.layout_id,key=id+' / '+layoutId;
 if(!id||!layoutId||sceneBusy||mapDecoration?.layoutId===layoutId||mapDecorationPending===key)return;
 mapDecorationPending=key;
 try{
  const data=await mapRequest('/api/demo-ui/maps/'+encodeURIComponent(id));
  if(sceneState?.active?.layout_id!==layoutId||sceneBusy)return;
  mapDecoration={layoutId,geometry:data.geometry};
  if(mapImage)mapWalls=wallMask(mapImage);
  renderMap();
 }catch{ /* Keep the original occupancy display if static furniture data is unavailable. */ }
 finally{if(mapDecorationPending===key)mapDecorationPending=null;}
}
$('#live-map').addEventListener('pointermove',event=>{
 const tooltip=$('#map-hover');if(!tooltip)return;
 const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,hit=mapHoverHits.findLast(v=>x>=v.x&&x<=v.x+v.w&&y>=v.y&&y<=v.y+v.h);
 tooltip.hidden=!hit;if(hit)tooltip.textContent=hit.label;
});
$('#live-map').addEventListener('pointerleave',()=>{const tooltip=$('#map-hover');if(tooltip)tooltip.hidden=true;});
function render(data){
 latest=data;document.body.classList.remove('offline');
 const native=data.native,session=data.session,ros=data.ros,ready=native?.daemon_ready&&native?.observer_fresh&&native?.robot_mcp?.state==='ready'&&native?.robot_mcp?.tools?.length===8&&native?.plugin?.actual==='running'&&ros?.pose_fresh;
 $('#system-ready').textContent=ready?'组件 READY':'组件 DEGRADED';$('#system-ready').className='pill'+(ready?' live':'');
 if(native?.web_url&&native.web_url!==sessionUrl){sessionUrl=native.web_url;$('#native-chat').src=sessionUrl;$('#open-native').href=sessionUrl;$('#trace-link').href=sessionUrl;$('#session-id').textContent='Session '+native.session_id;}
 updateChatConnection();
 $('#last-sync').textContent='同步 '+time(data.server_time)+' · ROS_DOMAIN_ID=106';
 $('#map-status').textContent=ros?.pose_fresh?'LIVE':'无实时位姿';$('#map-status').className='pill'+(ros?.pose_fresh?' live':'');
 $('#map-warning').hidden=!!ros?.pose_fresh;$('#map-warning').textContent='无实时位姿 · 仅显示静态 /map 先验';
 const p=ros?.pose_fresh?ros.pose:null;
 $('#pose-value').textContent=p?p.x.toFixed(3)+' / '+p.y.toFixed(3):'无实时位姿';
 $('#nav-value').textContent=(p?(p.yaw*180/Math.PI).toFixed(1)+'° · ':'')+(ros?.fresh?ros.navigation.status:'UNKNOWN');
 const goal=(session?.events||[]).findLast(e=>e.type==='tool_call'&&base(e.tool)==='navigate_to');
 $('#goal-value').textContent=session?.status==='RUNNING'?(goal?.args?.location||'尚无导航目标'):'暂无活动目标';
 $('#map-source').textContent=(mapFurnitureBounds().length?'骨架示意 · 桌子已隐藏 · 实时：map → base_link':'静态先验：ROS2 /map · 实时：map → base_link')+(ros?.pose_fresh?' · TF age '+Math.round(ros.pose_age_ms)+' ms':' · TF 不可用')+' · seed '+(data.scenario?.seed??'—');
 if(session?.session_id!==lastSession){trail=[];lastSession=session?.session_id;}
 if(p){const prev=trail.at(-1);if(!prev||Math.hypot(p.x-prev.x,p.y-prev.y)>.015)trail.push({...p});if(trail.length>800)trail.shift();}
 if(ros?.map?.sha256&&ros.map.sha256!==mapHash){mapHash=ros.map.sha256;const img=new Image();img.onload=()=>{mapImage=img;mapWalls=wallMask(img);renderMap();};img.onerror=()=>{mapImage=null;mapWalls=null;mapHash=null;};img.src='/api/demo-ui/map.png?hash='+encodeURIComponent(mapHash);}
 renderMap();
 const fresh=native?.observer_fresh, status=fresh?(session?.status||'IDLE'):'UNKNOWN';
 $('#mission-state').textContent=status;$('#mission-stage').textContent=fresh?(session?.outcome?.reasons?.includes('READONLY_ROBOT_STATE_NOT_OBSERVED')?'缺少本轮真实 Robot MCP 证据':session?.stage||'等待原生聊天任务'):'Session 事件流已失联';
 $('#mission-task').textContent=session?.task||'在左侧输入“现在机器人在哪里？”开始只读检查。';$('#mission-task').title=session?.task||'';
 $('#progress-track').className='progress-track'+(['RUNNING','QUEUED'].includes(status)?' running':['SUCCEEDED','PARTIAL','FAILED','CANCELED'].includes(status)?' terminal'+(status==='SUCCEEDED'?' succeeded':''):'');
 const prior=data.previous_mission;$('#previous-mission').textContent=prior?.mission_id?'HISTORICAL · '+prior.mission_id+' / '+prior.status+' · 不是本次任务结果':'无历史任务';
 if($('#evidence-dialog').open)renderEvidence();
 if(sceneBusy){$('#map-status').textContent='切换中 · 非 LIVE';$('#map-warning').hidden=false;$('#map-warning').textContent='正在重建场景，不将旧地图标为实时';$('#pose-value').textContent='切换中';$('#nav-value').textContent='等待新场景';$('#system-ready').textContent='场景切换中';}
 updateSwitchButton();
 if(!data.camera?.live||sceneBusy)noCamera(sceneBusy?'物理场景切换中 · 等待新 Camera 帧':'最新 Camera 帧已缺失或过期');
}
function noCamera(reason){lastFrameAt=0;camFrame=null;if(camAbort)camAbort.abort();$('#camera-image').hidden=true;$('#camera-empty').hidden=false;$('#camera-empty p').textContent=reason;$('#camera-status').textContent='无实时画面';$('#camera-status').className='pill';$('#camera-time').textContent='最新帧时间 —';}
async function poll(){try{const r=await fetch('/api/demo-ui/state',{cache:'no-store',signal:AbortSignal.timeout(3500)});if(!r.ok)throw Error('HTTP '+r.status);render(await r.json());}catch(e){document.body.classList.add('offline');$('#system-ready').textContent='连接中断';$('#last-sync').textContent='网络断开 · 监控自动重连';$('#map-status').textContent='无实时位姿';$('#map-warning').hidden=false;$('#map-warning').textContent='连接中断 · 仅显示静态地图';$('#pose-value').textContent='无实时位姿';$('#nav-value').textContent='UNKNOWN';$('#mission-state').textContent='UNKNOWN';$('#progress-track').className='progress-track';if(latest?.ros)latest.ros.pose_fresh=false;renderMap();noCamera('网络断开 · 无实时画面');}finally{setTimeout(poll,600);}}
async function camera(){
 if(sceneBusy||document.hidden){if(sceneBusy)noCamera('物理场景切换中 · 等待新 Camera 帧');setTimeout(camera,250);return;}
 if(camBusy)return;camBusy=true;const token=++camToken,start=performance.now();let failed=false;
 camAbort=new AbortController();
 const timeout=setTimeout(()=>camAbort?.abort(),2300);
 try{
  // One outstanding request waits for the next sensor frame; no old-frame queue.
  const r=await fetch('/api/demo-ui/camera.jpg'+(camFrame?'?after='+encodeURIComponent(camFrame):''),{cache:'no-store',signal:camAbort.signal});
  if(r.status===204)return;
  if(!r.ok||!/^image\/(?:jpeg|png)(?:;|$)/i.test(r.headers.get('content-type')||''))throw Error('NO_LIVE_FRAME');
  const captured=r.headers.get('x-captured-at'),at=Date.parse(captured),frame=r.headers.get('x-frame-id');
  const servedAt=Number(r.headers.get('x-server-time')),receivedAt=performance.now();
  // Freshness uses server age + local elapsed time, independent of clock skew.
  const frameAge=servedAt-at;
  const age=()=>frameAge+performance.now()-receivedAt;
  const blob=await r.blob();
  if(!Number.isFinite(at)||!Number.isFinite(frameAge)||frameAge<0||age()>2500)throw Error('STALE_FRAME');
  if(frame===camFrame)return;
  const url=URL.createObjectURL(blob),decoded=new Image();
  try{
   decoded.src=url;await decoded.decode();
   if(sceneBusy||document.hidden||token!==camToken||age()>2500){URL.revokeObjectURL(url);return;}
   const img=$('#camera-image'),previous=oldBlob;
   img.src=url;oldBlob=url;if(previous)URL.revokeObjectURL(previous);
   camFrame=frame;lastFrameAt=Date.now()-age();
   img.hidden=false;$('#camera-empty').hidden=true;
   $('#camera-status').textContent='LIVE';$('#camera-status').className='pill live';
   $('#camera-time').textContent='最新帧 '+time(captured)+' · '+Math.round(age())+' ms';$('#camera-frame').textContent=frame;
  }catch(e){URL.revokeObjectURL(url);throw e;}
 }catch(e){failed=true;if(!lastFrameAt||Date.now()-lastFrameAt>2500)noCamera('当前未收到新鲜 Camera 帧 · 自动重试');}
 finally{
  clearTimeout(timeout);camAbort=null;camBusy=false;
  // Cap display requests at 30 FPS; decoding finishes before the next request.
  setTimeout(camera,failed?250:Math.max(0,1000/30-(performance.now()-start)));
 }
}
function renderEvidence(){
 const s=latest?.session;$('#evidence-id').textContent='Session '+(s?.session_id||'—')+' · Mission '+(s?.mission_id||'—')+' · Turn '+(s?.prompt_turn_id||'—');
 $('#evidence-report').textContent=(s?.report||'尚无真实最终报告')+'\n\n'+(s?.outcome?JSON.stringify({status:s.outcome.status,reasons:s.outcome.reasons},null,2):'任务尚未终结；没有可信完成百分比。');
 $('#evidence-events').innerHTML=(s?.events||[]).slice(-24).reverse().map(e=>'<div class="event-row"><b>'+esc(e.tool)+'</b><small>'+esc(e.type)+' · '+time(e.timestamp)+' · seq '+e.sequence+'</small><details><summary>'+esc(e.result?.status||e.result?.navigation_status||e.type)+'</summary><pre>'+esc(JSON.stringify(e.result??e.args,null,2))+'</pre></details></div>').join('');
}
// Same-origin native document is observed, never rewritten or imitated.
function updateChatConnection(){
 const native=latest?.native;
 let doc=null,loaded=false,disconnected=false;
 try{doc=$('#native-chat').contentDocument;loaded=!!doc?.querySelector('textarea');disconnected=!!doc?.querySelector('#reconnect-notice')&&!doc.querySelector('#reconnect-notice').hidden&&doc.querySelector('textarea')?.disabled===true;}catch{}
 $('#frame-wait').hidden=loaded;
 const recovery=$('#chat-recovery');
 recovery.hidden=!disconnected;
 if(disconnected){
  let port=null;try{port=new URL(native?.ws_url).port;}catch{}
  recovery.textContent=port&&/^\d+$/.test(port)?'原生聊天未连接。页面和监控可用不代表聊天已连接。请在 Windows PowerShell 保持以下转发运行：ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:'+port+':127.0.0.1:'+port+' guoyu@192.168.97.11；然后点击原生 Retry connection 或“演示会话”。':'原生聊天未连接；请检查 WebSocket 转发，再点击 Retry connection。';
  $('#chat-connection').textContent='聊天断连 · 原生输入已禁用';
  $('#system-ready').textContent='组件 DEGRADED · 聊天断连';
 }else{
  $('#chat-connection').textContent=native?.observer_fresh?(loaded?'原生聊天已载入 · ':'原生 Session 已绑定 · ')+'Robot MCP '+(native.robot_mcp?.tools?.length??'—')+' 工具':'会话监控断开 · 请检查连接';
 }
}
setInterval(updateChatConnection,500);
$('#restore-session').onclick=()=>{if(sessionUrl)$('#native-chat').src=sessionUrl;};
$('#zoom-in').onclick=()=>{zoom=Math.min(3,zoom*1.2);renderMap();};$('#zoom-out').onclick=()=>{zoom=Math.max(.5,zoom/1.2);renderMap();};$('#zoom-reset').onclick=()=>{zoom=1;renderMap();};
new ResizeObserver(renderMap).observe($('.map-wrap'));
$('#open-import').onclick=()=>{$('#import-dialog').showModal();loadMapCatalog();};
$('#choose-map').onclick=$('#open-import').onclick;$('#close-import').onclick=()=>$('#import-dialog').close();
$('#show-evidence').onclick=()=>{renderEvidence();$('#evidence-dialog').showModal();};$('#close-evidence').onclick=()=>$('#evidence-dialog').close();
function previewGeometry(g){
 const canvas=$('#import-map');canvas.hidden=false;const {c,w,h}=canvasSize(canvas),b=g.boundary,s=Math.min((w-40)/(b.max_x-b.min_x),(h-40)/(b.max_y-b.min_y)),cx=(b.min_x+b.max_x)/2,cy=(b.min_y+b.max_y)/2,p=(x,y)=>({x:w/2+(x-cx)*s,y:h/2-(y-cy)*s});
 c.fillStyle='#f8f9fa';c.fillRect(0,0,w,h);
 const areas=[...(g.rooms||[]),...(g.corridors||[])];
 for(const r of areas){const a=p(r.bounds.min_x,r.bounds.max_y);c.fillStyle=/^[ABC]_Site$/.test(r.id)?'#fff0e5':'#e8eaec';c.fillRect(a.x,a.y,(r.bounds.max_x-r.bounds.min_x)*s,(r.bounds.max_y-r.bounds.min_y)*s);}
 c.strokeStyle='#1C1F23';for(const wall of g.walls||[]){const a=p(...wall.a),b=p(...wall.b);c.lineWidth=Math.max(6,wall.thickness*s);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
 c.fillStyle='#F4772D';for(const start of g.start_poses||[]){const a=p(start.x,start.y);c.beginPath();c.arc(a.x,a.y,5,0,Math.PI*2);c.fill();}
 c.fillStyle='#F4772D';for(const door of g.doors||[]){const a=p(...door.at);c.beginPath();c.arc(a.x,a.y,4,0,Math.PI*2);c.fill();}
 c.textAlign='center';c.textBaseline='middle';c.fillStyle='#1C1F23';
 for(const r of areas){
  const b=r.bounds,a=p((b.min_x+b.max_x)/2,(b.min_y+b.max_y)/2),label=r.name||r.id,width=Math.max(12,(b.max_x-b.min_x)*s-8);
  c.font='12px Inter,"Noto Sans SC",system-ui';const size=Math.min(12,Math.max(9,12*width/c.measureText(label).width));c.font=size+'px Inter,"Noto Sans SC",system-ui';c.fillText(label,a.x,a.y,width);
 }
}
async function mapRequest(url,options={}){
 const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(7000),...options}),data=await r.json();
 if(!r.ok)throw Error(data.message||data.error||'HTTP '+r.status);return data;
}
function selectionChanged(){
 const id=$('#map-select').value;selectedMap=mapEntries.find(x=>x.id===id);
 $('#selected-description').textContent=selectedMap?.description||'';
 $('#confirm-scene').checked=false;updateSwitchButton();
  if(selectedMap)previewSelected();
}
function updateSwitchButton(){
 const safe=latest?.native?.observer_fresh&&['IDLE','SUCCEEDED','PARTIAL','FAILED','CANCELED','COMPLETED'].includes(latest?.session?.status)&&latest?.ros?.pose_fresh&&latest?.ros?.navigation?.status==='IDLE'&&!latest?.ros?.navigation?.motion_lease?.held;
 $('#activate-map').disabled=sceneBusy||!safe||!selectedMap||!$('#confirm-scene').checked||selectedMap.id===sceneState?.active?.map_id;
 $('#map-select').disabled=sceneBusy;
}
async function loadMapCatalog(preferred=null){
 try{
  const data=await mapRequest('/api/demo-ui/maps');mapEntries=data.entries;
  if(preferred)mapSelectionTouched=true;
  const id=preferred||$('#map-select').value||sceneState?.active?.map_id||'classic';
  $('#map-select').replaceChildren(...mapEntries.map(entry=>{const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;return option;}));
  $('#map-select').value=mapEntries.some(x=>x.id===id)?id:'classic';selectionChanged();
 }catch(e){$('#import-result').textContent='地图列表不可用：'+e.message;}
}
async function previewSelected(){
 const id=$('#map-select').value;
 $('#import-map').hidden=true;$('#import-result').textContent='正在载入所选地图骨架…';
 try{
  const data=await mapRequest('/api/demo-ui/maps/'+encodeURIComponent(id));
  if($('#map-select').value!==id)return;
  $('#import-data').textContent=JSON.stringify(data,null,2);
  if(data.geometry){previewGeometry(data.geometry);$('#import-result').textContent=data.name+' · 静态骨架预览（未切换物理场景）';}
  else{$('#import-map').hidden=true;$('#import-result').textContent='经典地图沿用现有救援拓扑；当前活动场景的真实 ROS2 地图显示在右侧。';}
 }catch(e){if($('#map-select').value===id)$('#import-result').textContent='骨架预览失败：'+e.message;}
}
async function pollScene(){
 try{
  const runtime=await mapRequest('/api/demo-ui/maps/runtime');sceneState=runtime;
  if(!mapSelectionTouched&&runtime.active?.map_id&&mapEntries.length){$('#map-select').value=runtime.active.map_id;selectionChanged();}
  const job=runtime.job;sceneBusy=['RUNNING','INTERRUPTED'].includes(job?.status);
  await loadMapDecoration(runtime);
  $('#scene-chat-block').hidden=!sceneBusy;
  $('#active-map-name').textContent=sceneBusy?'切换中':runtime.active?.map_name||'未登记场景';
  $('#scene-switch-status').textContent=job?.status==='RUNNING'?job.phase:job?.status==='INTERRUPTED'?job.phase:job?.status==='FAILED'?'切换失败：'+job.error+' · 恢复：'+job.rollback:'当前物理场景：'+(runtime.active?.map_name||'未登记')+' · seed '+(runtime.active?.seed??'—')+(job?.status==='SUCCEEDED'?' · 已真实切换':'');
  $('#scene-progress').className='progress-track'+(job?.status==='RUNNING'?' running':job?.status==='SUCCEEDED'?' terminal succeeded':'');
  updateSwitchButton();
 }catch(e){$('#scene-switch-status').textContent='场景状态连接中断；不会自动重发切换请求';}
 finally{setTimeout(pollScene,1200);}
}
$('#map-select').onchange=()=>{mapSelectionTouched=true;selectionChanged();};
$('#confirm-scene').onchange=updateSwitchButton;
$('#preview-selected').onclick=previewSelected;
$('#activate-map').onclick=async()=>{
 if($('#activate-map').disabled||!selectedMap)return;
 const id=selectedMap.id,request_id=crypto.randomUUID();
 sceneBusy=true;updateSwitchButton();$('#scene-chat-block').hidden=false;
 $('#scene-switch-status').textContent='已提交安全检查；等待真实切换状态…';
 try{await mapRequest('/api/demo-ui/maps/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,request_id})});$('#confirm-scene').checked=false;}
 catch(e){$('#scene-switch-status').textContent='请求未确认：'+e.message+'。请等待状态刷新，不要重复点击。';}
};
$('#upload-skeleton').onclick=async()=>{
 const file=$('#skeleton-file').files[0],button=$('#upload-skeleton'),name=$('#skeleton-name').value.normalize('NFKC').trim();
 if(!name||[...name].length>40){$('#import-result').textContent='请先填写地图名称（1–40 字）。';return;}
 if(mapEntries.some(x=>x.name.toLocaleLowerCase('zh-CN')===name.toLocaleLowerCase('zh-CN'))){$('#import-result').textContent='这个地图名称已存在，请使用其他名称。';return;}
 if(!file){$('#import-result').textContent='请选择 JSON 文件。';return;}if(file.size>2*1024*1024){$('#import-result').textContent='文件不能超过 2 MiB。';return;}
 button.disabled=true;$('#import-result').textContent='上传并解析静态骨架中…';
 try{
  const content=await file.text();JSON.parse(content);
  const r=await fetch('/api/map/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:file.name,content}),signal:AbortSignal.timeout(65000)});
  const data=await r.json();$('#import-data').textContent=JSON.stringify(data,null,2);
  if(!r.ok||!data.validation?.pass)throw Error(data.message||data.validation?.errors?.join('\n')||'骨架校验失败');
  const entry=await mapRequest('/api/demo-ui/maps',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,upload_id:data.upload_id})});
  await loadMapCatalog(entry.id);previewGeometry(data.preview.geometry);
  $('#import-result').textContent=entry.name+' · 已保存 / STATIC PREVIEW / NOT_ACTIVATED。勾选确认并点击“确认切换物理场景”后才改变 Gazebo。';
 }catch(e){$('#import-result').textContent='上传/保存失败：'+e.message;$('#import-map').hidden=true;}finally{button.disabled=false;}
};
setInterval(()=>{if(lastFrameAt&&Date.now()-lastFrameAt>2500)noCamera('Camera 最新帧已过期 · 无实时画面');},300);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(lastFrameAt&&Date.now()-lastFrameAt>2500)noCamera('等待恢复新鲜帧');}});
loadMapCatalog();pollScene();poll();camera();
