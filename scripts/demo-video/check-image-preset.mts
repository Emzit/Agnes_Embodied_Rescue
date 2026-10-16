import fs from "node:fs";
import {createClient,memoryJournal} from "../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
const R="/data-ssd/zhongchengkai/agnes",o=JSON.parse(fs.readFileSync(R+"/.agh-home-step7/data/daemon/owner.json","utf8"));
const c=createClient({transport:{kind:"unix",path:o.socketPath},auth:{kind:"local"},journal:memoryJournal()});
try{await c.initialize();const n=JSON.parse(fs.readFileSync(R+"/artifacts/demo-ui-final/native-session-state.json","utf8"));
 await c.session.load(n.session_id,{cwd:R});
 const t:any=await c.call("_agnes/v1/session.projectUI",{sessionId:n.session_id,surface:"web"});
 const turn=t.turns?.at(-1);if(turn&&["running","waiting"].includes(turn.status))throw Error("NATIVE_TURN_NOT_TERMINAL");
 if(process.argv.includes("--standard-only")){console.log(JSON.stringify({native_session:n.session_id,native_turn:turn?.status||"idle",runtime_restored:true}));}
 else {
 const s=await c.session.new({cwd:R,preset:"sensor-image",sessionKey:"sensor-preset-activation-check-"+Date.now()});
 const config=await c.config.get();if(!config.configured||config.provider?.id!=="agnes-ai"||config.provider?.model!=="agnes-3.0-flash")throw Error("WRONG_PROVIDER");
 const report={at:new Date().toISOString(),native_session:n.session_id,native_turn:turn?.status||"idle",image_session:s.id,preset:"sensor-image",provider:config.provider.id,model:config.provider.model};
 fs.writeFileSync(R+"/artifacts/workflow-speed-20261013/live-preset-check.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
 }
}finally{await c.close();}
