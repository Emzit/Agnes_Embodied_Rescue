import assert from 'node:assert/strict';
import { agnesTurnCompletionError, evaluateMission, extractRequirements, hasBlockedRouteEvidence, normalizeToolResult, TASK_ORIGIN_ALIAS, originAliasForMission } from './mission-evaluator.mts';

const reset = (id: string) => ({ type: 'tool_result', tool: 'mission_reset', result: { mission_id: id, status: 'IDLE', world_memory: { robot_location: 'unknown', searched_rooms: [], blocked_routes: [], known_objects: [] } } });
const nav = (target: string, status = 'SUCCEEDED', action_status = status) => ({ type: 'tool_result', tool: 'mcp_robot_mcp_nav_navigate_to', result: { target, status, action_status } });
const person = () => ({ type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_object', result: { status: 'SUCCEEDED', room: 'Room_X', evidence: [{ source: 'ros2_camera_perception', label: 'person', frame_timestamp: { sec: 1 } }], detections: [{ label: 'person', source: 'ros2_camera_perception' }] } });
const inspect = () => ({ type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_object', result: { status: 'SUCCEEDED', room: 'Room_X', evidence: [{ source: 'ros2_camera_perception', label: 'person', frame_timestamp: { sec: 2 } }] } });
const completeMemory = () => ({ type: 'tool_result', tool: 'world_memory_update', result: { target_status: 'COMPLETE', searched_rooms: ['Room_X'], blocked_routes: [], current_plan: [{ status: 'completed', step: 'search' }, { status: 'completed', step: 'return' }] } });
const state = (x: number, y: number, location = 'Room_X') => ({ type: 'tool_result', tool: 'mcp_robot_mcp_obs_get_robot_state', result: { status: 'SUCCEEDED', current_location: location, pose: { x, y, yaw: 0, frame_id: 'map' } } });

const task = '搜索人员并用 Camera 复检，完成后返回起点并报告风险。';
const run = (id: string, events: any[], report = 'Camera 观察到研究员并完成复检；未观察到明显环境风险。') => evaluateMission(task, [reset(id), ...events], report, null, false, id);

const pass = run('case-1', [person(), inspect(), completeMemory(), nav('Start')]);
assert.equal(pass.status, 'SUCCEEDED');

const pendingThenTerminal = evaluateMission('去 Room_A', [
  reset('case-pending'),
  { type: 'tool_result', tool: 'mcp_robot_mcp_nav_navigate_to', result: {
    target: 'Room_A', status: 'PENDING', accepted: true,
    action_status: 'EXECUTING', terminal_known: false,
    operation_id: 'op-pending', goal_id: 'goal-pending',
  } },
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_get_robot_state', result: {
    current_location: 'Room_A',
    pose: { x: 2.0, y: 1.3, yaw: 0.1, frame_id: 'map' },
    navigation_operation_id: 'op-pending', navigation_goal_id: 'goal-pending',
    navigation_terminal_known: true, navigation_terminal_status: 'SUCCEEDED',
    navigation_error_code: 0,
  } },
], '已到达 Room_A。');
assert.equal(pendingThenTerminal.status, 'SUCCEEDED');
assert.equal(pendingThenTerminal.counts.navigation_success, 1);
assert.equal(pendingThenTerminal.evidence.navigation.attempts[0].derived_terminal_from.tool, 'get_robot_state');

const abort = run('case-2', [person(), inspect(), completeMemory(), nav('Room_X'), nav('Start', 'FAILED', 'ABORTED')], '任务状态：部分完成；无法返回起点。');
assert.ok(['PARTIAL', 'FAILED'].includes(abort.status));
assert.notEqual(abort.status, 'SUCCEEDED');

const wrongLocation = run('case-3', [person(), inspect(), completeMemory(), nav('Room_X')]);
assert.ok(['PARTIAL', 'FAILED'].includes(wrongLocation.status));
assert.notEqual(wrongLocation.status, 'SUCCEEDED');

const reportLies = run('case-4', [person(), inspect(), nav('Start', 'FAILED', 'ABORTED')], '任务完成，已返回起点。');
assert.ok(['PARTIAL', 'FAILED'].includes(reportLies.status));
assert.notEqual(reportLies.status, 'SUCCEEDED');

const recoveredIncidentMention = run('case-4b', [person(), inspect(), completeMemory(),
  nav('Start')], 'Camera 观察到研究员并复检，未观察到明显环境风险；此前 NAVIGATION_SYSTEM_UNHEALTHY 已恢复。');
assert.equal(recoveredIncidentMention.status, 'SUCCEEDED');

const causal = evaluateMission('执行动态事件并绕行，最后返回起点。', [reset('case-5'), nav('Start')], '已完成。', null, false, 'case-5');
assert.equal(causal.evidence.rescue.causal_replan_proven, false);

const stalePerson = evaluateMission(task, [
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_object', result: { status: 'SUCCEEDED', room: 'OldRoom', evidence: [{ source: 'ros2_camera_perception', label: 'person' }] } },
  reset('case-6'), nav('Start'),
], '已完成。', null, false, 'case-6');
assert.notEqual(stalePerson.status, 'SUCCEEDED');
assert.equal(stalePerson.objective.target_observed, false);

const originReq = extractRequirements('回到一开始的位置');
assert.equal(originReq.return_mode, 'task_origin');
assert.equal(originReq.final_return_target, TASK_ORIGIN_ALIAS);
assert.equal(originReq.needsNavigation, true);
assert.deepEqual(extractRequirements('回到本次任务开始时的地方').final_return_target, TASK_ORIGIN_ALIAS);
assert.equal(extractRequirements('任务结束时返回出发处').final_return_target, TASK_ORIGIN_ALIAS);
assert.equal(extractRequirements('return to where you started').return_mode, 'task_origin');
assert.equal(extractRequirements('回到地图上的 Start').final_return_target, 'Start');
assert.equal(extractRequirements('去 Room_C').required_locations[0], 'Room_C');
assert.deepEqual(extractRequirements('先去 Room_A，再回到起点').required_locations, ['Room_A', 'Start']);
assert.equal(extractRequirements('回到那里').return_mode, 'ambiguous');
assert.equal(extractRequirements('执行搜救并搜索人员').return_mode, null);
assert.equal(extractRequirements('进入实验室寻找失联研究员，并报告环境风险。').risk_report_required, true);
assert.equal(extractRequirements('进入实验室寻找失联研究员，不需要报告环境风险。').risk_report_required, false);
const inspectionReturnRequirements = extractRequirements('搜索失联研究员，检查并复检人员，返回起点。');
assert.equal(inspectionReturnRequirements.required_actions[0].target, 'Start');
assert.equal(inspectionReturnRequirements.required_actions[1].target, null);
assert.equal(extractRequirements('去实验室').navigation_target_missing, true);
const invalidTarget = evaluateMission('去实验室', [reset('invalid-target'), nav('Unknown', 'FAILED', 'ABORTED')], '已完成。', null, false, 'invalid-target');
assert.notEqual(invalidTarget.status, 'SUCCEEDED');

const originTask = '回到一开始的位置';
const originPass = evaluateMission(originTask, [reset('origin-pass'), state(5.8, 1.0, 'Room_B'), nav(TASK_ORIGIN_ALIAS), state(5.82, 1.02, 'Room_B')], '已回到开始位置。', null, false, 'origin-pass');
assert.equal(originPass.status, 'SUCCEEDED');
const originAbort = evaluateMission(originTask, [reset('origin-abort'), state(5.8, 1.0, 'Room_B'), nav(TASK_ORIGIN_ALIAS, 'FAILED', 'ABORTED')], '任务状态：部分完成，未能返回。', null, false, 'origin-abort');
assert.notEqual(originAbort.status, 'SUCCEEDED');
assert.equal(originAbort.requirements.final_return_target, originAliasForMission('origin-abort'));

// A semantic Start objective may be executed through the existing mission-
// origin alias only when the matching terminal state independently reports
// the robot at Start in map coordinates. The alias alone is never enough.
const fixedRescueTask = '进入当前真实场景寻找失联研究员；用 Camera 搜索并复检人员，完成后返回起点并报告观察到的环境风险。';
const aliasReturnEvents = [
  reset('semantic-start-alias'),
  state(0, 0, 'Start'),
  nav('Room_A'),
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_room', result: { content: [{ type: 'text', text: JSON.stringify({
    status: 'SUCCEEDED', room: 'Room_A', inspected: true,
    detections: [{ label: 'person', source: 'ros2_camera_perception', frame_id: 'camera_link',
      evidence: { frame_timestamp: { sec: 2, nanosec: 0 } } }],
  }) }] } },
  person(), inspect(), completeMemory(),
  { type: 'tool_result', tool: 'mcp_robot_mcp_nav_navigate_to', result: {
    target: originAliasForMission('semantic-start-alias'), status: 'PENDING', accepted: true,
    action_status: 'EXECUTING', terminal_known: false, operation_id: 'op-return', goal_id: 'goal-return',
  } },
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_get_robot_state', result: {
    current_location: 'Start', pose: { x: -0.15, y: -0.04, yaw: 0.12, frame_id: 'map' },
    navigation_operation_id: 'op-return', navigation_goal_id: 'goal-return',
    navigation_terminal_known: true, navigation_terminal_status: 'SUCCEEDED', navigation_error_code: 0,
  } },
];
const semanticStartAliasPass = evaluateMission(fixedRescueTask, aliasReturnEvents,
  '任务完成。Camera 观测到人员并复检，机器人已返回 Start，未观察到明显环境风险，人员身份仍待核实。', null, false, 'semantic-start-alias');
