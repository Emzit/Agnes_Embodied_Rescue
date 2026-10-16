#!/usr/bin/env node
import { spawn } from 'node:child_process';
const root = '/data-ssd/zhongchengkai/agnes';
const child = spawn('/bin/bash', ['-c', `source ${root}/scripts/final-rescue/env.sh; exec ${root}/tools/node/bin/node ${root}/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs ${root}/services/environment-interaction-mcp/server.ts`], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
