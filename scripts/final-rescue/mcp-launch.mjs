import { spawn } from 'node:child_process';
const child=spawn('/bin/bash',['-c','source /data-ssd/zhongchengkai/agnes/scripts/final-rescue/env.sh; exec /data-ssd/zhongchengkai/agnes/tools/node/bin/node /data-ssd/zhongchengkai/agnes/services/robot-mcp/src/server.ts'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