assert.equal(semanticStartAliasPass.status, 'SUCCEEDED', JSON.stringify({ status: semanticStartAliasPass.status, reasons: semanticStartAliasPass.reasons, requirements: semanticStartAliasPass.requirements, objective: semanticStartAliasPass.objective, rescue: semanticStartAliasPass.evidence.rescue, nav: semanticStartAliasPass.evidence.navigation }));
assert.equal(semanticStartAliasPass.evidence.navigation.sequence_verified, true);
assert.equal(semanticStartAliasPass.evidence.final_pose.location, 'Start');
assert.equal(semanticStartAliasPass.reasons.length, 0);

const wrongSemanticAlias = evaluateMission(fixedRescueTask, [
  ...aliasReturnEvents.slice(0, -1),
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_get_robot_state', result: {
    current_location: 'Room_C', pose: { x: 4.2, y: -3.8, yaw: 0.1, frame_id: 'map' },
    navigation_operation_id: 'op-return', navigation_goal_id: 'goal-return',
    navigation_terminal_known: true, navigation_terminal_status: 'SUCCEEDED', navigation_error_code: 0,
  } },
], '任务完成。Camera 观测到人员并复检，机器人已返回 Start，风险已记录。', null, false, 'semantic-start-alias');
assert.notEqual(wrongSemanticAlias.status, 'SUCCEEDED');

