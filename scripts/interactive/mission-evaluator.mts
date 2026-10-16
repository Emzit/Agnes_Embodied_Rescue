import { createTargetEvidence } from '../../packages/embodied-rescue-plugin/src/backend/target-evidence.mjs';
type Event = { type: string; tool?: string; args?: any; result?: any; text?: string; timestamp?: string };

const LOCATION_RE = /Room_[A-Z]|Corridor_[A-Z]|Location_[A-Za-z0-9]+|Side_Corridor|Start|A_(?:Main|Site|Tree|Link)/g;
const NEGATIVE_WORDS = /不要|不必|无需|禁止|不得|不能|不准|勿|不需要/u;
export const TASK_ORIGIN_ALIAS = '__MISSION_ORIGIN__';
export function originAliasForMission(missionId?: string) {
  if (!missionId) return TASK_ORIGIN_ALIAS;
  const safe = String(missionId).replace(/[^A-Za-z0-9_-]/g, '_');
  return `${TASK_ORIGIN_ALIAS}:${safe}`;
}

export function agnesTurnCompletionError(turn: any) {
  if (turn?.reason === 'completed' && turn?.stopReason === 'end_turn') return null;
  return {
    code: 'AGNES_TURN_NOT_COMPLETED',
    message: 'Agnes session did not finish with a normal end_turn.',
    reason: turn?.reason ?? null,
    stop_reason: turn?.stopReason ?? null,
  };
}

const baseTool = (name = '') => String(name).replace(/^mcp_(?:robot_mcp|envdoor)_[^_]+_/, '').replace(/^mcp_robot_mcp_/, '');
/**
 * MCP tool results arrive through several legal envelopes.  The live SDK can
 * deliver a JSON object, a JSON string in a text content block, or a content
 * wrapper.  Evaluation must normalize these representations without turning
 * non-JSON/error text into a success.
 */
export function normalizeToolResult(value: any): any {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return value;
    try { return normalizeToolResult(JSON.parse(text)); } catch { return value; }
  }
  if (Array.isArray(value)) {
    const textBlock = value.find((item: any) => item && item.type === 'text' && typeof item.text === 'string');
    if (textBlock) return normalizeToolResult(textBlock.text);
    return value;
  }
  if (value && typeof value === 'object') {
    if (value.structuredContent !== undefined) return normalizeToolResult(value.structuredContent);
    if (value.structured !== undefined) return normalizeToolResult(value.structured);
    if (Array.isArray(value.content)) {
      const textBlock = value.content.find((item: any) => item && item.type === 'text' && typeof item.text === 'string');
      if (textBlock) {
        const parsed = normalizeToolResult(textBlock.text);
        if (parsed !== textBlock.text) return parsed;
      }
    }
  }
  return value;
}
function normalizeEventResults(events: Event[]) {
  return events.map(event => event && Object.prototype.hasOwnProperty.call(event, 'result')
    ? { ...event, result: normalizeToolResult(event.result) }
    : event);
}
const succeeded = (result: any) => normalizeToolResult(result)?.status === 'SUCCEEDED' &&
  (normalizeToolResult(result).accepted === undefined || normalizeToolResult(result).accepted === true) &&
  (normalizeToolResult(result).action_status === undefined || normalizeToolResult(result).action_status === 'SUCCEEDED');
