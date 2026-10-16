import {normalizeToolResult} from "../interactive/mission-evaluator.mts";
export const initialTask="请找到待救援人员。";
export const stages=[
 {id:"start",label:"起点环视",nav:[],scan:"Start"},
 {id:"near",label:"右侧近端房间",nav:["Right_Near_Door_interaction"],door:"Right_Near_Door"},
 {id:"middle_scan",label:"中部环视",nav:["Main_Corridor"],scan:"Main_Corridor"},
 {id:"middle",label:"右侧中部房间",nav:["Right_Middle_Door_interaction"],door:"Right_Middle_Door"},
 {id:"front",label:"右前方房间",nav:["Right_Front_Door_interaction","Right_Front_Room"],door:"Right_Front_Door"},
 {id:"confirm",label:"复核人员并停止",nav:[],scan:"Right_Front_Room"}
] as const;
export function baseTool(name:string){return String(name).replace(/^mcp_(?:robot_mcp|envdoor)_(?:[a-f0-9]{8}_)?/,"");}
export function normalized(v:any){return normalizeToolResult(v);}
const validHash=(v:any)=>typeof v==="string"&&/^[a-f0-9]{64}$/i.test(v);
export function frameTime(t:any):number|null{
 return Number.isInteger(t?.sec)&&t.sec>=0&&Number.isInteger(t?.nanosec)&&t.nanosec>=0&&t.nanosec<1e9?t.sec+t.nanosec/1e9:null;
}
const sameTime=(a:any,b:any)=>frameTime(a)!==null&&frameTime(a)===frameTime(b);
function sensed(d:any){
 return d?.source==="ros2_camera_perception"&&d.evidence?.provider==="agnes-ai"&&
 d.evidence?.model==="agnes-3.0-flash"&&d.evidence?.method==="vlm"&&validHash(d.evidence?.frame_sha256)&&
 sameTime(d.timestamp,d.evidence?.frame_timestamp)&&Number.isFinite(d.confidence)&&d.confidence>=0&&d.confidence<=1;
}
export function postOpenWorld(value:any){
 const r=normalized(value),v=r?.verification?.fresh_camera_observation;
 if(r?.status!=="SUCCEEDED"||r.code!=="DOOR_OPEN_VERIFIED"||r.runtime_state!=="OPEN"||
   r.command?.returncode!==0||r.command?.stop_returncode!==0||v?.status!=="SUCCEEDED"||
   v.source!=="ros2_real_sensors"||v.camera?.available!==true||v.perception_status!=="AVAILABLE"||
   !Array.isArray(v.semantic_objects))return null;
 const t=v.camera.frame_timestamp,h=v.camera.png_sha256,vision=v.vision_observation,pose=v.robot_pose;
 const stoppedAt=r.verification?.measured_animation_final?.sim_time;
 if(frameTime(t)===null||!validHash(h)||!sameTime(t,vision?.frame_timestamp)||h!==vision?.frame_sha256||
   !Number.isFinite(stoppedAt)||frameTime(t)!<=stoppedAt||pose?.frame_id!=="map"||
   !Number.isFinite(pose.x)||!Number.isFinite(pose.y)||!Number.isFinite(pose.heading??pose.yaw))return null;
 return {source:"real_post_open_camera",robot:{pose},sensor_status:{camera:true},
   current_observation:{timestamp:t,frame_sha256:h,perception_status:"AVAILABLE",semantic_objects:v.semantic_objects}};
}
export function currentFrame(value:any){
 const raw=normalized(value),r=raw?.current_observation?raw:postOpenWorld(raw),o=r?.current_observation;
 return r?.sensor_status?.camera===true&&o?.perception_status==="AVAILABLE"&&validHash(o.frame_sha256)&&
 frameTime(o.timestamp)!==null&&Array.isArray(o.semantic_objects)?o:null;
}
export function freshPeople(value:any){
 const raw=normalized(value),r=raw?.current_observation?raw:(postOpenWorld(raw)??raw),o=r?.current_observation;
 if(o){
  const frame=currentFrame(r);if(!frame)return [];
  return frame.semantic_objects.filter((d:any)=>d?.label==="person"&&sensed(d)&&sameTime(d.timestamp,frame.timestamp)&&d.evidence.frame_sha256===frame.frame_sha256);
 }
 // Inspection arrays are generated from fresh bridge frames, never world-memory objects.
 return Array.isArray(r?.detections)?r.detections.filter((d:any)=>d?.label==="person"&&sensed(d)):[];
}
export function stopped(r:any){return r&&r.navigation_active===false&&r.inspection_active!==true&&
 !r.motion_owner&&Number.isFinite(r.linear_velocity)&&Math.abs(r.linear_velocity)<0.01&&
 Number.isFinite(r.angular_velocity)&&Math.abs(r.angular_velocity)<0.01;}