const emptyBlockedRoutes = evaluateMission('搜索人员并报告风险。', [reset('empty-blocks'),
  person(), inspect(), { type: 'tool_result', tool: 'world_memory_update', result: {
    blocked_routes: [], visited_locations: ['Start', 'Room_A', 'Room_B'], navigation_attempts: [{}, {}, {}],
  } },
], '已完成搜索并报告观察到的风险，人员身份仍待确认。', null, false, 'empty-blocks');
assert.equal(emptyBlockedRoutes.evidence.rescue.dynamic_block, false);
assert.equal(hasBlockedRouteEvidence({ blocked_routes: [] }), false);
assert.equal(hasBlockedRouteEvidence({ blocked_routes: [{ from: 'Room_A', to: 'Room_B', reason: 'PATH_BLOCKED' }] }), true);

// MCP permits equivalent JSON object, JSON text, and content-array envelopes.
// All successful forms must count; malformed/error text must never do so.
const stringInspect = JSON.stringify({ status: 'SUCCEEDED', room: 'Room_X', inspected: true });
const contentInspect = { content: [{ type: 'text', text: stringInspect }] };
assert.equal(normalizeToolResult(stringInspect).status, 'SUCCEEDED');
assert.equal(normalizeToolResult(contentInspect).room, 'Room_X');
const normalizedCounts = evaluateMission('检查 Room_X', [reset('result-shapes'), nav('Room_X'),
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_room', result: stringInspect },
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_room', result: contentInspect },
], '已检查 Room_X。', null, false, 'result-shapes');
assert.equal(normalizedCounts.counts.inspect_room_success, 2);
assert.equal(normalizeToolResult('not-json').status, undefined);
const failedShape = evaluateMission('检查 Room_X', [reset('failed-shape'), nav('Room_X'),
  { type: 'tool_result', tool: 'mcp_robot_mcp_obs_inspect_room', result: JSON.stringify({ status: 'FAILED', room: 'Room_X' }) },
], '无法完成检查。', null, false, 'failed-shape');
assert.notEqual(failedShape.status, 'SUCCEEDED');

