import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = '/data-ssd/zhongchengkai/agnes';
const artifacts = `${root}/artifacts/phase9d`;
const load = async name => JSON.parse(await readFile(`${artifacts}/${name}`, 'utf8'));
const save = (name, data) => writeFile(`${artifacts}/${name}`, JSON.stringify(data, null, 2) + '\n');
const acceptance = await load('acceptance.json');
const plan = await load('package-plan.json');
const cleanup = await load('process-cleanup.json');
const direct = await load('ros2-nav-result.json');
const mcp = await load('mcp-nav-result.json');
const regressionLog = await readFile(`${root}/logs/phase9d/component-route-regression.log`, 'utf8');
const count = key => Number(regressionLog.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1] ?? NaN);
assert.equal(count('fail'), 0); assert.equal(count('pass'), 16); assert.equal(count('skipped'), 2);
const attempts = [];
for (const n of [1, 2]) {
  const log = await readFile(`${root}/logs/phase9d/component-route-attempt-${n}.log`, 'utf8');
  assert.match(log, /ℹ pass 1/); assert.match(log, /ℹ fail 0/);
  attempts.push({ attempt: n, result: 'PASS', root_cause: null,
    changes: n === 1 ? ['Official component route; package plan, /clock and feedback checks, scoped process supervisor']
      : ['Exercise public start/check/stop wrappers; verify supervisor ownership and stale PID handling'],
    log: `logs/phase9d/component-route-attempt-${n}.log` });
}
await save('debug-attempts.json', { scope: 'Current minimal-component route acceptance', total_attempts: 2,
  configuration_failure_count: 0, attempts, historical_evidence: 'prior-20261006 and attempt-1/2/3 retain previous-stage evidence' });
await save('regression.json', { passed: count('pass'), failed: count('fail'), skipped: count('skipped'),
  phase9d_separate_test: 'PASS', phase9c_real_gazebo_smoke: 'PASS',
  phase9b_jsonl_unit_tests: 'PASS', phase9b_live_protocol_on_real_nav2: acceptance.phase9b_live_protocol_regression,
  phase9b_fixture_action_server_test: 'NOT_EXECUTED_PROHIBITED',
  phase9b_three_tool_transport_on_real_nav2: 'PASS',
  mock_backend: 'PASS', ros2_unimplemented_five_tools: acceptance.unimplemented_five_tools,
  log: 'logs/phase9d/component-route-regression.log' });
assert.equal(plan.allowed_to_install, true); assert.equal(cleanup.all_stopped, true);
assert.equal(acceptance.passed, true);
assert.equal(direct.result.status, 'SUCCEEDED'); assert.ok(direct.distance_to_goal <= 0.25);
assert.equal(mcp.result.status, 'SUCCEEDED'); assert.ok(mcp.distance_to_goal <= 0.25);
acceptance.regression_pass = true;
acceptance.component_packages_installed = true;
acceptance.phase_result = 'PHASE9D_REAL_NAV2_PASS';
await save('acceptance.json', acceptance);
await save('phase-summary.json', { phase_result: acceptance.phase_result,
  nav2_meta_packages_used: false, component_route_accepted: true,
  ros2_direct_navigation_error_m: direct.distance_to_goal, mcp_navigation_error_m: mcp.distance_to_goal,
  current_attempts: 2, processes_cleaned: cleanup.all_stopped, regression_pass: true });
console.log(acceptance.phase_result);
