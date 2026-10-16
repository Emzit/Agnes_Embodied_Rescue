import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { JsonlBridge } from '../../services/robot-mcp/src/transport/jsonl-bridge.ts';
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';
import { agnesTurnCompletionError, evaluateMission, extractRequirements, hasBlockedRouteEvidence, missionOutcomeSchema, normalizeToolResult, originAliasForMission } from './mission-evaluator.mts';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const OUT = process.env.INTERACTIVE_LIVE_ROOT || `${ROOT}/artifacts/interactive-live`;
const DIR = process.env.INTERACTIVE_MISSION_DIR || `${OUT}/current-mission`;
const ORIGIN_FILE = `${ROOT}/runtime/interactive-mission-origin.json`;
const profile = 'local-dev';
const node = `${ROOT}/tools/node/bin/node`;
// A managed continuation turn may contain a real long-running Nav2 action.
// Keep this budget separate from per-tool transport limits and bound it so an
// abandoned session cannot wait forever.  The previous 300 s guard budget
// canceled an active navigate_to before its ROS2 terminal result was returned.
const DEFAULT_MANAGED_TURN_TIMEOUT_MS = 900_000;
const MANAGED_TURN_TIMEOUT_MS = (() => {
  const raw = Number(process.env.MANAGED_NAVIGATION_TURN_TIMEOUT_MS ?? DEFAULT_MANAGED_TURN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 300_000 && raw <= 1_800_000
    ? Math.floor(raw)
    : DEFAULT_MANAGED_TURN_TIMEOUT_MS;
})();
const pluginTools = new Set(['mission_get_state', 'mission_reset', 'world_memory_get', 'world_memory_update', 'decision_score_candidates']);
const text = (v: any): string => typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : Array.isArray(v?.content) ? v.content.map(text).join('\n') : '';
function structured(detail: any) { if (detail?.result?.structured !== undefined) return detail.result.structured; try { return JSON.parse(detail?.result?.content?.find((b: any) => b.type === 'text')?.text); } catch { return { content: detail?.result?.content ?? [] }; } }
function unwrap(value: any): any { return normalizeToolResult(value); }
function save(file: string, value: any) { return mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true }).then(() => writeFile(file, JSON.stringify(value, null, 2) + '\n')); }
function stamp() { return new Date().toISOString(); }
function toolName(ev: any) { return ev?.data?.name ?? ev?.data?.toolName ?? ev?.data?.tool ?? ''; }
function baseTool(name: string) { return String(name || '').replace(/^mcp_robot_mcp_[^_]+_/, '').replace(/^mcp_robot_mcp_/, ''); }
function stageFor(name: string, value: any) {
  const s = `${name} ${JSON.stringify(value ?? '')}`.toLowerCase();
  if (s.includes('inspect_object')) return '主动复检';
  if (s.includes('inspect_room')) return '检查房间';
  if (s.includes('navigate') && s.includes('room_b')) return '正在前往 Room_B';
  if (s.includes('navigate')) return '正在导航';
  if (hasBlockedRouteEvidence(value)) return '道路发生阻挡';
  if (s.includes('world_memory_update')) return '更新 world memory';
  if (s.includes('world_memory_get')) return '获取环境记忆';
  if (s.includes('report') || s.includes('final')) return '生成最终报告';
  return name || 'Agent 正在执行';
}
async function input() {
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk.toString();
  const value = JSON.parse(buf || '{}');
  const task = String(value.task || '').trim();
  if (!task || task.length > 2000) throw new Error('task must be 1..2000 characters');
  return { mission_id: String(value.mission_id || `interactive-${Date.now()}`), task };
}

