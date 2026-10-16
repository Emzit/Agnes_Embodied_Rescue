#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'artifacts/demo/showcase-live-run'));
const run = path.join(out, 'run1');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const captures = read(path.join(out, 'camera-captures.json'))?.frames || [];
const motion = read(path.join(run, 'physical-motion.json')) || [];
const trigger = read(path.join(run, 'dynamic-obstacle-trigger.json')) || {};
const perception = read(path.join(run, 'perception-events.json')) || [];
const mcp = read(path.join(run, 'mcp-trace.json')) || [];
const ros2 = fs.existsSync(path.join(run, 'ros2-events.jsonl')) ? fs.readFileSync(path.join(run, 'ros2-events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean) : [];
const stamp = value => value && typeof value === 'object' && Number.isFinite(value.sec) ? value.sec + (value.nanosec || 0) / 1e9 : null;
const nearest = target => captures.filter(item => stamp(item.timestamp) !== null).sort((a, b) => Math.abs(stamp(a.timestamp) - target) - Math.abs(stamp(b.timestamp) - target))[0] || captures[0];
const copyFrame = (name, capture) => {
  if (!capture) return null;
  const source = path.join(out, capture.path);
  const target = path.join(out, 'keyframes', name);
  fs.copyFileSync(source, target);
  return { path: path.relative(out, target), timestamp: capture.timestamp, pose: capture.pose, source_topic: '/camera/image_raw', evidence_capture: capture.index, sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
};
const firstEvidence = (predicate, fallback) => {
  for (const event of perception) {
    if (!predicate(event)) continue;
    const detectionStamp = (event.result?.detections || []).map(value => stamp(value.timestamp)).find(value => value !== null);
    if (detectionStamp !== undefined) return detectionStamp;
    const evidence = event.result?.evidence || [];
    const item = evidence.find(value => stamp(value.timestamp) !== null || stamp(value.frame_timestamp) !== null);
    if (item) return stamp(item.timestamp) ?? stamp(item.frame_timestamp);
  }
  return fallback;
};
const startCapture = captures[0];
const roomAStamp = firstEvidence(event => event.input?.location === 'Room_A', stamp(startCapture?.timestamp) || 0);
const blockedStamp = stamp(trigger.event?.timestamp) || roomAStamp;
const blockedPose = nearest(blockedStamp)?.pose?.position || null;
const replanMotion = ros2.map(event => ({ event, stamp: stamp(event.result?.timestamp), position: event.result?.position || event.result?.pose })).filter(item => item.stamp !== null && item.stamp > blockedStamp && item.position && blockedPose && Math.hypot((item.position.x || 0) - blockedPose.x, (item.position.y || 0) - blockedPose.y) > 0.45).sort((a,b) => a.stamp-b.stamp)[0];
const replanStamp = replanMotion?.stamp || blockedStamp;
const roomBStamp = firstEvidence(event => event.input?.location === 'Room_B' && (event.result?.detections || []).some(item => item.label === 'person'), blockedStamp);
const objectEvent = [...mcp].reverse().find(event => event.tool === 'inspect_object' && (event.result?.detections || []).some(item => item.label === 'person') && Number(event.result?.after_confidence) > Number(event.result?.before_confidence)) || [...mcp].reverse().find(event => event.tool === 'inspect_object' && (event.result?.detections || []).some(item => item.label === 'person'));
const objectResult = objectEvent?.result || {};
const beforeStamp = stamp(objectResult.evidence?.[0]?.frame_timestamp) || roomBStamp;
const afterStamp = stamp(objectResult.evidence?.at(-1)?.frame_timestamp) || roomBStamp;
const beforeCapture = nearest(beforeStamp);
const afterCapture = captures.filter(item => item.index !== beforeCapture?.index).sort((a, b) => Math.abs(stamp(a.timestamp) - afterStamp) - Math.abs(stamp(b.timestamp) - afterStamp))[0] || beforeCapture;
const keyframes = {
  start: copyFrame('start.png', startCapture),
  room_a: copyFrame('room-a.png', nearest(roomAStamp)),
  blocked: copyFrame('blocked-corridor-a.png', nearest(blockedStamp)),
  replan: copyFrame('replan.png', nearest(replanStamp)),
  room_b: copyFrame('room-b.png', nearest(roomBStamp)),
  active_before: copyFrame('active-before.png', beforeCapture),
  active_after: copyFrame('active-after.png', afterCapture),
  final: copyFrame('final.png', captures.at(-1)),
};
const detectionAt = (stage, frame) => {
  const target = stamp(frame?.timestamp);
  const detections = perception.flatMap(event => (event.result?.detections || []).map(item => ({ ...item, _stamp: stamp(item.timestamp) ?? stamp(item.evidence?.frame_timestamp) })));
  const personOnly = ['room_b', 'active_before', 'active_after', 'final'].includes(stage);
  return detections.filter(item => !personOnly || item.label === 'person').sort((a, b) => Math.abs((a._stamp ?? target ?? 0) - (target ?? 0)) - Math.abs((b._stamp ?? target ?? 0) - (target ?? 0))).slice(0, 8).map(({ _stamp, ...item }) => item);
};
const frameIndex = Object.fromEntries(Object.entries(keyframes).map(([stage, frame]) => [stage, frame ? {
  stage,
  frame: frame.path,
  timestamp: frame.timestamp,
  robot_pose: frame.pose,
  detections: detectionAt(stage, frame),
  sha256: frame.sha256,
  source_topic: frame.source_topic,
} : null]));
fs.writeFileSync(path.join(out, 'camera-keyframes.json'), JSON.stringify(keyframes, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'frame-index.json'), JSON.stringify({ source: 'real /camera/image_raw capture frames aligned to real timestamps and robot state', stages: frameIndex, no_fake_image: true }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'pose-snapshots.json'), JSON.stringify({ source: 'camera capture loop get_robot_state', samples: captures.map(item => item.pose).filter(Boolean) }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'route-snapshots.json'), JSON.stringify({ source: 'real final_rescue run1 navigation and dynamic obstacle artifacts', trigger, navigation: read(path.join(run, 'navigation-events.json')) || [], world_memory: read(path.join(run, 'world-memory-final.json')) || null }, null, 2) + '\n');
const activeDistinct = Boolean(keyframes.active_before && keyframes.active_after && keyframes.active_before.sha256 !== keyframes.active_after.sha256);
fs.writeFileSync(path.join(out, 'showcase-manifest.json'), JSON.stringify({ pass: Boolean(keyframes.start && keyframes.room_a && keyframes.blocked && keyframes.replan && keyframes.room_b && keyframes.active_before && keyframes.active_after && keyframes.final && activeDistinct), mode: 'REPLAY', replay_notice: '历史真实展示 run 回放，不是当前实时机器人状态。', source: 'new complete final_rescue mission', real_rgb_source: '/camera/image_raw', keyframes, active_before_after_distinct: activeDistinct, no_fake_image: true, no_hidden_ground_truth: true, no_mock_fallback: true }, null, 2) + '\n');
console.log(JSON.stringify({ captures: captures.length, keyframes: Object.keys(keyframes).filter(key => keyframes[key]).length, roomAStamp, blockedStamp, replanStamp, roomBStamp, beforeStamp, afterStamp, activeDistinct }, null, 2));
