import {stages,stageEvidence,freshPeople,allowTool,frameTime,baseTool,normalized,stopped,currentFrame} from "./demo-policy.mts";
export function resumeEvidencePlan(saved:any,plan:any,events:any[],reviewNative:any[]=[]){
 if(!/^guided-demo-\d+$/.test(saved?.run_id||"")||saved.run_id!==plan?.run_id||saved.session_id!==plan?.session_id)throw Error("RESUME_IDENTITY_MISMATCH");
 if(saved.status!=="NEEDS_REVIEW"||saved.stop_verification?.verified!==true)throw Error("RESUME_REQUIRES_VERIFIED_SAFE_STOP");
 const index=stages.findIndex(s=>s.id===saved.stage);if(index<0)throw Error("RESUME_STAGE_UNKNOWN");
 const checks=stages.slice(0,index+1).map(stage=>({stage:stage.id,evidence:stageEvidence(stage,events.filter(e=>e.stage===stage.id))}));
 for(const check of checks.slice(0,-1))if(!check.evidence.ok)throw Error("RESUME_PRIOR_STAGE_EVIDENCE_MISSING:"+check.stage+":"+check.evidence.missing.join(","));
 const current=checks.at(-1)!.evidence,stage:any=stages[index];
 if(index<stages.length-2){
  const candidates=events.filter(e=>e.stage===stage.id).flatMap(e=>freshPeople(e.result?.inspection?.result??e.result).map(d=>({candidate:d,scanEvent:e})));
  if(candidates.some(({candidate,scanEvent})=>candidateReviewProof(saved,stage,candidate,scanEvent,events,reviewNative)?.status!=="UNCONFIRMED_AVAILABLE"))throw Error("RESUME_PERSON_PRESENT_REVIEW");
 }
 const observationOnly=!current.ok&&Boolean(stage.door)&&stage.nav.length===1&&current.missing.length===1&&current.missing[0]==="fresh-door-view:"+stage.door;
 const frontContinuation=!current.ok&&stage.id==="front"&&current.missing.includes("navigation:Right_Front_Room")&&current.missing.every((m:string)=>["fresh-door-view:Right_Front_Door","navigation:Right_Front_Room"].includes(m));
 const confirmEvents=events.filter(e=>e.stage==="confirm");
 const roomView=confirmEvents.findLast(e=>e.tool==="get_world_state");
 const priorFront=events.filter(e=>e.stage==="front").findLast(e=>Number.isInteger(e.event_seq));
 const roomScans=new Set(confirmEvents.filter(e=>e.tool==="inspect_room"&&e.args?.location==="Right_Front_Room"&&
  e.result?.accepted===true&&typeof e.result.inspection_id==="string").map(e=>e.result.inspection_id));
 const failedRoomScan=confirmEvents.some(e=>e.tool==="get_robot_state"&&roomScans.has(e.result?.inspection?.inspection_id)&&
  e.result.inspection.terminal_known===true&&e.result.inspection.result?.status!=="SUCCEEDED");
 const completedRoomScan=!current.missing.includes("scan:Right_Front_Room")?confirmEvents.findLast(e=>
  e.tool==="get_robot_state"&&roomScans.has(e.result?.inspection?.inspection_id)&&e.result.inspection.terminal_known===true&&
  e.result.inspection.active===false&&e.result.inspection.result?.status==="SUCCEEDED"&&
  e.result.inspection.result?.room==="Right_Front_Room"&&e.result.inspection.result?.scan_views===8):null;
 const confirmationContinuation=!current.ok&&stage.id==="confirm"&&current.missing.length>0&&
  current.missing.every((m:string)=>["person-multiview","verified-stop","scan:Right_Front_Room"].includes(m))&&
  roomView?.result?.current_location==="Right_Front_Room"&&Boolean(currentFrame(roomView.result))&&
  Number.isInteger(roomView.call_seq)&&Number.isInteger(priorFront?.event_seq)&&roomView.call_seq>priorFront.event_seq&&!failedRoomScan;
 if(!current.ok&&!observationOnly&&!frontContinuation&&!confirmationContinuation)throw Error("RESUME_REQUIRES_REVIEW:"+current.missing.join(","));
 return {index,observationOnly:observationOnly||frontContinuation,frontContinuation,confirmationContinuation,skipCurrent:current.ok,checks,
 ...(frontContinuation?{continuation:["fresh get_world_state at open door","navigate_to Right_Front_Room and matching SUCCEEDED","fresh get_world_state inside room","confirm"]}:{}),
 ...(confirmationContinuation?{continuation:["fresh room-local camera evidence",
  completedRoomScan?"reuse the actual completed Right_Front_Room scan; do not restart it":"complete one Right_Front_Room scan using its accepted inspection ID",
  "inspect only a new frame-supported person ID","native stop and later zero-state verification"],
  confirmation_scan_required:!completedRoomScan,
  ...(completedRoomScan?{reusable_confirmation_scan:{inspection_id:completedRoomScan.result.inspection.inspection_id,
    native_event_seq:completedRoomScan.event_seq,person_ids:freshPeople(completedRoomScan.result.inspection.result).map(d=>d.id)}}:{}),
  forbidden_continuation_actions:["navigate_to","inspect_door","open_door","mission_reset"]}: {})};
}
export function validateResumeRecording(meta:any,approval:any,runId:string,sessionId:string,now=Date.now()){
 if(approval?.authorized!==true||approval.run_id!==runId||approval.session_id!==sessionId||!Number.isFinite(Date.parse(approval.expires_at))||Date.parse(approval.expires_at)<=now)throw Error("RESUME_APPROVAL_INVALID");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(meta?.id||"")||meta.status!=="RECORDING"||meta.source!=="user_selected_browser_display_capture"||!Number.isFinite(Date.parse(meta.updated_at))||now-Date.parse(meta.updated_at)>15000||now-Date.parse(meta.updated_at)<-2000||!Number.isInteger(meta.chunk_count)||meta.chunk_count<1)throw Error("RESUME_LIVE_RECORDING_REQUIRED");
 if(!Number.isFinite(meta.limits?.maxSeconds)||meta.limits.maxSeconds<=0||meta.limits.maxSeconds>1200||!Number.isFinite(Date.parse(meta.started_at))||Date.parse(meta.started_at)>now||now-Date.parse(meta.started_at)>meta.limits?.maxSeconds*1000)throw Error("RESUME_RECORDING_EXPIRED");
 return {recordingId:meta.id,expires:Date.parse(approval.expires_at)};
}
export function allowResumeObservation(name:string){return ["get_world_state","get_robot_state","stop_robot"].includes(name);}

