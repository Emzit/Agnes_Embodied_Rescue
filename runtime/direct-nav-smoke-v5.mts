import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '../third_party/agnes-harness/node_modules/.pnpm/@modelcontextprotocol+sdk@1.25.2_hono@4.13.7_zod@4.5.4/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../third_party/agnes-harness/node_modules/.pnpm/@modelcontextprotocol+sdk@1.25.2_hono@4.13.7_zod@4.5.4/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root='/data-ssd/zhongchengkai/agnes';
const out=`${root}/artifacts/navigation-reliability-v5/direct-nav-smoke.json`;
const transport=new StdioClientTransport({command:`${root}/tools/node/bin/node`,args:[`${root}/scripts/final-rescue/mcp-launch.mjs`],stderr:'pipe'});
const c=new Client({name:'v5-direct-nav-smoke',version:'1'},{capabilities:{}});
const started=Date.now(); const rows:any[]=[];
try {
  await c.connect(transport);
  for (const target of ['Room_A','Start']) {
    const t=Date.now();
    const result:any=await c.callTool({name:'navigate_to',arguments:{location:target}});
    rows.push({target,started_at_ms:t,finished_at_ms:Date.now(),duration_ms:Date.now()-t,result});
  }
  const state:any=await c.callTool({name:'get_robot_state',arguments:{}});
  const body={generated_at:new Date().toISOString(),kind:'real_robot_mcp_infrastructure_smoke',harness_session:null,started_at_ms:started,finished_at_ms:Date.now(),rows,final_state:state};
  await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true}); await writeFile(out,JSON.stringify(body,null,2)+'\n'); console.log(JSON.stringify(body));
} finally { await c.close().catch(()=>{}); }