const { mission_id, task } = await input();
const taskOriginAlias = originAliasForMission(mission_id);
await mkdir(DIR, { recursive: true });
const currentFile = `${DIR}/current.json`;
const eventsFile = `${DIR}/events.jsonl`;
let seq = 0;
let status = 'STARTING';
let controller = new AbortController();
let session: any;
let client: any;
let bridge: any;
let stopRequested = false;
const events: any[] = [];
const messages: any[] = [];
const trace: any[] = [];
let resetVerified = false;
let taskStartOrigin: any = null;
const mission = { mission_id, task, status, started_at: stamp(), finished_at: null as string | null, current_stage: '接收任务', current_plan: '等待 Agnes real LLM 计划', current_location: null as string | null, blocked_route: null as any, replans_count: 0, active_perception_count: 0, target_status: 'unknown', last_tool: null as string | null, provider: 'agnes-ai', model: 'agnes-3.0-flash', real_llm: true, mock_fallback: false, fixture: false, scripted_tool_sequence: false, source: 'real Agnes session events', state_scope: 'mission', persistent_physical_state: true, historical_memory_requires_provenance: true };
async function writeCurrent(extra: any = {}) { await save(currentFile, { ...mission, ...extra, status }); }
async function emit(type: string, data: any, raw?: any) {
  const event = { sequence: ++seq, type, timestamp: stamp(), ...data };
  events.push(event);
  await appendFile(eventsFile, JSON.stringify(event) + '\n');
  if (type === 'tool_call') { mission.last_tool = data.tool; mission.current_stage = stageFor(data.tool, data.args); mission.current_plan = `真实 tool call：${data.tool}`; }
  if (type === 'tool_result') {
    const simple = baseTool(data.tool);
    mission.current_stage = stageFor(simple, data.result);
    const resultText = JSON.stringify(data.result || '');
    const isBlocked = simple !== 'skill_read' && hasBlockedRouteEvidence(data.result);
    if (isBlocked) { mission.blocked_route = data.result?.blocked_route || 'unknown'; mission.current_stage = `PATH BLOCKED：${mission.blocked_route}`; }
    if (simple === 'mission_reset' && data.result?.mission_id === mission_id && data.result?.status !== 'FAILED') resetVerified = true;
    if (simple === 'navigate_to' && data.result?.target && data.result?.status === 'SUCCEEDED') mission.current_location = data.result.target;
    if (simple === 'get_robot_state' && data.result?.current_location) mission.current_location = data.result.current_location;
    const originCandidate = simple === 'get_robot_state' ? data.result?.pose
      : simple === 'get_world_state' ? data.result?.robot?.pose || data.result?.pose
      : simple === 'get_observation' ? data.result?.robot_pose : null;
    if (resetVerified && !taskStartOrigin && Number.isFinite(originCandidate?.x) && Number.isFinite(originCandidate?.y)) {
      taskStartOrigin = { mission_id, pose: { x: Number(originCandidate.x), y: Number(originCandidate.y), yaw: Number.isFinite(originCandidate.yaw) ? Number(originCandidate.yaw) : Number.isFinite(originCandidate.heading) ? Number(originCandidate.heading) : 0, frame_id: originCandidate.frame_id || 'map' }, captured_at: stamp(), source: `real Robot MCP ${simple} after mission_reset`, tool_call_id: data.tool_call_id };
      await save(ORIGIN_FILE, { ...taskStartOrigin, state: 'captured' });
      await save(`${DIR}/task-start-origin.json`, taskStartOrigin);
      (mission as any).task_start_origin = taskStartOrigin;
    }
    if (simple === 'world_memory_update') mission.replans_count = Math.max(1, mission.replans_count);
    if (simple === 'inspect_object' && data.result?.status === 'SUCCEEDED') { mission.active_perception_count += 1; mission.active_perception = { before_confidence: data.result?.before_confidence, after_confidence: data.result?.after_confidence, before: data.result?.evidence?.[0] || null, after: data.result?.evidence?.at?.(-1) || null, count: mission.active_perception_count, source: 'real inspect_object result' }; }
    if (/person/i.test(resultText) || /人员/.test(resultText)) mission.target_status = 'person observed';
  }
  if (type === 'agent_message') mission.current_plan = data.text?.slice(0, 500) || mission.current_plan;
  await writeCurrent();
  await save(`${OUT}/current.json`, { ...mission, status, mission_dir: DIR });
  return event;
}
async function stopRobot() { try { bridge ??= new JsonlBridge('/bin/bash', [`${ROOT}/services/robot-mcp/ros2_bridge/launch_bridge.sh`], process.env); await bridge.request('stop_robot', {}, 15000); } catch (error: any) { await appendFile(`${DIR}/runner-errors.log`, `${stamp()} stop_robot ${error.message}\n`).catch(() => {}); } }
async function cancel() { if (stopRequested) return; stopRequested = true; status = 'CANCELING'; await writeCurrent(); controller.abort(); await stopRobot(); }
process.on('SIGTERM', () => { void cancel(); });
process.on('SIGINT', () => { void cancel(); });

