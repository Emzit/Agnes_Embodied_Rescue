#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';

const root = '/data-ssd/zhongchengkai/agnes';
const out = `${root}/artifacts/interactive-live/live-pose-ui-validation.json`;
const base = process.env.DASHBOARD_URL || 'http://127.0.0.1:4188';
const response = await fetch(`${base}/api/live-pose`, { cache: 'no-store' });
const value = await response.json();
const result = {
  ...value,
  source: value.source || 'live ROS2 /odom + map->base_link',
  pass: Boolean(value.pass && value.current_location && value.current_location !== 'Start'),
};
await mkdir(`${root}/artifacts/interactive-live`, { recursive: true });
await writeFile(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 2;
