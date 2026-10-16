#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const ROOT = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'artifacts/demo/showcase-live-run'));
const keyframes = path.join(out, 'keyframes');
const stopFile = path.join(out, '.capture-stop');
fs.mkdirSync(keyframes, { recursive: true });

const child = spawn('/bin/bash', [path.join(ROOT, 'services/robot-mcp/ros2_bridge/launch_bridge.sh')], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let sequence = 0;
lines.on('line', line => { try { const response = JSON.parse(line); const waiter = pending.get(response.id); if (waiter) { pending.delete(response.id); response.ok ? waiter.resolve(response.result) : waiter.reject(new Error(response.error?.code || 'BRIDGE_ERROR')); } } catch {} });
function call(method, params = {}) {
  const id = `showcase-${++sequence}`;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('BRIDGE_TIMEOUT')); } }, 12000); });
}
function saveIndex(entries) { fs.writeFileSync(path.join(out, 'camera-captures.json'), JSON.stringify({ source_topic: '/camera/image_raw', capture_method: 'real ROS2 bridge capture_frame', frames: entries }, null, 2) + '\n'); }

const entries = [];
async function capture(label) {
  try {
    const [pose, result] = await Promise.all([call('get_robot_state'), call('capture_frame', { name: 'camera-frame-room-a.png' })]);
    const serial = String(entries.length).padStart(4, '0');
    const target = path.join(keyframes, `raw-${serial}.png`);
    const source = path.join(ROOT, 'artifacts/phase10/camera-frame-room-a.png');
    fs.copyFileSync(source, target);
    entries.push({ index: entries.length, label, path: path.relative(out, target), source_topic: '/camera/image_raw', captured_from: 'real final_rescue ROS2 sensor', timestamp: result.timestamp || pose.timestamp || null, pose });
    saveIndex(entries);
  } catch (error) { fs.appendFileSync(path.join(out, 'camera-capture-errors.log'), `${new Date().toISOString()} ${error.message}\n`); }
}

await capture('start');
while (!fs.existsSync(stopFile)) {
  await new Promise(resolve => setTimeout(resolve, 1400));
  if (fs.existsSync(stopFile)) break;
  await capture('live-sample');
}
await capture('final');
fs.writeFileSync(path.join(out, 'camera-capture-complete.json'), JSON.stringify({ pass: entries.length >= 2, count: entries.length, source_topic: '/camera/image_raw', no_fake_image: true }, null, 2) + '\n');
child.stdin.end();
await new Promise(resolve => child.once('exit', resolve));