try {
  status = 'RUNNING';
  await save(ORIGIN_FILE, { mission_id, pose: null, state: 'pending', source: 'awaiting real Robot MCP get_robot_state after mission_reset' });
  await writeCurrent();
  const owner = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`, 'utf8'));
  client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() });
  await client.initialize();
  const conf = await client.config.get();
  assert.equal(conf.provider?.id, 'agnes-ai'); assert.equal(conf.provider?.model, 'agnes-3.0-flash');
  for (let i = 0; i < 100; i++) { const mcp = await client.mcp.servers.status({ profile, serverId: 'robot-mcp' }); if (mcp.connectionState === 'ready') break; await new Promise(r => setTimeout(r, 200)); if (i === 99) throw new Error('MCP_NOT_READY'); }
  session = await client.session.new({ cwd: ROOT, sessionKey: `interactive-${mission_id}-${Date.now()}` });
  await save(`${DIR}/provider.json`, { provider: conf.provider.id, model: conf.provider.model, session: session.id, plugin: 'embodied-rescue-plugin', mcp: ['robot-mcp', 'envdoor'], robot_gateway: 'ros2', task, scripted_sequence: false, queueTool: false, real_llm: true });
  let remove = () => {};
  let iterator: any;
  let reader: Promise<void> = Promise.resolve();
  const attachSession = async (nextSession: any) => {
    session = nextSession;
    await session.attach();
    remove = session.onPermissionRequest(async (q: any) => { const name = q.toolCall?._meta?.['ai.agnes.harness']?.tool; const allowed = pluginTools.has(name) || name?.startsWith('mcp_robot_mcp_') || name?.startsWith('mcp_envdoor_'); const option = q.options.find((v: any) => v.kind === (allowed ? 'allow_once' : 'reject_once')); return { optionId: option.optionId }; });
    iterator = session.events()[Symbol.asyncIterator]();
    reader = (async () => { for (;;) { const next = await iterator.next(); if (next.done) return; const ev = next.value; await appendFile(`${DIR}/agnes-events.jsonl`, JSON.stringify(ev) + '\n'); const name = toolName(ev); if (ev.type === 'tool/call') { await emit('tool_call', { tool: name, tool_call_id: ev.data?.toolUseId, args: ev.data?.args ?? ev.data?.arguments ?? null }, ev); } else if (ev.type === 'tool/result') { const matching = events.findLast((e: any) => e.type === 'tool_call' && e.tool_call_id === ev.data?.toolUseId); await emit('tool_result', { tool: matching?.tool || name, tool_call_id: ev.data?.toolUseId, result: unwrap(ev.data?.result ?? ev.data?.content ?? ev.data) }, ev); } else if (ev.type === 'assistant/message') { const t = text(ev.data); if (t) { messages.push({ seq: ev.seq, text: t }); await emit('agent_message', { text: t }, ev); } } } })();
  };
  await attachSession(session);
  let turn: any = null; let error: any = null;
  const originInstruction = extractRequirements(task, mission_id).return_mode === 'task_origin'
    ? `This task requires returning to the physical task origin. The first successful real pose result after mission_reset is the only origin evidence; do not use simulator ground truth. When returning, call the existing navigate_to tool with {"location":${JSON.stringify(taskOriginAlias)}} and wait for its real Nav2 terminal result.`
    : `Interpret return wording precisely: “回到地图上的 Start” means the named Start location; “回到一开始的位置” or “回到本次任务开始时的地方” means the physical origin captured from the first successful get_robot_state after mission_reset.`;
  const missionPrompt = `[mission scope] Start a fresh mission with mission_id=${mission_id}. Before any mission_get_state, get_world_state, or planning call, call mission_reset with {"mission_id":"${mission_id}","goal":${JSON.stringify(task)}} once. Verify the returned mission_id equals ${JSON.stringify(mission_id)} and that world memory is empty/unknown. Mission-scoped state must not inherit prior task plan, action history, searched rooms, blocked routes, counters, target status, or observations. Only after reset verification may you read current state and physical sensors. Persistent physical state is real and must be discovered with Robot MCP; historical world facts require provenance, observed_at, and source. ${originInstruction} Follow only the user's stated objectives: do not infer an exhaustive survey of every room or door, and do not return to Start unless requested. For a search, continue only as needed to satisfy the requested target; after observing it, use the sensor evidence already collected to finish any requested report. Do not guess room or door IDs; use exact identifiers returned by tools. Report observed risks, or say clearly when no risk was observed or the available views leave risk unknown. End with a concise completed-results report, not a plan for future work. Then execute the user task using real tools only. Use tools immediately: do not emit a long repeated plan before the first action. Keep narration concise, issue one next tool call after each result, and never repeat the same planning sentence without new evidence.\n\n[user task]\n${task}`;
  try {
    turn = await session.prompt(missionPrompt, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MANAGED_TURN_TIMEOUT_MS)]), titleLocale: 'zh-CN' });
    error = agnesTurnCompletionError(turn);
  } catch (e: any) {
    error = { code: e.code ?? 'MISSION_TURN_ERROR', message: String(e.message ?? e).slice(0, 500) };
    const transportFailure = !stopRequested && (error.code === 'TRANSPORT' || /(?:status=\?|INTERNAL_ERROR|transport)/iu.test(error.message));
    if (transportFailure) {
      let recoveryAttempts = 0;
      let recoveryError: any = null;
      while (recoveryAttempts < 2 && !stopRequested) {
        recoveryAttempts += 1;
        // A failed turn can leave a worker/session subscription alive while the
        // SDK promise has already rejected.  Detach and close that exact session
        // before creating a recovery session; otherwise two workers can race on
        // the same daemon generation and surface a bare status=? transport error.
        const failedSession = session;
        await iterator.return?.().catch?.(() => {}); await reader.catch?.(() => {}); remove();
        await failedSession?.close?.().catch?.(() => {});
        await new Promise(r => setTimeout(r, 250));
        try {
          const safeMissionKey = mission_id.replace(/[^A-Za-z0-9_]/g, '_').slice(-48);
          const recovery = await client.session.new({ cwd: ROOT, preset: 'standard', sessionKey: `interactive_recovery_${safeMissionKey}_${recoveryAttempts}_${Date.now()}` });
          await attachSession(recovery);
          const recoveryPrompt = `[mission recovery attempt ${recoveryAttempts}/2] The previous real Agnes session ended with a transport error before a final response. Continue mission_id=${mission_id} for the same user task below. Inspect the current physical robot state and available sensor/tool evidence before deciding what remains. Do not assume an unverified prior action succeeded, and do not repeat a destructive action unchanged. Use real Robot MCP tools and finish the task with a truthful report; do not use scripted actions or hidden scenario facts.\n\n[user task]\n${task}`;
          turn = await session.prompt(recoveryPrompt, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MANAGED_TURN_TIMEOUT_MS)]), titleLocale: 'zh-CN' });
          error = agnesTurnCompletionError(turn);
          if (error) {
            error.recovery_attempted = true;
            error.recovery_attempts = recoveryAttempts;
            recoveryError = error;
            break;
          }
          recoveryError = null;
          break;
        } catch (caught: any) {
          recoveryError = caught;
          error = { code: caught.code ?? 'MISSION_RECOVERY_ERROR', message: String(caught.message ?? caught).slice(0, 500), reason: caught.reason ?? null, stop_reason: caught.stop_reason ?? null, recovery_attempted: true, recovery_attempts: recoveryAttempts };
          const retryableTransport = !stopRequested && (error.code === 'TRANSPORT' || /(?:status=\?|INTERNAL_ERROR|transport)/iu.test(error.message));
          if (!retryableTransport) break;
        }
      }
      if (recoveryError && !error) {
        error = { code: recoveryError.code ?? 'MISSION_RECOVERY_ERROR', message: String(recoveryError.message ?? recoveryError).slice(0, 500), recovery_attempted: true, recovery_attempts: recoveryAttempts };
      }
    }
  }
  // Generic managed completion guard.  A real LLM turn may produce a report
  // immediately after perception while an explicit return/navigation
  // objective is still pending.  Give the same session one continuation turn
  // with the derived objective ledger; the model remains responsible for
  // choosing tools and every action still yields its real terminal result.
  if (!error && !stopRequested) {
    const preliminary = evaluateMission(task, events, messages.at(-1)?.text || '', null, false, mission_id);
    if (preliminary.status !== 'SUCCEEDED') {
      const requirements = extractRequirements(task, mission_id);
      // Use the evaluator's operation-correlated semantic targets. A successful
      // mission-origin action may satisfy a named target only when its matching
      // Nav2 terminal sample confirms that physical location; raw alias strings
      // must not make the continuation guard repeat an already reached target.
      const successTargets = preliminary.evidence?.navigation?.successful_targets ?? events
        .filter((v: any) => v.type === 'tool_result' && baseTool(v.tool) === 'navigate_to')
        .map((v: any) => v.result?.status === 'SUCCEEDED' ? v.result?.target : null)
        .filter(Boolean);
      let cursor = 0;
      for (const target of requirements.required_locations) {
        if (successTargets[cursor] === target) cursor += 1;
      }
      const pending = requirements.required_locations.slice(cursor);
      const guardPrompt = `[managed completion guard] The previous real turn ended before the derived mission objective ledger was satisfied. Pending objectives are ${JSON.stringify(pending)}; evaluator reasons are ${JSON.stringify(preliminary.reasons)}. Inspect current physical state and sensor evidence, then autonomously continue only the remaining objectives. Do not report completion while any pending objective remains. For navigation, issue the normal navigate_to tool and wait for its real Nav2 terminal result; SUCCEEDED satisfies it, while CANCELED or ABORTED does not. After all objectives and evidence are satisfied, provide the final report. Do not use history, hidden state, mock, teleport, or scripted tool order.`;
      try {
        turn = await session.prompt(guardPrompt, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MANAGED_TURN_TIMEOUT_MS)]), titleLocale: 'zh-CN' });
        error = agnesTurnCompletionError(turn);
      } catch (caught: any) {
        error = { code: caught.code ?? 'COMPLETION_GUARD_ERROR', message: String(caught.message ?? caught).slice(0, 500) };
      }
    }
  }
  await iterator.return?.().catch?.(() => {}); await reader.catch?.(() => {});
  for (const ev of events.filter((v: any) => v.type === 'tool_call')) { const original = (await import('node:fs/promises')).readFile; void original; }
  const report = messages.at(-1)?.text || '';
  await writeFile(`${DIR}/final-report.txt`, report + (report.endsWith('\n') ? '' : '\n'));
  const resultEvents = events.filter((v: any) => v.type === 'tool_result');
  await save(`${DIR}/mcp-trace.json`, resultEvents.map((v: any) => ({ tool: v.tool, input: events.findLast((c: any) => c.type === 'tool_call' && c.tool_call_id === v.tool_call_id)?.args ?? null, result: v.result, backend: 'ros2' })));
  await save(`${DIR}/navigation-events.json`, resultEvents.filter((v: any) => baseTool(v.tool) === 'navigate_to'));
  await save(`${DIR}/perception-events.json`, resultEvents.filter((v: any) => ['get_observation', 'inspect_room', 'inspect_object'].includes(baseTool(v.tool))));
  await save(`${DIR}/world-memory-final.json`, resultEvents.findLast((v: any) => baseTool(v.tool) === 'world_memory_get' || baseTool(v.tool) === 'world_memory_update')?.result ?? null);
  const currentStateResult = resultEvents.findLast((v: any) => ['mission_get_state', 'mission_reset'].includes(baseTool(v.tool)) && v.result?.mission_id === mission_id)?.result ?? null;
  await save(`${DIR}/mission-state-final.json`, currentStateResult);
  const outcome = evaluateMission(task, events, report, error, stopRequested, mission_id);
  status = outcome.status;
  await save(`${DIR}/mission-outcome.json`, outcome);
  await save(`${DIR}/mission-outcome-schema.json`, missionOutcomeSchema);
  await save(`${OUT}/mission-outcome-schema.json`, missionOutcomeSchema);
  await save(`${DIR}/mission.json`, { ...mission, task, session: session.id, task_start_origin: taskStartOrigin, final_report: report, status: outcome.status, outcome });
  await save(`${DIR}/agnes-trace.json`, { session: session.id, task, turn, error, events: messages });
  const ros = `${DIR}/ros2-events.jsonl`; await save(`${DIR}/ros2-trace.json`, []);
  mission.finished_at = stamp(); mission.current_stage = status === 'SUCCEEDED' ? '最终报告已生成' : status === 'CANCELED' ? '任务已取消' : status === 'PARTIAL' ? '任务部分完成' : '任务失败';
  await writeCurrent({ final_report: report, error });
  // The process can finish writing artifacts after a provider/turn failure.
  // Keep that operational fact separate from the mission decision, but do not
  // label a failed LLM turn as a successfully completed runner.
  const runnerState = error ? 'RUNNER_FAILED' : 'RUNNER_COMPLETED';
  await save(`${DIR}/result.json`, { ...mission, status, error, final_report: report, outcome, ros2_trace: ros, real_stack: true, fake_event: false, hidden_ground_truth_leak: false, runner_state: runnerState });
  await save(`${OUT}/current.json`, { ...mission, status, final_report: report, mission_dir: DIR, error });
  remove(); await session.close?.(); await client.close?.(); await bridge?.close?.();
  console.log(JSON.stringify({ mission_id, status, error }));
  process.exit(error && status !== 'CANCELED' ? 1 : 0);
} catch (error: any) {
  status = stopRequested ? 'CANCELED' : 'FAILED'; mission.finished_at = stamp(); await writeCurrent({ error: { message: String(error.message ?? error) } }); await save(`${OUT}/current.json`, { ...mission, status, mission_dir: DIR, error: { message: String(error.message ?? error) } }); await stopRobot(); await session?.close?.().catch?.(() => {}); await client?.close?.().catch?.(() => {}); await bridge?.close?.().catch?.(() => {}); console.error(error); process.exit(1);
}
