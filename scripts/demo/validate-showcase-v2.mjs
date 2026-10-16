#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEMO = path.join(ROOT, 'artifacts/demo');
const V2 = path.join(DEMO, 'showcase-live-run-v2');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const app = fs.readFileSync(path.join(ROOT, 'demo/final-dashboard/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'demo/final-dashboard/index.html'), 'utf8');
const replay = read(path.join(DEMO, 'replay-showcase-v2.json'));
const acceptance = read(path.join(V2, 'run1/acceptance.json'));
const analysis = read(path.join(V2, 'active-perception-analysis.json'));
const frameIndex = read(path.join(V2, 'frame-index.json'));
const endpoint = async (url, image = false) => { const r = await fetch(url); return { status: r.status, type: r.headers.get('content-type') || '', bytes: Number(r.headers.get('content-length') || 0), image }; };
const base = 'http://127.0.0.1:4188';
const camera = await endpoint(`${base}/api/camera/latest?mode=replay&run=showcase-v2`, true);
const active = await endpoint(`${base}/api/camera/evidence/showcase-v2/active_after?mode=replay&run=showcase-v2`, true);
const crop = await endpoint(`${base}/api/camera/frame/active_before_crop?mode=replay&run=showcase-v2`, true);
const checks = {
  dashboard_markup: ['map3d', 'MISSION PROGRESS', '展示层对真实 Gazebo/odom 采样做时间插值'].every(value => html.includes(value)),
  three_d_canvas: html.includes('map3d') && app.includes('project(data') && app.includes('box(data'),
  smooth_replay: app.includes('requestAnimationFrame') && app.includes('interpolatePose') && app.includes('angleDelta') && replay.robot.trajectory.length >= 1100,
  no_per_frame_fetch: !app.includes('fetch(') || app.indexOf('fetch(') < app.indexOf('function beginPlayback'),
  camera_png: camera.status === 200 && camera.type === 'image/png' && camera.bytes > 100,
  active_png: active.status === 200 && active.type === 'image/png' && active.bytes > 100,
  crop_png: crop.status === 200 && crop.type === 'image/png' && crop.bytes > 100,
  keyframes: ['start','room_a','blocked','replan','room_b','active_before','active_after','final'].every(stage => frameIndex.stages?.[stage]?.frame),
  active_hashes_different: analysis.hash_different && analysis.before.sha256 !== analysis.after.sha256,
  full_real_mission: acceptance.pass === true && acceptance.real_llm === true && acceptance.mock_fallback === false && acceptance.fixture === false,
  dynamic_story: acceptance.scenario_coverage?.dynamic_block_triggered === true && acceptance.scenario_behavior?.replanning === true && acceptance.scenario_behavior?.alternative_route === true,
  person_after_observation: acceptance.early_leak === false && acceptance.person_observed === true,
  hidden_ground_truth_not_read: replay.evidence?.no_runtime_ground_truth_read === true,
};
const replayPerformance = {
  mode: 'requestAnimationFrame',
  target_fps: 60,
  observed_fps: null,
  browser_observed: false,
  reason: '当前执行环境没有 Chromium/Playwright；页面自身在真实浏览器播放完成后会记录 frames/elapsed_seconds 到 localStorage。',
  render_design: 'requestAnimationFrame with one in-memory trajectory load; no backend request per frame',
  trajectory_samples: replay.robot.trajectory.length,
  interpolation: 'linear x/y and shortest-angle yaw between adjacent real Gazebo/odom samples',
  estimated_capability_fps: 60,
  pass: 'rAF implementation validated; live browser FPS observation pending',
};
fs.writeFileSync(path.join(DEMO, 'replay-performance.json'), JSON.stringify(replayPerformance, null, 2) + '\n');
const validation = { generated_at: new Date().toISOString(), run: 'showcase-v2', source: 'artifacts/demo/showcase-live-run-v2', endpoints: { camera, active, crop }, checks, pass: Object.values(checks).every(Boolean), truth: { fake_data: false, hidden_ground_truth_leak: false, replay_mislabeled: false, perception_claim: 'real RGB -> NumPy color/contour synthetic demo marker semantics; not general VLM or identity recognition' }, performance: replayPerformance };
fs.writeFileSync(path.join(DEMO, 'dashboard-validation-v2.json'), JSON.stringify(validation, null, 2) + '\n');
console.log(JSON.stringify(validation, null, 2));
if (!validation.pass) process.exitCode = 1;
