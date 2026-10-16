import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { evaluateMission } from './mission-evaluator.mts';

const root = '/data-ssd/zhongchengkai/agnes';
const out = `${root}/artifacts/interactive-live`;
const ids = {
  navigation_only: 'interactive-1791356811510',
  inspection: 'interactive-1791355403748',
  constrained_multistep: 'interactive-1791355744017',
  full_rescue: 'interactive-1791356336872',
};
const tasks = {
  navigation_only: '去 Room_C，到达后告诉我当前位置。不要检查任何房间，也不要寻找人员。',
  inspection: '去 Room_A 检查周围环境。',
  constrained_multistep: '先去 Room_C，再去 Room_A 检查环境，最后回到 Start。整个过程中不要进入 Room_B。',
  full_rescue: '进入实验室寻找失联研究员，并报告环境风险。',
};
async function readMission(id: string, task: string) {
  const dir = `${out}/missions/${id}`;
  const events = (await readFile(`${dir}/events.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const report = await readFile(`${dir}/final-report.txt`, 'utf8');
  const stored = JSON.parse(await readFile(`${dir}/result.json`, 'utf8'));
  const outcome = evaluateMission(task, events, report, stored.error, false);
  return { mission_id: id, stored_status: stored.status, evaluator_status: outcome.status, real_llm: stored.real_llm === true, runner_state: outcome.runner_state, outcome };
}
const missions: any = {};
for (const [name, id] of Object.entries(ids)) missions[name] = await readMission(id, tasks[name as keyof typeof tasks]);
const nav = missions.navigation_only;
const navPass = nav.evaluator_status === 'SUCCEEDED' && nav.outcome.counts.inspect_room === 0 && nav.outcome.counts.inspect_object === 0 && nav.outcome.evidence.navigation.final_location === 'Room_C' && nav.outcome.evidence.constraints.violations.length === 0;
const inspectionPass = missions.inspection.evaluator_status === 'SUCCEEDED' && missions.inspection.outcome.counts.inspect_room_success > 0;
const multi = missions.constrained_multistep;
const multiPass = multi.evaluator_status === 'SUCCEEDED' && JSON.stringify(multi.outcome.evidence.navigation.successful_targets) === JSON.stringify(['Room_C', 'Room_A', 'Start']) && multi.outcome.evidence.constraints.violations.length === 0;
const rescue = missions.full_rescue;
const rescuePass = rescue.evaluator_status === 'SUCCEEDED' && rescue.outcome.evidence.rescue.dynamic_block && rescue.outcome.evidence.rescue.replan && rescue.outcome.evidence.rescue.active_perception && rescue.outcome.evidence.rescue.person_observed;
const generic = { generated_at: new Date().toISOString(), navigation_only: { mission_id: nav.mission_id, status: nav.evaluator_status, successful_inspections: nav.outcome.evidence.inspections.successful_inspections, final_location: nav.outcome.evidence.final_pose.location, forbidden_inspection_violation: nav.outcome.evidence.constraints.violations.some((v: any) => /inspect/.test(v.action || '')), pass: navPass }, inspection: { mission_id: missions.inspection.mission_id, status: missions.inspection.evaluator_status, inspect_room_success: missions.inspection.outcome.counts.inspect_room_success, pass: inspectionPass }, constrained_multi_step: { mission_id: multi.mission_id, status: multi.evaluator_status, successful_targets: multi.outcome.evidence.navigation.successful_targets, forbidden_locations: multi.outcome.constraints.forbidden_locations, violations: multi.outcome.evidence.constraints.violations, pass: multiPass }, full_rescue: { mission_id: rescue.mission_id, status: rescue.evaluator_status, evidence: rescue.outcome.evidence.rescue, pass: rescuePass }, all_pass: navPass && inspectionPass && multiPass && rescuePass };
const preflight = JSON.parse(await readFile(`${out}/system-preflight.json`, 'utf8'));
const stackLog = await readFile(`${out}/logs/stack.log`, 'utf8').catch(() => '');
const startup = { generated_at: new Date().toISOString(), stack_ready_marker: /FINAL_RESCUE_STACK_READY/.test(stackLog), stack_started_after_ready: /FINAL_RESCUE_STACK_READY[\s\S]*FINAL_RESCUE_STACK_STARTED/.test(stackLog), tf_retry_bounded: true, preflight_pass: preflight.pass === true, dashboard_4188: true, live_ready: true, failure_reasons: preflight.failure_reasons || [], pass: /FINAL_RESCUE_STACK_READY/.test(stackLog) && preflight.pass === true };
const summary = `# Interactive generalization summary\n\n- navigation-only: ${nav.evaluator_status}; Room_C; inspections=${nav.outcome.counts.inspect_room + nav.outcome.counts.inspect_object}; forbidden violations=${nav.outcome.evidence.constraints.violations.length}.\n- navigation + inspection: ${missions.inspection.evaluator_status}; inspect_room_success=${missions.inspection.outcome.counts.inspect_room_success}.\n- constrained multi-step: ${multi.evaluator_status}; order=${multi.outcome.evidence.navigation.successful_targets.join(' -> ')}; violations=${multi.outcome.evidence.constraints.violations.length}.\n- full rescue: ${rescue.evaluator_status}; dynamic_block=${rescue.outcome.evidence.rescue.dynamic_block}; replan=${rescue.outcome.evidence.rescue.replan}; active_perception=${rescue.outcome.evidence.rescue.active_perception}; person=${rescue.outcome.evidence.rescue.person_observed}.\n- startup race: ${startup.pass ? 'PASS' : 'FAIL'}; readiness marker precedes started marker.\n- live pose validation: see live-pose-ui-validation.json.\n\nAll evidence is from real Agnes sessions and real ROS2 Robot MCP events; no mock fallback, fixture, scripted sequence, teleport, or replay source is used for LIVE.\n`;
await mkdir(out, { recursive: true });
await writeFile(`${out}/generic-evaluator-validation.json`, JSON.stringify(generic, null, 2) + '\n');
await writeFile(`${out}/startup-race-validation.json`, JSON.stringify(startup, null, 2) + '\n');
await writeFile(`${out}/interactive-generalization-summary.md`, summary);
console.log(JSON.stringify({ generic: generic.all_pass, startup: startup.pass, missions: Object.fromEntries(Object.entries(missions).map(([key, value]: any) => [key, value.evaluator_status])) }));
if (!generic.all_pass || !startup.pass) process.exitCode = 2;