const later=(e:any,prior:any)=>!prior||(Number.isFinite(e.call_seq)&&Number.isFinite(prior.event_seq)
 ?e.call_seq>prior.event_seq:Number.isFinite(e.call_at)?e.call_at>prior.at:e.at>prior.at);
function navProof(events:any[],target:string,after=-1){
 const matches=events.map((e,i)=>({e,i})).filter(({e,i})=>i>after&&e.tool==="navigate_to"&&e.args?.location===target&&later(e,events[after]));
 for(const {e,i} of matches.reverse()){
  const r=e.result;
  if(r?.accepted!==true||typeof r.operation_id!=="string"||!r.operation_id)continue;
  if(r.status==="SUCCEEDED"&&r.action_status==="SUCCEEDED"&&r.terminal_known!==false)return {call:e,event:e,index:i};
  if(r.status!=="PENDING")continue;
  const terminal=events.map((e,j)=>({e,j})).find(({e:s,j})=>j>i&&s.tool==="get_robot_state"&&
   s.result?.navigation_operation_id===r.operation_id&&s.result?.navigation_terminal_known===true&&
   s.result?.navigation_terminal_status==="SUCCEEDED"&&s.result?.navigation_active===false);
  if(terminal)return {call:e,event:terminal.e,index:terminal.j};
 }
 return null;
}
export function navDone(events:any[],target:string){return Boolean(navProof(events,target));}
function doorInspection(e:any,door:string){
 const r=e.result;
 return e.tool==="inspect_door"&&e.args?.door_id===door&&r?.door_id===door&&r.status==="SUCCEEDED"&&
 r.perception?.status==="AVAILABLE"&&r.evidence?.near_interaction_pose===true&&
 Array.isArray(r.camera_observation)&&r.camera_observation.some((d:any)=>/door/i.test(String(d.label))&&sensed(d)&&
 sameTime(d.timestamp,r.evidence.frame_timestamp)&&r.evidence.frame_hashes?.includes(d.evidence.frame_sha256));
}
function doorProof(stage:any,events:any[]){
 const approach=navProof(events,stage.nav[0]);if(!approach)return {approach:null,inspect:null,open:null,observation:null};
 const ix=events.findIndex((e,i)=>i>approach.index&&later(e,approach.event)&&doorInspection(e,stage.door));
 const inspect=ix<0?null:{event:events[ix],index:ix};
 const ox=inspect?events.findIndex((e,i)=>i>ix&&later(e,inspect.event)&&e.tool==="open_door"&&e.args?.door_id===stage.door&&
 e.result?.door_id===stage.door&&e.result?.status==="SUCCEEDED"&&e.result.runtime_state==="OPEN"&&
 e.result.code==="DOOR_OPEN_VERIFIED"&&e.result.command?.returncode===0&&e.result.command?.stop_returncode===0): -1;
 const open=ox<0?null:{event:events[ox],index:ox};
 const priorFrame=inspect?.event.result?.evidence?.frame_timestamp;
 const vx=open?events.findIndex((e,i)=>i>ox&&later(e,open.event)&&e.tool==="get_world_state"&&
 currentFrame(e.result)&&frameTime(currentFrame(e.result).timestamp)!>frameTime(priorFrame)!): -1;
 const post=open?currentFrame(postOpenWorld(open.event.result)):null;
 const reused=post&&frameTime(post.timestamp)!>frameTime(priorFrame)!?open:null;
 const observation=reused?{...reused,reused_post_open_vision:true}:(vx<0?null:{event:events[vx],index:vx});
 return {approach,inspect,open,observation};
}
function scanProof(stage:any,events:any[]){
 const approach=stage.nav.length?navProof(events,stage.nav[0]):null;
 if(stage.nav.length&&!approach)return null;
 const starts=events.map((e,i)=>({e,i})).filter(({e,i})=>i>(approach?.index??-1)&&later(e,approach?.event)&&e.tool==="inspect_room"&&
 e.args?.location===stage.scan&&e.result?.status==="PENDING"&&e.result.accepted===true&&e.result.terminal_known===false&&
 e.result.room===stage.scan&&typeof e.result.inspection_id==="string"&&e.result.inspection_id&&e.result.required_views===8);
 for(const {e:begin,i} of starts){
  const id=begin.result.inspection_id;
  if(events.slice(0,i).some(e=>e.result?.inspection?.inspection_id===id||e.result?.inspection_id===id))continue;
  for(let j=i+1;j<events.length;j++){
   const e=events[j],scan=e.result?.inspection,r=scan?.result;
   if(e.tool!=="get_robot_state"||scan?.inspection_id!==id||scan.terminal_known!==true||scan.active!==false||
    r?.inspection_id!==id||r.status!=="SUCCEEDED"||r.room!==stage.scan||r.rotation_complete!==true||
    r.scan_views!==8||r.return_motion?.status!=="SUCCEEDED"||!Array.isArray(r.evidence)||r.evidence.length!==8)continue;
   const proof=r.rotation_evidence;
   if(proof?.control_frame!=="odom"||r.return_motion?.control_frame!=="odom"||
     !["start_yaw","end_yaw","measured_radians","max_xy_drift_m","requested_radians"].every(k=>Number.isFinite(proof[k]))||
     Math.abs(proof.requested_radians-2*Math.PI)>1e-6||Math.abs(proof.measured_radians-2*Math.PI)>.12||
     proof.max_xy_drift_m<0||proof.max_xy_drift_m>.20||
     Math.abs(Math.atan2(Math.sin(proof.end_yaw-proof.start_yaw),Math.cos(proof.end_yaw-proof.start_yaw)))>.12)continue;
   const views=r.evidence;
   if(!views.every((v:any,k:number)=>frameTime(v.timestamp)!==null&&validHash(v.frame_sha256)&&v.perception_status==="AVAILABLE"&&
     (v.motion?.status??v.motion_status)==="SUCCEEDED"&&Number.isFinite(v.yaw)&&Number.isFinite(v.odom_yaw)&&
     Math.abs(Math.atan2(Math.sin(v.odom_yaw-proof.start_yaw-k*Math.PI/4),
                        Math.cos(v.odom_yaw-proof.start_yaw-k*Math.PI/4)))<=.12))continue;
   if(new Set(views.map((v:any)=>v.frame_sha256)).size!==8||new Set(views.map((v:any)=>frameTime(v.timestamp))).size!==8)continue;
   if(!views.every((v:any,k:number)=>k===0||frameTime(v.timestamp)!>frameTime(views[k-1].timestamp)!))continue;
   return {begin,event:e,index:j};
  }
 }
 return null;
}
function confirmationScan(events:any[]){
 const stage=stages.find(s=>s.id==="confirm")!,scan=scanProof(stage,events);
 if(!scan)return null;
 const beginIndex=events.indexOf(scan.begin);
 const room=events.slice(0,beginIndex).findLast(e=>e.tool==="get_world_state"&&e.result?.current_location==="Right_Front_Room"&&currentFrame(e.result));
 const prior=currentFrame(room?.result),result=scan.event.result.inspection.result;
 if(!prior||!later(scan.begin,room)||!result.evidence.every((v:any)=>frameTime(v.timestamp)!>frameTime(prior.timestamp)!))return null;
 const people=freshPeople(result).filter((d:any)=>result.evidence.some((v:any)=>sameTime(v.timestamp,d.timestamp)&&v.frame_sha256===d.evidence.frame_sha256));
 return {...scan,people,latest_frame_time:Math.max(...result.evidence.map((v:any)=>frameTime(v.timestamp)!))};
}
export function confirmationPeople(events:any[]){
 const scan=confirmationScan(events);
 return scan?.people??[];
}
function motionBusy(events:any[]){
 const state=events.findLast(e=>e.tool==="get_robot_state")?.result;
 if(state&&(state.navigation_active===true||state.inspection_active===true||state.motion_owner))return true;
 for(let i=0;i<events.length;i++){
  const e=events[i],r=e.result;
  if(e.tool==="navigate_to"&&r?.status==="PENDING"&&r.accepted===true&&!events.slice(i+1).some(v=>v.tool==="get_robot_state"&&
    v.result?.navigation_operation_id===r.operation_id&&v.result.navigation_terminal_known===true&&v.result.navigation_active===false))return true;
  if(e.tool==="inspect_room"&&r?.status==="PENDING"&&r.accepted===true&&!events.slice(i+1).some(v=>v.tool==="get_robot_state"&&
    v.result?.inspection?.inspection_id===r.inspection_id&&v.result.inspection.terminal_known===true&&v.result.inspection.active===false))return true;
 }
 return false;
}
// Demo memory describes completed evidence; it never substitutes for tool proofs.
export function expectedStageMemory(stage:any){
 const descriptions:Record<string,string>={
  start:"起点已完成8视角Agnes环视观测",
  near:"右侧近端门已打开，已取得门后真实相机观测",
  middle_scan:"地图中部已完成8视角Agnes环视观测",
  middle:"右侧中部门已打开，已取得门后真实相机观测",
  front:"已进入右前房间并取得房间内真实相机观测",
  confirm:"人员已用不同相机帧复核，机器人已停止"
 };
 const last_observation=descriptions[stage?.id];
 const robot_location=stage?.scan??stage?.nav?.at(-1)??(stage?.id==="confirm"?"Right_Front_Room":null);
 return last_observation&&robot_location?{robot_location,last_observation}:null;
}
function allowStageMemory(stage:any,args:any,events:any[]){
 const expected=expectedStageMemory(stage);
 if(!expected||!args||typeof args!=="object"||Array.isArray(args)||
  Object.keys(args).length!==2||args.robot_location!==expected.robot_location||
  args.last_observation!==expected.last_observation||!stageEvidence(stage,events).ok)return false;
 // Confirmation has no navigation call of its own; its location must come from
 // this stage's fresh, room-localized camera evidence.
 if(stage.id==="confirm"){
  const observed=events.findLast(e=>e.tool==="get_world_state"&&currentFrame(e.result));
  if(observed?.result?.current_location!==expected.robot_location)return false;
 }
 return true;
}
export function allowTool(stage:any,name:string,args:any,personIds:Set<string>,missionId:string,stageEvents:any[]=[]){
 if(["get_robot_state","get_map","list_known_locations","stop_robot","get_world_state","mission_get_state","world_memory_get"].includes(name))return true;
 if(name==="mission_reset")return stage.id==="start"&&args.mission_id===missionId&&args.goal===initialTask&&!stageEvents.some(e=>["inspect_room","navigate_to"].includes(e.tool));
 if(motionBusy(stageEvents))return false;
 if(name==="world_memory_update")return allowStageMemory(stage,args,stageEvents);
 if(name==="navigate_to"){
  if(!stage.nav.includes(args.location))return false;
  if(args.location===stage.nav[0])return !stageEvents.some(e=>(e.tool==="open_door"&&e.result?.status==="SUCCEEDED")||(e.tool==="inspect_room"&&e.result?.accepted===true));
  return Boolean(stage.door&&args.location===stage.nav[1]&&doorProof(stage,stageEvents).observation);
 }
 if(name==="inspect_room"){
  if(!stage.scan||args.location!==stage.scan)return false;
  if(stage.id==="confirm"&&!stageEvents.some(e=>e.tool==="get_world_state"&&e.result?.current_location==="Right_Front_Room"&&currentFrame(e.result)))return false;
  return !scanProof(stage,stageEvents)&&(!stage.nav.length||navDone(stageEvents,stage.nav[0]));
 }
 if(name==="inspect_door")return Boolean(stage.door)&&args.door_id===stage.door&&Boolean(doorProof(stage,stageEvents).approach)&&
  !navDone(stageEvents,stage.nav[1]);
 if(name==="open_door")return Boolean(stage.door)&&args.door_id===stage.door&&Boolean(doorProof(stage,stageEvents).inspect)&&
  !navDone(stageEvents,stage.nav[1]);
 if(name==="inspect_object"){
  if(stage.id!=="confirm")return false;
  const scan=confirmationScan(stageEvents);
  if(!scan)return false;
  const ids=new Set(scan.people.map((d:any)=>d.id).filter((id:string)=>personIds.has(id)));
  return ids.size>0&&ids.has(args.object_id);
 }
 return false;
}
export function stageEvidence(stage:any,events:any[]){
 const missing:string[]=[];
 if(stage.scan){
  for(const nav of stage.nav)if(!navDone(events,nav))missing.push("navigation:"+nav);
  if(!scanProof(stage,events))missing.push("scan:"+stage.scan);
 }
 if(stage.door){
  const proof=doorProof(stage,events);
  if(!proof.approach)missing.push("navigation:"+stage.nav[0]);
  if(!proof.inspect)missing.push("door-vision:"+stage.door);
  if(!proof.open)missing.push("door-animation:"+stage.door);
  if(!proof.observation)missing.push("fresh-door-view:"+stage.door);
  if(stage.nav[1]){
   const entry=proof.observation&&navProof(events,stage.nav[1],proof.observation.index);
   if(!entry)missing.push("navigation:"+stage.nav[1]);
   else if(!events.some((e,i)=>i>entry.index&&later(e,entry.event)&&e.tool==="get_world_state"&&
    currentFrame(e.result)&&e.result.current_location===stage.nav[1]&&
    frameTime(currentFrame(e.result).timestamp)!>frameTime(currentFrame(proof.observation.event.result).timestamp)!))
    missing.push("fresh-inside-view:"+stage.nav[1]);
  }
 }
 if(stage.id==="confirm"){
  const vx=events.findLastIndex((e,i)=>{
   if(e.tool!=="inspect_object"||e.result?.status!=="SUCCEEDED"||e.result.still_uncertain!==false)return false;
   const scan=confirmationScan(events.slice(0,i));
   if(!scan||!later(e,scan.event))return false;
   if(!scan.people.some((d:any)=>d.id===e.result.object_id&&(e.args?.object_id==="person"||e.args?.object_id===d.id)))return false;
   const people=freshPeople(e.result).filter((d:any)=>frameTime(d.timestamp)!>scan.latest_frame_time);
   const views=(Array.isArray(e.result.evidence)?e.result.evidence:[]).filter((v:any)=>
    v.motion?.status==="SUCCEEDED"&&Number.isFinite(v.yaw)&&people.some((d:any)=>sameTime(v.frame_timestamp,d.timestamp)&&
     Array.isArray(v.detections)&&v.detections.some((vd:any)=>sensed(vd)&&vd.label==="person"&&vd.evidence.frame_sha256===d.evidence.frame_sha256)));
   return people.length>=2&&new Set(people.map((d:any)=>d.evidence.frame_sha256)).size>=2&&
    new Set(people.map((d:any)=>frameTime(d.timestamp))).size>=2&&views.some((a:any)=>views.some((b:any)=>
     Math.abs(Math.atan2(Math.sin(a.yaw-b.yaw),Math.cos(a.yaw-b.yaw)))>.05));
  });
  if(vx<0)missing.push("person-multiview");
  const sx=vx<0?-1:events.findLastIndex((e,i)=>i>vx&&later(e,events[vx])&&e.tool==="stop_robot"&&e.result?.status==="STOPPED"&&e.result.zero_twist_published===true);
  const lastState=events.findLastIndex(e=>e.tool==="get_robot_state");
  const laterMotion=sx>=0&&events.slice(sx+1).some(e=>["navigate_to","inspect_room","inspect_object","open_door"].includes(e.tool));
  if(sx<0||lastState<=sx||!stopped(events[lastState]?.result)||laterMotion)missing.push("verified-stop");
 }
 return {ok:missing.length===0,missing};
}
