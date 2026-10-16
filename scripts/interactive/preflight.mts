import { mkdir, writeFile } from 'node:fs/promises';
import { JsonlBridge } from '../../services/robot-mcp/src/transport/jsonl-bridge.ts';

const root = '/data-ssd/zhongchengkai/agnes';
const out = process.env.INTERACTIVE_LIVE_ROOT || `${root}/artifacts/interactive-live`;
const bridge = new JsonlBridge('/bin/bash', [`${root}/services/robot-mcp/ros2_bridge/launch_bridge.sh`], {
  ...process.env,
  ROBOT_ROS2_ENV: 'final_rescue',
});

async function save(file: string, value: unknown) {
  await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

let result: any;
const recoveryAttempts: any[] = [];
try {
  result = await bridge.request('preflight', {}, 30000);
  for (let attempt = 1; !result.pass && attempt <= 3; attempt++) {
    const recovery = await bridge.request('recover_navigation', {}, 30000);
    recoveryAttempts.push({ attempt, ...recovery });
    result = recovery.health;
  }
  await save(`${out}/nav2-recovery-attempts.json`, {
    timestamp: new Date().toISOString(),
    max_attempts: 3,
    attempts: recoveryAttempts,
    pass: Boolean(result?.pass),
  });
  await save(`${out}/preflight.json`, result);
  process.stdout.write(JSON.stringify({ ...result, recovery_attempts: recoveryAttempts.length }) + '\n');
  process.exitCode = result?.pass ? 0 : 2;
} catch (error: any) {
  result = {
    pass: false,
    failure_reasons: [error?.code || error?.message || 'PREFLIGHT_ERROR'],
    bridge_ready: false,
  };
  await save(`${out}/nav2-recovery-attempts.json`, { timestamp: new Date().toISOString(), attempts: recoveryAttempts, pass: false });
  await save(`${out}/preflight.json`, result);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = 2;
} finally {
  await bridge.close();
}