const abortedTurn = agnesTurnCompletionError({ reason: 'aborted', stopReason: 'cancelled' });
assert.equal(abortedTurn?.code, 'AGNES_TURN_NOT_COMPLETED');
const incompleteTurnMission = evaluateMission('进入实验室寻找失联研究员，并报告环境风险。', [
  reset('aborted-turn'), person(), inspect(), nav('Side_Corridor', 'PENDING', 'EXECUTING'),
], 'I found the researcher. The remaining rooms need to be surveyed for risk reporting. Let me continue.', abortedTurn, false, 'aborted-turn');
assert.notEqual(incompleteTurnMission.status, 'SUCCEEDED');
assert.equal(incompleteTurnMission.runner_state, 'RUNNER_FAILED');
assert.equal(incompleteTurnMission.unresolved_navigation, true);
assert.ok(incompleteTurnMission.reasons.includes('REAL_LLM_TURN_FAILED'));
assert.ok(incompleteTurnMission.reasons.includes('NAVIGATION_TERMINAL_UNKNOWN'));
assert.ok(incompleteTurnMission.reasons.includes('RISK_REPORT_NOT_GROUNDED_OR_INCOMPLETE'));

const freeInputSuccess = evaluateMission('进入实验室寻找失联研究员，并报告环境风险。', [
  reset('free-input-pass'), nav('Room_A'), person(), inspect(),
], 'Camera 观察到研究员并完成复检；未观察到明显环境风险，人员身份仍需现场确认。', null, false, 'free-input-pass');
assert.equal(freeInputSuccess.status, 'SUCCEEDED', JSON.stringify({ reasons: freeInputSuccess.reasons, requirements: freeInputSuccess.requirements }));
assert.equal(freeInputSuccess.requirements.return_required, false);
assert.equal(freeInputSuccess.evidence.final_pose.location, 'Room_A');

const progressOnlyRiskReport = evaluateMission('进入实验室寻找失联研究员，并报告环境风险。', [
  reset('progress-report'), person(), inspect(),
], 'The remaining rooms need to be surveyed for risk reporting. Let me complete the inspection.', null, false, 'progress-report');
assert.notEqual(progressOnlyRiskReport.status, 'SUCCEEDED');
assert.ok(progressOnlyRiskReport.reasons.includes('RISK_REPORT_NOT_GROUNDED_OR_INCOMPLETE'));

console.log(JSON.stringify({ pass: true }));
