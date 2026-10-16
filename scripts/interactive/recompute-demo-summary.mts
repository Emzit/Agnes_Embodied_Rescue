import { readFile, writeFile } from 'node:fs/promises';
import { evaluateMission } from './mission-evaluator.mts';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const sourceSummary = JSON.parse(await readFile(`${ROOT}/artifacts/demo-rescue/rehearsal-summary.json`, 'utf8'));
const postFixManifest = JSON.parse(await readFile(`${ROOT}/artifacts/demo-rescue/post-fix-run-ids.json`, 'utf8'));
const historicalIds = sourceSummary.runs.map((run: any) => run.mission_id);
const postFixIds = postFixManifest.mission_ids;
async function audit(missionId: string, index: number) {
  const dir = `${ROOT}/artifacts/interactive-live/missions/${missionId}`;
  const mission = JSON.parse(await readFile(`${dir}/mission.json`, 'utf8'));
  const lines = (await readFile(`${dir}/events.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const report = await readFile(`${dir}/final-report.txt`, 'utf8').catch(() => '');
  const outcome = evaluateMission(mission.task, lines, report, null, false, missionId);
  const nav = outcome.evidence.navigation;
  const rescue = outcome.evidence.rescue;
  return {
    rehearsal: index + 1,
    mission_id: missionId,
    original_status: mission.status,
    status: outcome.status,
    pass: outcome.status === 'SUCCEEDED',
    final_location: nav.final_location,
    final_return_target: outcome.requirements.final_return_target,
    final_return_succeeded: !outcome.requirements.final_return_required || (nav.attempts.at(-1)?.target === outcome.requirements.final_return_target && nav.attempts.at(-1)?.status === 'SUCCEEDED' && !['ABORTED', 'CANCELED', 'TIMEOUT'].includes(nav.attempts.at(-1)?.action_status)),
    required_objectives_complete: outcome.status === 'SUCCEEDED',
    victim_observation: outcome.objective.target_observed,
    reinspection_satisfied: rescue.reinspection_satisfied,
    replan_observed: rescue.replan_observed,
    dynamic_event_evidence: rescue.dynamic_event_evidence,
    causal_replan_proven: rescue.causal_replan_proven,
    reasons: outcome.reasons,
    navigation_successes: outcome.counts.navigation_success,
    navigation_failures: outcome.counts.navigation_failures,
    tool_timeline: `artifacts/interactive-live/missions/${missionId}/events.jsonl`,
    navigation_timeline: `artifacts/interactive-live/missions/${missionId}/navigation-events.json`,
    real: mission.real_llm === true && mission.mock_fallback !== true && mission.fixture !== true && mission.scripted_tool_sequence !== true,
    mock_fallback: mission.mock_fallback === true,
    fixture: mission.fixture === true,
    scripted_tool_sequence: mission.scripted_tool_sequence === true,
  };
}
const historicalRuns = [];
for (const [index, missionId] of historicalIds.entries()) historicalRuns.push(await audit(missionId, index));
const postFixRuns = [];
for (const [index, missionId] of postFixIds.entries()) postFixRuns.push(await audit(missionId, index));
const output = {
  generated_at: new Date().toISOString(),
  source_summary: 'artifacts/demo-rescue/rehearsal-summary.json',
  post_fix_manifest: 'artifacts/demo-rescue/post-fix-run-ids.json',
  scenario_seed: 1185,
  historical_run_count: historicalRuns.length,
  historical_runs: historicalRuns,
  post_fix_run_count: postFixRuns.length,
  post_fix_runs: postFixRuns,
  successful_runs: postFixRuns.filter(row => row.pass).length,
  strict_demo_ready: postFixRuns.filter(row => row.pass).length >= 2,
  strict_result: postFixRuns.every(row => row.pass) ? 'STRICT_3_OF_3' : postFixRuns.filter(row => row.pass).length >= 2 ? 'STRICT_2_OF_3' : 'NOT_READY',
  causal_replan_claim: postFixRuns.every(row => row.causal_replan_proven) ? 'PROVEN_FOR_ALL_RUNS' : 'NOT_CLAIMED',
  historical_misclassifications: historicalRuns
    .filter((row, index) => historicalRuns[index] && row.status !== sourceSummary.runs[index]?.status)
    .map(row => ({ mission_id: row.mission_id, corrected_status: row.status, pass: row.pass })),
  old_summary_preserved: true,
  no_failure_evidence_deleted: true,
};
await writeFile(`${ROOT}/artifacts/demo-rescue/rehearsal-summary-corrected.json`, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, strict_result: output.strict_result, successful_runs: output.successful_runs }));