function resultText(result: any) { return JSON.stringify(normalizeToolResult(result) ?? ''); }
function objectResult(result: any) {
  const normalized = normalizeToolResult(result);
  return normalized && typeof normalized === 'object' ? normalized : {};
}
export function hasBlockedRouteEvidence(value: any) {
  const result = objectResult(value);
  if (Array.isArray(result.blocked_routes) && result.blocked_routes.length > 0) return true;
  if ([result.status, result.reason, result.code, result.error_code]
    .some(item => /PATH_BLOCKED|dynamic.*block|路径阻塞/iu.test(String(item ?? '')))) return true;
  return /(?:^|[^A-Z_])PATH_BLOCKED(?:$|[^A-Z_])/u.test(String(typeof value === 'string' ? value : resultText(value)));
}
function negativeNear(task: string, index: number, width = 28) {
  const before = task.slice(Math.max(0, index - width), index);
  return NEGATIVE_WORDS.test(before) && !/[。！？；;\n]/u.test(before.slice(before.lastIndexOf('不要') + 2));
}
function positiveMention(task: string, pattern: RegExp) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  for (const match of task.matchAll(re)) if (!negativeNear(task, match.index ?? 0)) return true;
  return false;
}
function isDoorObservationMention(task: string, index: number, length: number) {
  // Door capability calls are environment interaction, not a requirement to
  // inspect a room.  Keep the generic evaluator from turning "inspect_door"
  // or a nearby Chinese door-observation phrase into inspect_room(Room_X).
  const context = task.slice(Math.max(0, index - 40), Math.min(task.length, index + length + 40));
  return /inspect[_\s-]*door|open[_\s-]*door|门|door/iu.test(context);
}
export type EvaluationMap = {
  locations: Array<{id:string;name:string;type?:string}>;
  doors: Array<{id:string;connects:string[];interaction_location?:string;interaction_pose?:{x:number;y:number}}>;
};
function aliasPattern(value: string) {
  return value.normalize("NFKC").trim().split(/[\s_-]+/u)
    .map(part => part.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&")).join("[\\s_-]+");
}
function locationsInTask(task: string, map?: EvaluationMap) {
  if (!map) return [...task.matchAll(LOCATION_RE)].map(match => ({ id: match[0], index: match.index ?? 0, forbidden: negativeNear(task, match.index ?? 0) }));
  const mentions: Array<{id:string;index:number;forbidden:boolean}> = [];
  for (const location of map.locations) {
    for (const alias of new Set([location.id, location.name])) {
      if (!alias) continue;
      for (const match of task.matchAll(new RegExp(aliasPattern(alias), "giu"))) {
        const index=match.index ?? 0;
        const clauseStart=Math.max(task.lastIndexOf("。",index),task.lastIndexOf("；",index),task.lastIndexOf(";",index),task.lastIndexOf("\n",index))+1;
        const prefix=task.slice(clauseStart,index);
        // A previous failed route describes history, not another destination.
        if (/(?:上一轮|前一轮|上次|previous\s+(?:turn|attempt))/iu.test(prefix)
            && !/(?:请|现在|接下来|本轮|本次|重复|再次|navigate[_\s-]*to|go\s+to)/iu.test(prefix)) continue;
        if (!mentions.some(m=>m.id===location.id && m.index===index)) mentions.push({id:location.id,index,forbidden:negativeNear(task,index)});
      }
    }
  }
  return mentions.sort((a,b)=>a.index-b.index);
}
function doorRequirements(task: string, mentions: Array<{id:string;index:number;forbidden:boolean}>, map?: EvaluationMap) {
  if (!map) return [];
  const openings=[...task.matchAll(/开门|打开[^。！？；;\n]{0,20}(?:门|door)|(?:门|door)[^。！？；;\n]{0,12}打开|open(?:[_\s-]+(?:the|[A-Za-z0-9]+)){0,8}[_\s-]+door/giu)]
    .filter(m=>!negativeNear(task,m.index ?? 0) && !/(?:保持|维持)(?:已|已经)?打开/u.test(m[0]));
  const required: Array<{door_id:string;interaction_location:string;room:string|null;mention_index:number|null}>=[];
  for (const opening of openings) {
    const index=opening.index ?? 0;
    const clauseStart=Math.max(task.lastIndexOf("。",index),task.lastIndexOf("；",index),task.lastIndexOf(";",index),task.lastIndexOf("\n",index))+1;
    const nextBoundary=task.slice(index).search(/[。！？；;\n]/u);
    const clause=task.slice(clauseStart,Math.min(task.length,index+opening[0].length+60,
      nextBoundary<0?task.length:index+nextBoundary));
    const explicit=map.doors.filter(d=>new RegExp(aliasPattern(d.id),"iu").test(clause));
    const roomMention=mentions.filter(m=>!m.forbidden && m.index>=clauseStart && Math.abs(m.index-index)<120
      && map.locations.find(l=>l.id===m.id)?.type==="room").sort((a,b)=>Math.abs(a.index-index)-Math.abs(b.index-index))[0];
    const candidates=explicit.length ? explicit : roomMention ? map.doors.filter(d=>d.connects.includes(roomMention.id)) : [];
    if (candidates.length!==1) continue;
    const d=candidates[0];
    if (!required.some(r=>r.door_id===d.id)) required.push({door_id:d.id,interaction_location:d.interaction_location || d.id+"_interaction",
      room:roomMention?.id || null,mention_index:roomMention?.index ?? null});
  }
  return required;
}
function isOrderedSubsequence(actual: string[], required: string[]) {
  if (!required.length) return true;
  let cursor = 0;
  for (const value of actual) if (value === required[cursor]) cursor += 1;
  return cursor === required.length;
}
type ReturnReference = { mode: 'task_origin' | 'semantic_start' | 'named_location' | 'ambiguous'; target: string | null; index: number };
const RETURN_VERB_RE = /返回|回到|回至|回去|return\s+to|go\s+back\s+to/iu;
const ORIGIN_WORD_RE = /(?:一开始|本次任务开始|任务开始|出发|origin|where\s+you\s+started|starting\s+position)/iu;
const PLACE_WORD_RE = /(?:位置|地方|地点|出发处|出发点|起始处|point|place|location|position|origin)/iu;
const START_WORD_RE = /(?:地图上的\s*)?Start|起点|起始位置/iu;
function parseReturnReference(task: string, missionId?: string, map?: EvaluationMap): ReturnReference | null {
  const match = RETURN_VERB_RE.exec(task);
  if (!match) return null;
  const index = match.index ?? 0;
  if (negativeNear(task, index)) return null;
  const tail = task.slice(index + match[0].length, index + match[0].length + 100);
  if (ORIGIN_WORD_RE.test(tail) && (PLACE_WORD_RE.test(tail) || /where\s+you\s+started|origin/iu.test(tail))) {
    return { mode: 'task_origin', target: originAliasForMission(missionId), index };
  }
  if (START_WORD_RE.test(tail)) return { mode: 'semantic_start', target: 'Start', index };
  const named = locationsInTask(tail,map).find(m=>!m.forbidden);
  if (named) return { mode: 'named_location', target: named.id, index };
  if (/那里|那里边|原处|that\s+place|there/iu.test(tail)) return { mode: 'ambiguous', target: null, index };
  return null;
}
export function extractRequirements(task: string, missionId?: string, map?: EvaluationMap) {
  const originalMentions = locationsInTask(task,map);
  const requiredDoorOpenings = doorRequirements(task,originalMentions,map);
  const explicitRoomEntry = positiveMention(task,/进入|enter|inside/iu);
  // A door-opening objective reaches the outside approach, not a room behind
  // its closed leaf. Explicit room entry remains a separate navigation target.
  const mentions = originalMentions.flatMap(m=>{
    const d=requiredDoorOpenings.find(d=>d.room===m.id && d.mention_index===m.index);
    if (!d || m.forbidden) return [m];
    return explicitRoomEntry ? [{...m,id:d.interaction_location},m] : [{...m,id:d.interaction_location}];
  });
  for (const d of requiredDoorOpenings) if (d.mention_index===null && !mentions.some(m=>m.id===d.interaction_location && !m.forbidden)) mentions.push({id:d.interaction_location,index:task.indexOf(d.door_id),forbidden:false});
  mentions.sort((a,b)=>a.index-b.index);
  const forbiddenLocations = [...new Set(mentions.filter(item => item.forbidden).map(item => item.id))];
  // A task often repeats a location while describing the observation or
  // interaction at that location.  Consecutive repeats describe one
  // objective; preserve non-consecutive repeats because they represent a
  // real return leg (for example A_Main -> A_Link -> A_Site -> A_Link).
  const requiredLocations: string[] = [];
  for (const item of mentions) {
    if (item.forbidden) continue;
    if (requiredLocations.at(-1) === item.id) continue;
    requiredLocations.push(item.id);
  }
  const inspectionMatches = [...task.matchAll(/检查|查看|观察|检视|inspect|inspection|look\s+for|看有没有/igu)]
    .filter(match => !isDoorObservationMention(task, match.index ?? 0, match[0].length));
  const inspectionPositive = inspectionMatches.some(match => !negativeNear(task, match.index ?? 0));
  const inspectionMention = inspectionMatches.find(match => !negativeNear(task, match.index ?? 0));
  const inspectionEnd = inspectionMention ? (inspectionMention.index ?? 0) + inspectionMention[0].length : 0;
  const nearbyAfterInspection = inspectionMention ? mentions.find(item => !item.forbidden && item.index >= inspectionEnd && item.index - inspectionEnd < 24 && /^[\s,，、:：]*$/u.test(task.slice(inspectionEnd, item.index))) : null;
  const nearbyBeforeInspection = inspectionMention ? mentions.filter(item => !item.forbidden && item.index < (inspectionMention.index ?? 0)).at(-1) : null;
  const inspectionTarget = nearbyAfterInspection?.id || nearbyBeforeInspection?.id || null;
  const reportLocation = positiveMention(task, /告诉.*当前位置|报告.*当前位置|说明.*当前位置|当前.*位置|current\s+location|where.*located/iu);
  const forbiddenActions = new Set<string>();
  if (/(?:不要|不必|无需|禁止|不得|不能|不准|勿|不需要)[^。！？；;\n]{0,24}(?:检查|查看|观察|检视|inspect|inspection|看有没有)/iu.test(task)) {
    forbiddenActions.add('inspect_room'); forbiddenActions.add('inspect_object');
  }
  if (/(?:不要|不必|无需|禁止|不得|不能|不准|勿|不需要)[^。！？；;\n]{0,24}(?:寻找|搜索|找人|人员|研究员|person|search|find)/iu.test(task)) forbiddenActions.add('person_search');
  if (/(?:不要|不必|无需|禁止|不得|不能|不准|勿|不需要)[^。！？；;\n]{0,24}(?:开门|打开门|open[_\s-]+(?:the[_\s-]+)?door)/iu.test(task)) forbiddenActions.add('open_door');
  const returnReference = parseReturnReference(task, missionId,map);
  const returnMode = returnReference?.mode === 'ambiguous' ? 'ambiguous' : returnReference?.mode ?? null;
  const finalReturnTarget = returnReference?.target ?? null;
  if (finalReturnTarget && !requiredLocations.includes(finalReturnTarget)) {
    const insertAt = mentions.filter(item => !item.forbidden && item.index < (returnReference?.index ?? task.length)).length;
    requiredLocations.splice(insertAt, 0, finalReturnTarget);
  }
  const personSearchRequired = positiveMention(task, /搜索.*(?:人|人员|研究员|person)|寻找.*(?:人|人员|研究员)|找(?:到)?.{0,8}(?:待救援|待援救|人员)|失联研究员|find.*(?:person|researcher)/iu);
  const reinspectionRequired = positiveMention(task, /复检|重新检查|reinspect|re-?check|再检查/iu);
  const navigationVerbMention = positiveMention(task, /去|进入|前往|到达|navigate|go\s+to/iu);
  const needsNavigation = requiredLocations.length > 0 || navigationVerbMention;
  const needsInspection = inspectionPositive && !forbiddenActions.has('inspect_room') && !forbiddenActions.has('inspect_object');
  const rescueTask = positiveMention(task, /失联研究员|待(?:救援|援救)人员|救援任务|rescue\s+mission|find\s+the\s+missing/iu);
  const riskReportRequired = positiveMention(task,
    /(?:报告|汇报|report|summari[sz]e).{0,24}(?:环境)?(?:风险|危险|risk|hazard)|(?:风险|危险|risk|hazard).{0,24}(?:报告|汇报|report|summari[sz]e)/iu);
  const dynamicEventRequired = positiveMention(task, /动态事件|dynamic\s+event|causal\s+replan|因果(?:重规划|重规划链)/iu);
  const navigationTargetMissing = navigationVerbMention && requiredLocations.length === 0 && !rescueTask && returnMode !== 'ambiguous';
  const requiredActions: any[] = requiredLocations.map(target => ({ action: 'navigate_to', target }));
  for (const door of requiredDoorOpenings) requiredActions.push({action:'open_door',target:door.door_id});
  if (needsInspection) requiredActions.push({ action: 'inspect_room', target: inspectionTarget });
  if (reportLocation) requiredActions.push({ action: 'report_location', target: requiredLocations.at(-1) || null });
  return {
    needsNavigation,
    required_locations: requiredLocations,
    required_actions: requiredActions,
    required_door_openings: requiredDoorOpenings,
    required_inspection: needsInspection,
    inspection_target: inspectionTarget,
    final_return_target: finalReturnTarget,
    final_return_required: Boolean(finalReturnTarget && requiredLocations.at(-1) === finalReturnTarget),
    return_required: Boolean(finalReturnTarget),
    return_reference_index: returnReference?.index ?? null,
    navigation_target_missing: navigationTargetMissing,
    return_mode: returnMode,
    person_search_required: personSearchRequired,
    reinspection_required: reinspectionRequired,
    required_report_location: reportLocation,
    rescue_task: rescueTask,
    risk_report_required: riskReportRequired,
    dynamic_event_required: dynamicEventRequired,
    constraints: { forbidden_locations: forbiddenLocations, forbidden_actions: [...forbiddenActions] },
    parse_warnings: !requiredLocations.length && !needsNavigation ? ['NO_EXPLICIT_NAVIGATION_TARGET'] : [],
  };
}
function navigationHealthFailure(event: Event) {
  const result = event.result || {};
  const code = result?.result?.error_code ?? result?.error_code ?? result?.code;
  return [104, '104', 'ROS2_TIMEOUT', 'NAVIGATION_SYSTEM_UNHEALTHY'].includes(code) || ['ABORTED', 'TIMEOUT'].includes(result?.action_status) || ['TIMEOUT', 'ROS2_TIMEOUT', 'NAVIGATION_SYSTEM_UNHEALTHY'].includes(result?.reason);
}
function hasPersonEvidence(events: Event[]) {
  const evidence = createTargetEvidence(() => 0);
  for (const event of events) {
    if (event.type === 'tool_result') evidence.observe('mcp_robot_mcp_eval_'+baseTool(event.tool),event.result);
  }
  return Boolean(evidence.confirmation());
}

function hasSensorObservation(events: Event[]) {
  return events.some(event => {
    const tool = baseTool(event.tool);
    if (!['inspect_room', 'inspect_object', 'get_observation'].includes(tool)) return false;
    const result = objectResult(event.result);
    if (result.status !== 'SUCCEEDED') return false;
    const cameraEvidence = result.detections?.some?.((d: any) =>
      d?.source === 'ros2_camera_perception' && (d?.evidence?.frame_timestamp || d?.timestamp)) ||
      result.evidence?.some?.((view: any) => view?.timestamp || view?.frame_timestamp ||
        view?.detections?.some?.((d: any) => d?.source === 'ros2_camera_perception' && (d?.evidence?.frame_timestamp || d?.timestamp)));
    const liveObservation = result.source === 'ros2_real_sensors' &&
      (result.camera?.available === true || result.camera?.frame_timestamp || result.frame_timestamp);
    return Boolean(liveObservation || cameraEvidence);
  });
}

function riskReportComplete(report: string, events: Event[]) {
  const value = String(report ?? '').trim();
  if (value.length < 24 || !/(?:风险|危险|risk|hazard)/iu.test(value)) return false;
  const conclusion = /(?:观察到|发现|未观察到|未发现|没有|无明显|不存在|存在|目前|尚未|unknown|observed|found|detected|no\s+(?:obvious\s+)?(?:risk|hazard)|risk.{0,16}unknown|hazard.{0,16}unknown)/iu.test(value);
  const progressOnly = /(?:let me|need to|still need|remaining.{0,20}(?:survey|inspect|search)|接下来.{0,20}(?:检查|搜索|查看)|还需要.{0,20}(?:检查|搜索|查看)|仍需.{0,20}(?:检查|搜索|查看)|让我.{0,20}(?:继续|完成|检查))/iu.test(value);
  const explicitNoRisk = /(?:未观察到|未发现|没有|无明显|不存在|no\s+(?:obvious\s+)?(?:risk|hazard))/iu.test(value) && /(?:风险|危险|risk|hazard)/iu.test(value);
  return conclusion && !progressOnly && hasSensorObservation(events) && (explicitNoRisk || /(?:Camera|LiDAR|相机|激光雷达|传感器|观察|检测|视野|frame)/iu.test(value));
}

function currentMissionEvents(events: Event[], missionId?: string) {
  if (!missionId) return events;
  const reset = events.findIndex(event => event.type === 'tool_result' && baseTool(event.tool) === 'mission_reset' && event.result?.mission_id === missionId);
  return reset >= 0 ? events.slice(reset + 1) : events;
}

// In managed mode navigate_to may return a real PENDING acknowledgement before
// the MCP SDK request deadline.  The terminal result is then delivered by a
// later get_robot_state sample carrying the same operation/goal identifiers.
// Fold that evidence for evaluation without mutating the raw event log.
function navigationTerminalEvidence(scopedEvents: Event[]) {
  const results = scopedEvents.filter(e => e.type === 'tool_result');
  const navigation = results.filter(e => baseTool(e.tool) === 'navigate_to');
  return navigation.map(event => {
    const raw = event.result || {};
    if (raw.status !== 'PENDING' || !raw.operation_id) return event;
    const start = scopedEvents.indexOf(event);
    const terminal = results.find(candidate => {
      const index = scopedEvents.indexOf(candidate);
      if (index <= start || !['get_robot_state', 'stop_robot'].includes(baseTool(candidate.tool))) return false;
      const value = candidate.result || {};
      if (baseTool(candidate.tool) === 'stop_robot') {
        return value.operation_id === raw.operation_id && value.terminal_known === true &&
          value.cancel_status === 'CANCELED';
      }
      return value.navigation_operation_id === raw.operation_id &&
        value.navigation_terminal_known === true &&
        ['SUCCEEDED', 'ABORTED', 'CANCELED', 'REJECTED'].includes(value.navigation_terminal_status);
    });
    if (!terminal) return event;
    const value = terminal.result || {};
    const terminalStatus = baseTool(terminal.tool) === 'stop_robot'
      ? 'CANCELED' : value.navigation_terminal_status;
    return {
      ...event,
      result: {
        ...raw,
      status: terminalStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      action_status: terminalStatus,
      terminal_known: true,
      goal_id: value.navigation_goal_id ?? raw.goal_id ?? null,
      final_pose: value.pose ?? null,
      final_location: terminalStatus === 'SUCCEEDED' && typeof value.current_location === 'string'
        ? value.current_location : null,
      error_code: value.navigation_error_code ?? null,
        derived_terminal_from: {
          tool: baseTool(terminal.tool),
          operation_id: raw.operation_id,
          terminal_status: terminalStatus,
        },
      },
    };
  });
}

export function evaluateMission(task: string, events: Event[], report: string, turnError: any, stopped: boolean, missionId?: string, causalEvidence: any = null, map?: EvaluationMap) {
  const scopedEvents = currentMissionEvents(normalizeEventResults(events), missionId);
  const requirements = extractRequirements(task, missionId,map);
  const constraints = requirements.constraints;
  const toolResults = scopedEvents.filter(e => e.type === 'tool_result');
  const toolCalls = scopedEvents.filter(e => e.type === 'tool_call');
  const navigation = navigationTerminalEvidence(scopedEvents);
  const navigationSuccess = navigation.filter(e => succeeded(e.result));
  const navigationFailures = navigation.filter(e => !succeeded(e.result));
  const inspections = toolResults.filter(e => ['inspect_room', 'inspect_object'].includes(baseTool(e.tool)));
  const roomInspections = toolResults.filter(e => baseTool(e.tool) === 'inspect_room');
  const inspectionSuccess = inspections.filter(e => succeeded(e.result));
  const roomInspectionSuccess = roomInspections.filter(e => succeeded(e.result));
  const doorOpenResults = toolResults.filter(e=>baseTool(e.tool)==='open_door');
  const doorChecks = requirements.required_door_openings.map(door=>{
    const verified = doorOpenResults.find(open=>{
      const r=objectResult(open.result);
      if (!succeeded(r) || r.door_id!==door.door_id || r.runtime_state!=='OPEN'
          || !['DOOR_OPEN_VERIFIED','ALREADY_OPEN'].includes(r.code) || !r.verification) return false;
      const openIndex=scopedEvents.indexOf(open);
      return scopedEvents.slice(0,openIndex).some(inspect=>{
        const v=objectResult(inspect.result);
        return inspect.type==='tool_result' && baseTool(inspect.tool)==='inspect_door' && succeeded(v)
          && v.door_id===door.door_id && v.evidence?.source?.includes('Agnes')
          && v.evidence?.near_interaction_pose===true && v.evidence?.frame_hashes?.some((hash:any)=>typeof hash==='string' && /^[a-f0-9]{64}$/i.test(hash));
      });
    });
    return {...door,open_verified:Boolean(verified),result:verified?.result || null};
  });
  const doorOpeningSatisfied=doorChecks.every(d=>d.open_verified);

  // get_robot_state is a read-only observation and its real ROS2 result does
  // not carry an action-style status field.  A finite map pose is the success
  // evidence; accepting only succeeded() would erase the task-origin sample.
  const states = toolResults.filter(e => baseTool(e.tool) === 'get_robot_state' &&
    (succeeded(e.result) || (Number.isFinite(e.result?.pose?.x) && Number.isFinite(e.result?.pose?.y))));
  const isOriginTarget = (target: any) => typeof target === 'string' &&
    (target === TASK_ORIGIN_ALIAS || target.startsWith(`${TASK_ORIGIN_ALIAS}:`));
  const sameTarget = (actual: any, expected: any) => actual === expected ||
    (isOriginTarget(actual) && isOriginTarget(expected));
  const canonicalTarget = (target: any) => isOriginTarget(target) ? TASK_ORIGIN_ALIAS : target;
  // A mission-origin token is an action target, not a semantic location name.
  // It can satisfy a named-location objective only when the matching Nav2
  // terminal sample independently locates the robot at that named location.
  const reachedTarget = (result: any, expected: string) => {
    if (sameTarget(result?.target, expected)) return true;
    return isOriginTarget(result?.target) && result?.status === 'SUCCEEDED' &&
      result?.action_status === 'SUCCEEDED' && result?.terminal_known === true &&
      result?.final_location === expected && result?.final_pose?.frame_id === 'map' &&
      Number.isFinite(result?.final_pose?.x) && Number.isFinite(result?.final_pose?.y);
  };
  const semanticNavigationTarget = (result: any) => isOriginTarget(result?.target) &&
    result?.status === 'SUCCEEDED' && result?.action_status === 'SUCCEEDED' &&
    result?.terminal_known === true && result?.final_pose?.frame_id === 'map' &&
    Number.isFinite(result?.final_pose?.x) && Number.isFinite(result?.final_pose?.y) &&
    typeof result?.final_location === 'string'
    ? result.final_location : canonicalTarget(result?.target);
  const successfulNavigationTargets = navigationSuccess.map(e => semanticNavigationTarget(e.result)).filter(Boolean);
  const finalNavigation = navigationSuccess.at(-1)?.result || null;
  const finalNavigationAttempt = navigation.at(-1)?.result || null;
  const finalState = states.at(-1)?.result || null;
  const finalPose = finalNavigation?.final_pose || finalState?.pose || null;
  const finalLocation = finalNavigation?.final_location || finalState?.current_location || finalNavigation?.target || null;
  const originState = states.find(e => Number.isFinite(e.result?.pose?.x) && Number.isFinite(e.result?.pose?.y));
  const originPose = originState?.result?.pose || null;
  const originDistance = originPose && finalPose && Number.isFinite(finalPose.x) && Number.isFinite(finalPose.y)
    ? Math.hypot(finalPose.x - originPose.x, finalPose.y - originPose.y) : null;
  const originVerified = requirements.return_mode !== 'task_origin' ||
    (originPose && originDistance !== null && originDistance <= 0.35);
  const poseNearOrigin = (pose: any) => Boolean(originPose && pose && Number.isFinite(pose.x) && Number.isFinite(pose.y) &&
    Math.hypot(pose.x - originPose.x, pose.y - originPose.y) <= 0.35);
  const originNavigationVerified = navigation.some((event, index) => {
    if (!isOriginTarget(event.result?.target) || !succeeded(event.result)) return false;
    if (poseNearOrigin(event.result?.final_pose)) return true;
    const start = scopedEvents.indexOf(event);
    const nextNavigation = scopedEvents.findIndex((candidate, candidateIndex) => candidateIndex > start && baseTool(candidate.tool) === 'navigate_to');
    return states.some(state => {
      const stateIndex = scopedEvents.indexOf(state);
      return stateIndex > start && (nextNavigation < 0 || stateIndex < nextNavigation) && poseNearOrigin(state.result?.pose);
    });
  });
  // A door task can start at its approach. Certify this only with this
  // turn's stationary ROS pose, current-map geometry, frame-backed inspection
  // and measured opening; a map prior or report alone cannot replace arrival.
  const poseNear = (pose: any, target: any, radius: number) => pose?.frame_id === "map"
    && [pose.x, pose.y, target?.x, target?.y].every(Number.isFinite)
    && Math.hypot(pose.x-target.x, pose.y-target.y) <= radius;
  const approachEvents = doorChecks.filter(d=>d.open_verified).flatMap(d=>{
    const target=map?.doors.find(item=>item.id===d.door_id)?.interaction_pose;
    if (!target) return [];
    return toolResults.filter(inspect=>{
      const v=objectResult(inspect.result), index=scopedEvents.indexOf(inspect);
      if (baseTool(inspect.tool)!=="inspect_door" || !succeeded(v) || v.door_id!==d.door_id
          || v.evidence?.near_interaction_pose!==true || !poseNear(v.robot_pose,target,1.6)) return false;
      const lastMotion=scopedEvents.slice(0,index).findLastIndex(e=>baseTool(e.tool)==="navigate_to");
      return states.some(state=>{
        const stateIndex=scopedEvents.indexOf(state);
        const age=Date.parse(inspect.timestamp||"")-Date.parse(state.timestamp||"");
        return stateIndex>lastMotion && stateIndex<index && Number.isFinite(age) && age>=0 && age<=30000
          && state.result.navigation_active===false
          && state.result.linear_velocity===0 && state.result.angular_velocity===0
          && poseNear(state.result.pose,v.robot_pose,.25);
      });
    }).map(event=>({event,target:d.interaction_location}));
  });
  const rawNavigation = toolResults.filter(event=>baseTool(event.tool)==="navigate_to");
  const reachedTargets = scopedEvents.flatMap(event=>{
    const navIndex = rawNavigation.indexOf(event);
    const nav = navIndex >= 0 ? navigation[navIndex] : null;
    if (nav && succeeded(nav.result)) return [semanticNavigationTarget(nav.result)];
    return approachEvents.filter(item=>item.event===event).map(item=>item.target);
  }).filter(Boolean);
  const requiredLocations = requirements.required_locations;
  const canonicalRequiredLocations = requiredLocations.map(canonicalTarget);
  const requiredLocation = requiredLocations.at(-1) || null;
  const locationChecks = requiredLocations.map(target => ({
    target,
    navigation_success: navigationSuccess.some(e => reachedTarget(e.result, target)),
    approach_pose_verified: approachEvents.some(item=>item.target===target),
    // A successful NavigateToPose result is itself terminal evidence that the
    // requested semantic target was reached.  A later robot-state sample is
    // still accepted when available, but is not required to certify the same
    // completed action.
    location_verified: isOriginTarget(target)
      ? originNavigationVerified
      : navigationSuccess.some(e => reachedTarget(e.result, target)) || states.some(e => e.result?.current_location === target) || approachEvents.some(item=>item.target===target),
  }));
  const sequenceVerified = isOrderedSubsequence(approachEvents.length ? reachedTargets : successfulNavigationTargets, canonicalRequiredLocations);
  const finalLocationVerified = requirements.return_mode === 'task_origin'
    ? Boolean(isOriginTarget(finalNavigation?.target) && originVerified)
    : !requiredLocation || finalLocation === requiredLocation || reachedTarget(finalNavigation, requiredLocation)
      || approachEvents.some(item=>item.target===requiredLocation
        && !scopedEvents.slice(scopedEvents.indexOf(item.event)+1).some(e=>baseTool(e.tool)==="navigate_to")
        && poseNear(finalState?.pose,map?.doors.find(d=>d.interaction_location===requiredLocation || d.id+"_interaction"===requiredLocation)?.interaction_pose,1.6));
  const returnNavigationSatisfied = !requirements.return_required || (
    requirements.final_return_required
      ? reachedTarget(finalNavigationAttempt, requirements.final_return_target) && succeeded(finalNavigationAttempt) && finalLocationVerified
      : navigationSuccess.some(e => reachedTarget(e.result, requirements.final_return_target))
  );
  const finalReturnSatisfied = returnNavigationSatisfied;
  const locationSatisfied = !requirements.needsNavigation || (requiredLocations.length === 0
    ? navigationSuccess.length > 0
    : sequenceVerified && locationChecks.every(item => (item.navigation_success || item.approach_pose_verified) && item.location_verified) && finalLocationVerified && finalReturnSatisfied);
  // A free-standing person/object reinspection has no implied room target.
  // Do not silently bind it to the mission's last navigation objective (often
  // Start); only an explicitly extracted inspection location is restrictive.
  const inspectionTarget = requirements.inspection_target;
  const inspectionSatisfied = !requirements.required_inspection || roomInspectionSuccess.some(e => {
    const room = e.result?.room || e.result?.location;
    return !inspectionTarget || room === inspectionTarget;
  }) || inspectionSuccess.some(e => !inspectionTarget || e.result?.room === inspectionTarget || e.result?.location === inspectionTarget);
  const reportHasLocation = !requirements.required_report_location || Boolean(requiredLocation && new RegExp(requiredLocation, 'i').test(report || ''));
  const forbiddenNavigation = navigationSuccess.filter(e => constraints.forbidden_locations.includes(e.result?.target));
  const forbiddenInspection = constraints.forbidden_actions.some(action => ['inspect_room', 'inspect_object'].includes(action)) ? inspections : [];
  const personSearch = toolCalls.filter(e => String(e.tool || '').includes('mcp_robot_mcp_') && /person|search|find|寻找|搜索|人员|研究员/iu.test(baseTool(e.tool)) && !['get_robot_state', 'get_world_state', 'world_memory_get'].includes(baseTool(e.tool)));
  const forbiddenPersonSearch = constraints.forbidden_actions.includes('person_search') ? personSearch : [];
  const forbiddenDoorOpenings = constraints.forbidden_actions.includes('open_door') ? doorOpenResults.filter(e=>succeeded(e.result)) : [];
  const violations = [
    ...forbiddenDoorOpenings.map(e=>({type:'forbidden_action',action:'open_door',result:e.result})),
    ...forbiddenNavigation.map(e => ({ type: 'forbidden_location', target: e.result?.target, result: e.result })),
    ...forbiddenInspection.map(e => ({ type: 'forbidden_action', action: baseTool(e.tool), result: e.result })),
    ...forbiddenPersonSearch.map(e => ({ type: 'forbidden_action', action: 'person_search', tool: baseTool(e.tool), result: e.result })),
  ];
  // A final report may truthfully mention a recovered Nav2 incident as a
  // risk.  Do not treat the literal error label as an unresolved outcome;
  // unresolved failures are decided from terminal events and explicit
  // incomplete language below.  This keeps report prose from overriding the
  // real action/evaluator evidence.
  const embeddedProviderFailure = /\[assistant turn failed:\s*provider error\b/iu.test(report || '');
  const reportFailure = embeddedProviderFailure || /cannot complete|unable to|navigation (?:failed|unavailable)|unable to inspect|无法完成|无法移动|导航子系统.*异常|不能完成|无法检查|not at location|任务状态\s*[：:]\s*(?:部分完成|失败)|任务部分完成|无法继续.*(?:返回|导航)|未能(?:返回|进入|搜索)/iu.test(report || '');
  const reportProgressOnly = /(?:let me|need to|still need|remaining.{0,20}(?:survey|inspect|search)|接下来.{0,20}(?:检查|搜索|查看)|还需要.{0,20}(?:检查|搜索|查看)|仍需.{0,20}(?:检查|搜索|查看)|让我.{0,20}(?:继续|完成|检查))/iu.test(report || '');
  const riskReportSatisfied = !requirements.risk_report_required || riskReportComplete(report, scopedEvents);
  const unresolvedNavigation = navigation.some(event => {
    const result = objectResult(event.result);
    return result.status === 'PENDING' || result.terminal_known === false ||
      (['ACCEPTED', 'EXECUTING', 'CANCELING', 'CANCELLED'].includes(result.action_status) && result.terminal_known !== true);
  });
  const targetObserved = hasPersonEvidence(scopedEvents);
  const dynamicBlock = scopedEvents.some(e => hasBlockedRouteEvidence(e.result));
  const worldStateReplan = toolResults.some(e => {
    const result = objectResult(e.result);
    return baseTool(e.tool) === 'get_world_state' && hasBlockedRouteEvidence(e.result) && ((result.navigation_attempts?.length || 0) > 1 || (result.visited_locations?.length || 0) > 2);
  });
  const blockedIndex = toolResults.findIndex(e => ['navigate_to', 'get_world_state'].includes(baseTool(e.tool)) && hasBlockedRouteEvidence(e.result));
  const subsequentNavigation = blockedIndex >= 0 && toolResults.slice(blockedIndex + 1).some(e => baseTool(e.tool) === 'navigate_to' && succeeded(e.result));
  const reportReplan = dynamicBlock && /replan|重规划|绕行|替代路线|alternative route|侧走廊|越过/iu.test(report || '');
  const replanObserved = scopedEvents.some(e => baseTool(e.tool) === 'world_memory_update' && succeeded(e.result)) || worldStateReplan || reportReplan || (dynamicBlock && subsequentNavigation) || (dynamicBlock && successfulNavigationTargets.length >= 3 && new Set(successfulNavigationTargets).size >= 3);
  const causalReplanProven = causalEvidence?.causal_replan_proven === true && causalEvidence?.dynamic_event_evidence === true && causalEvidence?.onboard_detection === true && causalEvidence?.global_costmap_marked === true && causalEvidence?.old_path_invalidated === true && causalEvidence?.new_path_geometry_differs === true && causalEvidence?.pose_history_follows_new_path === true;
  const activePerception = scopedEvents.some(e => baseTool(e.tool) === 'inspect_object' && succeeded(e.result));
  const searchResults = toolResults.filter(e => baseTool(e.tool) === 'world_memory_update' && succeeded(e.result));
  const latestMemory = searchResults.at(-1)?.result || {};
  const unresolvedSearch = Array.isArray(latestMemory.blocked_routes) && latestMemory.blocked_routes.length > 0 || Array.isArray(latestMemory.current_plan) && latestMemory.current_plan.some((step: any) => step?.status === 'blocked' || step?.status === 'pending');
  const searchSatisfied = !requirements.person_search_required || (targetObserved && !unresolvedSearch && (!requirements.final_return_required || finalReturnSatisfied));
  const reinspectionSatisfied = !requirements.reinspection_required || activePerception;
  const rescueEvidence = requirements.rescue_task && targetObserved && report.length > 40 && (!requirements.dynamic_event_required || (dynamicBlock && replanObserved && causalReplanProven));
  const navigationSystemUnhealthy = navigationFailures.filter(navigationHealthFailure).length >= 3;
  const ambiguousReference = requirements.return_mode === 'ambiguous';
  const complete = !turnError && !stopped && !ambiguousReference && !requirements.navigation_target_missing && !reportFailure && !reportProgressOnly && !unresolvedNavigation && riskReportSatisfied && !navigationSystemUnhealthy && violations.length === 0 && locationSatisfied && doorOpeningSatisfied && inspectionSatisfied && reportHasLocation && searchSatisfied && reinspectionSatisfied && (!requirements.rescue_task || rescueEvidence);
  const progress = navigationSuccess.length > 0 || inspectionSuccess.length > 0 || doorChecks.some(d=>d.open_verified) || targetObserved;
  const status = stopped ? 'CANCELED' : complete ? 'SUCCEEDED' : progress ? 'PARTIAL' : 'FAILED';
  const reasons = [
    ...(turnError ? ['REAL_LLM_TURN_FAILED'] : []),
    ...(navigationSystemUnhealthy ? ['NAVIGATION_SYSTEM_UNHEALTHY'] : []),
    ...(!sequenceVerified && requiredLocations.length ? ['REQUIRED_NAVIGATION_SEQUENCE_NOT_CONFIRMED'] : []),
    ...(!locationSatisfied && requirements.needsNavigation ? ['TARGET_LOCATION_NOT_VERIFIED'] : []),
    ...(!doorOpeningSatisfied ? ['REQUIRED_DOOR_OPEN_NOT_CONFIRMED'] : []),
    ...(requirements.required_inspection && !inspectionSatisfied ? ['REQUIRED_INSPECTION_NOT_CONFIRMED'] : []),
    ...(requirements.required_report_location && !reportHasLocation ? ['FINAL_REPORT_LOCATION_NOT_CONFIRMED'] : []),
    ...(requirements.final_return_required && !finalReturnSatisfied ? ['FINAL_RETURN_NOT_CONFIRMED'] : []),
    ...(ambiguousReference ? ['AMBIGUOUS_RETURN_REFERENCE'] : []),
    ...(requirements.navigation_target_missing ? ['NAVIGATION_TARGET_NOT_EXPLICIT'] : []),
    ...(requirements.person_search_required && !searchSatisfied ? ['REQUIRED_SEARCH_NOT_CONFIRMED'] : []),
    ...(requirements.reinspection_required && !reinspectionSatisfied ? ['REINSPECTION_NOT_CONFIRMED'] : []),
    ...(violations.length ? ['FORBIDDEN_CONSTRAINT_VIOLATED'] : []),
    ...(reportFailure ? ['FINAL_REPORT_SAYS_INCOMPLETE'] : []),
    ...(embeddedProviderFailure ? ['AGNES_EMBEDDED_PROVIDER_FAILURE'] : []),
    ...(reportProgressOnly ? ['FINAL_REPORT_IS_PROGRESS_ONLY'] : []),
    ...(requirements.risk_report_required && !riskReportSatisfied ? ['RISK_REPORT_NOT_GROUNDED_OR_INCOMPLETE'] : []),
    ...(unresolvedNavigation ? ['NAVIGATION_TERMINAL_UNKNOWN'] : []),
    ...(requirements.dynamic_event_required && !dynamicBlock ? ['RESCUE_DYNAMIC_BLOCK_NOT_CONFIRMED'] : []),
    ...(requirements.dynamic_event_required && !replanObserved ? ['RESCUE_REPLAN_NOT_CONFIRMED'] : []),
    ...(requirements.dynamic_event_required && !causalReplanProven ? ['CAUSAL_REPLAN_NOT_PROVEN'] : []),
    ...(requirements.rescue_task && !activePerception ? ['RESCUE_ACTIVE_PERCEPTION_NOT_CONFIRMED'] : []),
    ...(requirements.rescue_task && !targetObserved ? ['RESCUE_PERSON_OBSERVATION_NOT_CONFIRMED'] : []),
    ...(requirements.rescue_task && !rescueEvidence ? ['RESCUE_EVIDENCE_NOT_CONFIRMED'] : []),
  ];
  const evidence = {
    doors: doorChecks,
    navigation: { attempts: navigation.map(e => e.result), successful_targets: successfulNavigationTargets, required_sequence: requiredLocations, sequence_verified: sequenceVerified, approach_observations: approachEvents.map(item=>({target:item.target,pose:item.event.result?.robot_pose})), final_pose: finalPose, final_location: finalLocation, location_checks: locationChecks },
    inspections: { all: inspections.map(e => ({ tool: baseTool(e.tool), result: e.result })), successful: inspectionSuccess.map(e => ({ tool: baseTool(e.tool), result: e.result })), successful_inspections: roomInspectionSuccess.map(e => e.result) },
    final_pose: { pose: finalPose, location: finalLocation, report_has_location: reportHasLocation, task_origin_pose: originPose, distance_to_task_origin: originDistance, task_origin_verified: originVerified },
    constraints: { violations, forbidden_navigation: forbiddenNavigation.map(e => e.result) },
    rescue: { dynamic_block: dynamicBlock, replan_observed: replanObserved, causal_replan_proven: causalReplanProven, dynamic_event_evidence: causalEvidence?.dynamic_event_evidence === true, active_perception: activePerception, person_observed: targetObserved, search_satisfied: searchSatisfied, reinspection_satisfied: reinspectionSatisfied },
  };
  const decision = { status, reasons };
  return {
    status,
    runner_state: turnError ? 'RUNNER_FAILED' : 'RUNNER_COMPLETED',
    runner_exit_does_not_imply_success: true,
    requirements,
    constraints,
    objective: { needs_navigation: requirements.needsNavigation, required_location: requiredLocation, location_verified: locationSatisfied, needs_inspection: requirements.required_inspection, inspection_verified: inspectionSatisfied, report_location_verified: reportHasLocation, target_observed: targetObserved, rescue_evidence: requirements.rescue_task ? rescueEvidence : null },
    counts: { navigation: navigation.length, navigation_success: navigationSuccess.length, navigation_failures: navigationFailures.length, inspect_room: roomInspections.length, inspect_room_success: roomInspectionSuccess.length, inspect_object: inspections.filter(e => baseTool(e.tool) === 'inspect_object').length },
    navigation_system_unhealthy: navigationSystemUnhealthy,
    report_failure: reportFailure,
    report_progress_only: reportProgressOnly,
    risk_report_satisfied: riskReportSatisfied,
    unresolved_navigation: unresolvedNavigation,
    evidence,
    decision,
    reasons,
  };
}

export const missionOutcomeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['status', 'runner_state', 'runner_exit_does_not_imply_success', 'requirements', 'constraints', 'evidence', 'decision', 'reasons'],
  properties: {
    status: { enum: ['SUCCEEDED', 'PARTIAL', 'FAILED', 'FAILED_PRECHECK', 'CANCELED'] },
    runner_state: { enum: ['RUNNER_COMPLETED', 'RUNNER_FAILED'] },
    runner_exit_does_not_imply_success: { const: true },
    requirements: { type: 'object' }, constraints: { type: 'object' }, evidence: { type: 'object' }, decision: { type: 'object' }, reasons: { type: 'array' },
  },
};
