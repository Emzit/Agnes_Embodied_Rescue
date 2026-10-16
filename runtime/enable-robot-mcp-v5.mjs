import { readFile } from 'node:fs/promises'
import { createClient, memoryJournal } from '../third_party/agnes-harness/packages/sdk/src/index.node.ts'
const root='/data-ssd/zhongchengkai/agnes'; const profile='local-dev'; const owner=JSON.parse(await readFile(`${root}/.agh-home-step7/data/daemon/owner.json`,'utf8'))
const client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()}); await client.initialize()
const clientId=await client.clientId(); const d=await client.mcp.servers.get({profile,serverId:'robot-mcp'})
const receipt=await client.mcp.servers.enable({profile,serverId:'robot-mcp',expectedRevision:d.revision,clientId,commandId:`v5-enable-robot-${Date.now()}`})
for(;;){const op=await client.resources.operation.get({profile,operationId:receipt.operationId}); if(['succeeded','failed','cancelled'].includes(op.state)){console.log(JSON.stringify({descriptor:d,operation:op})); if(op.state!=='succeeded')process.exitCode=1; break} await new Promise(r=>setTimeout(r,100))}
await client.close?.()
