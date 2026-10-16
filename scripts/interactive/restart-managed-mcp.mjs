import { readFile, writeFile } from 'node:fs/promises'
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts'
const ROOT='/data-ssd/zhongchengkai/agnes', profile='local-dev'
const wait=ms=>new Promise(r=>setTimeout(r,ms)); const commandId=n=>`interactive-mcp-restart-${n}-${Date.now()}`
async function op(client,receipt){for(;;){const v=await client.resources.operation.get({profile,operationId:receipt.operationId});if(['failed','cancelled'].includes(v.state))throw new Error(v.lastSafeError?.message||v.state);if(v.state==='succeeded')return v;await wait(100)}}
const owner=JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`,'utf8'))
const client=createClient({transport:{kind:'unix',path:owner.socketPath},auth:{kind:'local'},journal:memoryJournal()});await client.initialize()
const identity={profile,clientId:await client.clientId()}; const names=['robot-mcp','envdoor']; const rows=[]
for(const serverId of names){const before=await client.mcp.servers.get({profile,serverId});let disabled=false
  if(before.desired==='enabled'){await op(client,await client.mcp.servers.disable({...identity,serverId,expectedRevision:before.revision,clientId:identity.clientId,commandId:commandId(`disable-${serverId}`)}));disabled=true}
  let current=await client.mcp.servers.get({profile,serverId}); if(current.desired!=='enabled')await op(client,await client.mcp.servers.enable({...identity,serverId,expectedRevision:current.revision,clientId:identity.clientId,commandId:commandId(`enable-${serverId}`)}))
  let status; for(let i=0;i<100;i++){status=await client.mcp.servers.status({profile,serverId});if(status.connectionState==='ready')break;await wait(100)}
  const catalog=await client.mcp.servers.tools.list({profile,serverId});rows.push({serverId,disabled,reconnected:status.connectionState==='ready',connection_state:status.connectionState,tools:catalog.items.map(x=>x.name).sort()})
}
const result={generated_at:new Date().toISOString(),rows,robot_tools:rows.find(x=>x.serverId==='robot-mcp')?.tools.length||0,environment_tools:rows.find(x=>x.serverId==='envdoor')?.tools||[],pass:rows.find(x=>x.serverId==='robot-mcp')?.tools.length===8&&rows.every(x=>x.reconnected)}
await writeFile(`${ROOT}/artifacts/indoor-rescue-upgrade/managed-mcp-restart-validation.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await client.close?.()