export function allowResumeFrontEntry(name:string,args:any,events:any[]){
 if(allowResumeObservation(name))return true;
 return name==="navigate_to"&&args?.location==="Right_Front_Room"&&!events.some(e=>e.tool==="navigate_to"&&e.args?.location==="Right_Front_Room"&&e.result?.accepted===true)&&allowTool(stages.find(s=>s.id==="front"),name,args,new Set(),"",events);
}

/** A native recorded three-view review can leave a real weak candidate unconfirmed.
 * It does not prove that the scanned area is empty or erase the original sighting. */
export function candidateReviewProof(saved:any,stage:any,candidate:any,scanEvent:any,events:any[],native:any[]=[],allowConfirmed=false){
 if(!["start","middle_scan"].includes(stage?.id)||!Number.isFinite(candidate?.confidence)||candidate.confidence<0||candidate.confidence>=.8||
  !freshPeople({detections:[candidate]}).length||!Number.isInteger(scanEvent?.event_seq))return null;
 const sourceScan=scanEvent.result?.inspection?.result;
 const scanTime=frameTime(candidate.timestamp);
 if(scanTime===null||sourceScan?.status!=="SUCCEEDED"||!Array.isArray(sourceScan.evidence)||sourceScan.evidence.length!==8)return null;
 const reviewedAfter=Math.max(scanTime,...sourceScan.evidence.map((v:any)=>frameTime(v.timestamp)??Infinity));
 if(!Number.isFinite(reviewedAfter))return null;
 for(const e of events){
  const r=e.result;
  if(e.stage!==stage.id+"_candidate_review"||e.session_id!==saved.session_id||e.tool!=="inspect_object"||
   e.args?.object_id!==candidate.id||r?.object_id!==candidate.id||r.status!=="SUCCEEDED"||
   r.before_confidence!==candidate.confidence||(!allowConfirmed&&r.still_uncertain!==true)||typeof r.still_uncertain!=="boolean"||!Number.isFinite(r.after_confidence)||
   r.after_confidence<0||r.after_confidence>1||!Array.isArray(r.evidence)||r.evidence.length!==3||
   !Number.isInteger(e.call_seq)||!Number.isInteger(e.event_seq)||e.call_seq<=scanEvent.event_seq||e.event_seq<=e.call_seq)continue;
  const nativeMatches=(item:any,tool:string)=>{
   const c=native.find(n=>n.seq===item.call_seq&&n.type==="tool/call"&&n.data?.toolUseId===item.tool_call_id&&baseTool(n.data.name)===tool&&
    JSON.stringify(n.data.args??{})===JSON.stringify(item.args??{}));
   const v=native.find(n=>n.seq===item.event_seq&&n.type==="tool/result"&&n.data?.toolUseId===item.tool_call_id&&!n.data?.isError);
   return Boolean(c&&v&&c._meta?.generation===v._meta?.generation&&
    JSON.stringify(normalized(v.data.result??v.data.content??v.data))===JSON.stringify(item.result));
  };
  if(!nativeMatches(e,"inspect_object"))continue;
  const views=r.evidence,origin=scanEvent.result?.inspection?.result?.return_motion?.start_pose;
  const pose=(p:any)=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.frame_id==="map";
  if(!pose(origin)||!views.every((v:any)=>pose(v.motion?.start_pose)&&pose(v.motion?.end_pose)&&
    Math.hypot(v.motion.start_pose.x-origin.x,v.motion.start_pose.y-origin.y)<.5&&
    Math.hypot(v.motion.end_pose.x-origin.x,v.motion.end_pose.y-origin.y)<.5))continue;
  if(!views.every((v:any)=>frameTime(v.frame_timestamp)!>reviewedAfter&&Number.isFinite(v.yaw)&&v.motion?.status==="SUCCEEDED"&&
   Number.isFinite(v.motion.xy_drift)&&v.motion.xy_drift>=0&&v.motion.xy_drift<=.2&&Array.isArray(v.detections)))continue;
  if(new Set(views.map((v:any)=>frameTime(v.frame_timestamp))).size!==3||
   !views.every((v:any,i:number)=>i===0||frameTime(v.frame_timestamp)!>frameTime(views[i-1].frame_timestamp)!))continue;
  // Positive detections carry Agnes pixel hashes; genuinely empty views have only
  // actual camera timestamps and motion evidence, never invented hash fields.
  if(!views.every((v:any)=>v.detections.every((d:any)=>freshPeople({detections:[d]}).length===1&&
   frameTime(d.timestamp)===frameTime(v.frame_timestamp))))continue;
  const after=events.findLast(a=>a.stage===stage.id+"_candidate_review"&&a.session_id===saved.session_id&&a.tool==="get_robot_state"&&
   a.call_seq>e.event_seq&&stopped(a.result)&&frameTime(a.result.timestamp)!>=frameTime(views[2].frame_timestamp)!);
  const stop=events.find(a=>a.stage===stage.id+"_candidate_review"&&a.session_id===saved.session_id&&a.tool==="stop_robot"&&
   a.call_seq>e.event_seq&&a.event_seq<after?.call_seq&&a.result?.status==="STOPPED"&&a.result.zero_twist_published===true);
  if(!after||!stop||!nativeMatches(after,"get_robot_state")||!nativeMatches(stop,"stop_robot"))continue;
  if(!Array.isArray(r.detections)||!Number.isInteger(r.detection_count)||r.detection_count!==r.detections.length||
   r.detections.some((d:any)=>!freshPeople({detections:[d]}).length||!views.some((v:any)=>
    frameTime(v.frame_timestamp)===frameTime(d.timestamp)&&v.detections.some((vd:any)=>vd.id===d.id&&vd.evidence?.frame_sha256===d.evidence?.frame_sha256))))continue;
  const confidence=r.detections.length?r.detections.reduce((sum:number,d:any)=>sum+d.confidence,0)/r.detections.length:0;
  if(Math.abs(confidence-r.after_confidence)>1e-6||r.still_uncertain!==(r.detections.length<2||confidence<.8))continue;
  return {status:r.still_uncertain?"UNCONFIRMED_AVAILABLE":"CONFIRMED_STOP",candidate_id:candidate.id,inspect_event_seq:e.event_seq,
    original_confidence:candidate.confidence,after_confidence:r.after_confidence,
    area_empty_claimed:false,original_candidate_preserved:true};
 }
 return null;
}
