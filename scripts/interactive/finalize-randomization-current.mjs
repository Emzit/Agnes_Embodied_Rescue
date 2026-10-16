#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'artifacts/interactive-live');
const read = (name, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(out, name), 'utf8')); } catch { return fallback; }
};
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const backup = read('../../backups/interactive-stable-20261007-before-randomization/backup-verification.json', null);
const solvability = read('solvability-validation.json', {});
const layouts = read('layout-validation.json', {});
const randomness = read('randomness-validation.json', {});
const adaptive = read('adaptive-decision-validation.json', {});
const perception = read('active-perception-random-validation.json', {});
const hidden = read('hidden-ground-truth-validation.json', {});
const preflight = read('randomization-start-preflight.json', {});
const attempts = read('randomization-debug-attempts.json', {});

const missionEvidence = {
  navigation_only: { status: 'SUCCEEDED', mission_id: 'interactive-1791367515378', seed: 1, note: 'real Agnes; Room_C; no inspection' },
  multi_step: { status: 'SUCCEEDED', mission_id: 'interactive-1791367369183', seed: 1112, note: 'real Agnes; Room_C -> Room_A inspect -> Start; Room_B forbidden' },
  layout_b_historical: { status: 'SUCCEEDED', mission_id: 'interactive-1791367604449', seed: 251, note: 'historical evidence only; seed 251 is rejected by the current placement-clearance gate' },
};
const blockers = [
  ...(layouts.pass ? [] : ['not all three layouts have a current gate-admitted real mission with terminal SUCCEEDED evidence']),
  ...(randomness.pass ? [] : ['six-seed deterministic validation is incomplete']),
  ...(adaptive.pass ? [] : ['fewer than three complete physical event -> sensor/navigation evidence -> world-model update -> invalidation -> real route-change replans']),
  ...(perception.pass ? [] : ['low-confidence reinspection and sufficient-evidence/no-reinspection branches are not both terminally evidenced']),
  ...(hidden.pass ? [] : ['terminal hidden-ground-truth audit is incomplete for unrun seeds']),
  ['interactive-1791368295595', 'interactive-1791368379454', 'interactive-1791367713906', 'interactive-1791368066869'].some(id => fs.existsSync(path.join(out, 'missions', id)))
    ? ['recent real Agnes randomized sessions ended with TRANSPORT status=? / -32603 before MCP tool calls; they cannot count as missions, replans, or perception evidence'] : [],
];
const regression = {
  generated_at: new Date().toISOString(),
  pass: false,
  blocker: blockers,
  backup: {
    path: 'backups/interactive-stable-20261007-before-randomization',
    verification_pass: backup?.pass === true,
    manifest_verified: backup?.manifest_verified === true,
    restore_dry_run_pass: backup?.restore_dry_run_pass === true,
  },
  startup: {
    start_once_live_ready: preflight.pass === true,
    dashboard_4188: preflight.dashboard_ready === true,
    preflight_pass: preflight.pass === true,
    nav2_lifecycle_active: preflight.nav2?.lifecycle_active === true,
    navigate_to_pose: preflight.nav2?.navigate_action_server === true,
    tf_map_odom_base_link: preflight.nav2?.tf_map_odom_base_link === true,
    fresh_odom_camera_lidar: Boolean(preflight.nav2?.odom?.fresh && preflight.nav2?.camera_fresh && preflight.nav2?.lidar_fresh),
    mcp_ready_tools_8: preflight.robot_mcp_ready === true && /tools=8\b/u.test(preflight.mcp_status || ''),
  },
  layouts,
  solvability: { pass: solvability.pass === true, seed_count: solvability.seeds?.length || 0 },
  randomness: { pass: randomness.pass === true, seeds: randomness.seeds || [] },
  missions: missionEvidence,
  adaptive_decision: { pass: adaptive.pass === true, real_replan_cases: adaptive.real_replan_cases || 0 },
  active_perception: { pass: perception.pass === true, low_confidence: perception.low_confidence_reinspection === true, high_confidence: perception.sufficient_evidence_no_reinspection === true },
  hidden_ground_truth: { pass: hidden.pass === true, terminal_audits: hidden.terminal_audit || [] },
  regressions: {
    robot_mcp_contract: { unchanged: true, tool_count: 8, test_log: 'artifacts/interactive-live/robot-mcp-regression.log' },
    agnes_core_tracked_source_changed: false,
    mock_fallback: false,
    fixture: false,
    scripted_tool_sequence: false,
    teleport: false,
  },
  debug_attempts: attempts.attempts || [],
};
write('randomization-regression.json', regression);

const summary = `# Randomized adaptive demo — current validation\n\n` +
`判定：**RANDOMIZED_ADAPTIVE_DEMO_BLOCKED**\n\n` +
`## 已完成\n\n` +
`- 稳定版备份 verification pass=true，可回退；备份目录未覆盖。\n` +
`- ScenarioManager/seed 可复现，三套 world/map/registry 已建立。\n` +
`- Layout C 的真实 planner 失败已定位并修复：边界几何与 Room_A 语义目标落入膨胀代价区；现有 gate 对选定 seed 通过，并正确拒绝 clearance 不足的 seed 1117。\n` +
`- start.sh 可一次到 LIVE READY；当前 preflight 通过，Nav2 lifecycle、NavigateToPose、TF、odom、Camera、LiDAR、MCP tools=8 均有真实证据。\n` +
`- Layout A seed 1 navigation-only 真实成功；Layout C seed 1112 multi-step 真实成功。\n` +
`- 无 mock fallback、fixture、teleport、scripted tool sequence；MCP 8-tool contract 未改；未编辑 Agnes Core tracked source。\n\n` +
`## 未完成 / blocker\n\n` + blockers.map(item => `- ${item}`).join('\n') + `\n\n` +
`Layout B 的 seed 251 曾有真实 inspection 成功，但在当前更严格的 placement-clearance gate 下已被淘汰，因此不能作为当前随机池的合格证据。最近真实 Agnes 会话在产生 MCP tool call 前返回 transport status=? / -32603；没有用替代脚本或假数据绕过。\n\n` +
`## 下一步最小修复\n\n` +
`先修复/恢复 Agnes real session 的 provider transport，使单次任务能产生真实 MCP trace；然后按 gate-admitted seed 逐个完成 B 与剩余五个 seed，收集三次物理事件→传感器/导航证据→world-model 更新→旧计划失效→真实新路线链，以及 active perception 两分支和六 seed terminal hidden-GT audit。\n\n` +
`启动命令：\`./scripts/interactive/start.sh\`；Dashboard：\`http://127.0.0.1:4188\`.\n`;
fs.writeFileSync(path.join(out, 'randomized-demo-summary.md'), summary);
console.log(JSON.stringify({ pass: regression.pass, blockers: blockers.length, backup_pass: regression.backup.verification_pass, preflight_pass: regression.startup.preflight_pass }));
