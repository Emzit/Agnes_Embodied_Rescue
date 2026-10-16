#!/usr/bin/env node
// A dedicated read-only subscriber keeps display traffic out of the MCP bridge.
import { spawn } from 'node:child_process';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..');
const child = spawn('/bin/bash', ['-lc',
  'source scripts/final-rescue/env.sh; exec tools/pixi/bin/pixi run --locked --manifest-path runtime/ros2-jazzy/pixi.toml python scripts/interactive/live_camera.py'
], { cwd: ROOT, env: process.env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1); });
