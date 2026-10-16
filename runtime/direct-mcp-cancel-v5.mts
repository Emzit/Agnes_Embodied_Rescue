import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '../third_party/agnes-harness/node_modules/.pnpm/@modelcontextprotocol+sdk@1.25.2_hono@4.13.7_zod@4.5.4/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../third_party/agnes-harness/node_modules/.pnpm/@modelcontextprotocol+sdk@1.25.2_hono@4.13.7_zod@4.5.4/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root='/data-ssd/zhongchengkai/agnes';
const out=`${root}/artifacts/navigation-reliability-v5/direct-mcp-cancel.json`;
const transport=new StdioClientTransport({command:`${root}/tools/node/bin/node`,args:[`${root}/scripts/final-rescue/mcp-launch.mjs`],stderr:'pipe'});
const c=new Client({name:'v5-direct-mcp-cancel',version:'1'},{capabilities:{}});
const controller=new AbortController(); const started=Date.now();
const timer=setTimeout(()=>controller.abort(new Error('controlled_test_cancel')),1500);
let outcome:any;
try { await c.connect(transport); await c.callTool({name:'navigate_to',arguments:{location:'Start'}},undefined,{signal:controller.signal}); outcome={client_result:'unexpected_response'}; }
catch (error:any) { outcome={client_result:'aborted',error_name:error?.name||null,error_message:String(error?.message||error)}; }
finally { clearTimeout(timer); await new Promise(r=>setTimeout(r,3000)); await c.close().catch(()=>{}); }
const body={generated_at:new Date().toISOString(),kind:'real_robot_mcp_controlled_request_cancel',started_at_ms:started,finished_at_ms:Date.now(),outcome,server_trace:'artifacts/final_rescue/manual/mcp-events.jsonl',safety:'controlled client abort; no success mapping'};
await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true}); await writeFile(out,JSON.stringify(body,null,2)+'\n'); console.log(JSON.stringify(body));
