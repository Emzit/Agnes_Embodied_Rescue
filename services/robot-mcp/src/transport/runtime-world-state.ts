import { nav2TerminalDetails } from "./navigation-result.ts";
/** Per-gateway runtime memory. Only real bridge results can confirm navigation. */
export class RuntimeWorldState {
  private visited=new Set<string>();
  private attempts: any[]=[];
  private failures: any[]=[];
  private blocked: any[]=[];
  private lastPose: unknown=null;
  private lastStamp: unknown=null;
  private inspected=new Set<string>();
  private objects=new Map<string,any>();
  private observations:any[]=[];
  private history:any[]=[];
  private inspection:unknown=null;
  recordPathConflict(event: any) {
    const evidence=event.evidence;
    if(evidence?.source!=="live_nav2_path_costmap_and_lidar" || !evidence.conflicts?.length
      || typeof event.target!=="string") throw new Error("INVALID_ONBOARD_PATH_CONFLICT");
    const record={route:event.target,source:evidence.source,goal_id:event.goal_id,
      updated_at:Date.now()/1000,evidence:structuredClone(evidence)};
    this.blocked.push(record);
    return record.updated_at;
  }
  recordDetections(detections:any[],location:string) {
    for(const d of detections) {
      const previous=this.objects.get(d.id);
      const obj={...d,location,first_seen_at:previous?.first_seen_at??d.timestamp,last_seen_at:d.timestamp};
      this.objects.set(d.id,structuredClone(obj));this.observations.push(structuredClone(obj));
      this.history.push({id:d.id,confidence:d.confidence,frame_timestamp:d.timestamp});
    }
  }
  recordInspection(result:any,location:string) {
    if(result.status!=="SUCCEEDED")return;
    if(result.inspected)this.inspected.add(location);
    this.recordDetections(result.detections??[],location);
    if(result.object_id) {
      this.history.push({id:result.object_id,before:result.before_confidence,after:result.after_confidence,
        still_uncertain:result.still_uncertain,evidence:result.evidence});
      const old=this.objects.get(result.object_id);
      if(old && Number.isFinite(result.after_confidence)) {
        const latest=result.detections?.at(-1);
        this.objects.set(result.object_id,{...old,confidence:result.after_confidence,
          still_uncertain:result.still_uncertain,last_seen_at:latest?.timestamp??old.last_seen_at,
          evidence:latest?.evidence??old.evidence});
      }
    }
    this.inspection=structuredClone(result);
  }
  observePose(pose: unknown) { this.lastPose=structuredClone(pose); }
  observe(pose: unknown, timestamp: unknown) {
    this.observePose(pose); this.lastStamp=structuredClone(timestamp);
  }
  begin(target: string) {
    const attempt={id:this.attempts.length+1,target,status:"PENDING"};
    this.attempts.push(attempt); return attempt.id;
  }
  finish(id: number, result: any) {
    const attempt=this.attempts.find(a=>a.id===id);
    if(!attempt || attempt.status!=="PENDING") throw new Error("INVALID_NAVIGATION_EVENT");
    Object.assign(attempt,{status:result.status,accepted:result.accepted??false,
      reason:result.reason??null,code:result.code??null,action_status:result.action_status??null,
      error_code:result.error_code??result.result?.error_code??null,
      error_msg:result.error_msg??result.result?.error_msg??null,
      operation_id:result.operation_id??null,goal_id:result.goal_id??null,
      terminal_known:result.terminal_known??false,owner_status:result.owner_status??null,
      timeout_source:result.timeout_source??null});
    if (result.status === "PENDING" && result.accepted === true) return;
    if(result.status==="SUCCEEDED" && result.accepted===true && result.action_status==="SUCCEEDED") this.visited.add(attempt.target);
    else {
      this.failures.push(structuredClone(attempt));
      // Timeout/abort/nearby scan returns never prove a named route is blocked.
      if(result.reason==="PATH_BLOCKED" && typeof result.blocked_route==="string"
        && !this.blocked.some(b=>b.route===result.blocked_route))
        this.blocked.push({route:result.blocked_route,source:"navigation_result",attempt_id:id});
    }
  }
  /** Fold a terminal/active ownership snapshot into the attempt opened by navigate_to. */
  updateNavigation(snapshot: any) {
    const operation = snapshot?.operation ?? snapshot?.last_terminal ?? null;
    const operationId = operation?.operation_id ?? null;
    if (!operationId) return;
    // A terminal snapshot may refer to the previous goal.  Correlate only by
    // the operation id returned to this navigate_to call; target names alone
    // are not an ownership key.
    const attempt = this.attempts.find(a => a.operation_id === operationId);
    if (!attempt) return;
    const active = snapshot?.active === true && snapshot?.terminal_known !== true;
    if (active) {
      Object.assign(attempt, { accepted: true, operation_id: operationId,
        goal_id: operation?.goal_id ?? null, terminal_known: false,
        owner_status: operation?.state ?? snapshot?.status ?? "EXECUTING",
        action_status: snapshot?.status ?? "EXECUTING" });
      return;
    }
    const terminal = operation?.terminal_status ?? snapshot?.status;
    if (!snapshot?.terminal_known || !["SUCCEEDED", "ABORTED", "CANCELED", "REJECTED"].includes(terminal)) return;
    if (attempt.status !== "PENDING") return;
    const result = {
      status: terminal === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      accepted: true, action_status: terminal, terminal_known: true,
      operation_id: operationId, goal_id: operation?.goal_id ?? null,
      ...nav2TerminalDetails(terminal, operation?.error_code,
        operation?.error_msg ?? operation?.error_message, operation?.reason),
    };
    Object.assign(attempt, result);
    if (result.status === "SUCCEEDED") this.visited.add(attempt.target);
    else this.failures.push(structuredClone(attempt));
  }
  snapshot() { return structuredClone({visited_locations:[...this.visited],navigation_attempts:this.attempts,
    navigation_failures:this.failures,blocked_routes:this.blocked,last_pose:this.lastPose,last_observation_timestamp:this.lastStamp,
    inspected_rooms:[...this.inspected],observed_objects:[...this.objects.values()],object_observations:this.observations,
    confidence_history:this.history,last_inspection:this.inspection}); }
}
