/** Image-only perception via official Agnes SDK. Never reads credentials or world files. */
import { readFile,appendFile,mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { visualTurnFailure } from "./vlm-turn.ts";
import { createInterface } from "node:readline";
import { VISUAL_INSPECTION_PROMPT, DOOR_INSPECTION_PROMPT, VISUAL_SCHEMA_CORRECTION_PROMPT, parseVisualDetections } from "./vlm-output.ts";
import { createClient,memoryJournal } from "../../../third_party/agnes-harness/packages/sdk/src/index.node.ts";
const root="/data-ssd/zhongchengkai/agnes";
let client:any;
let stage="CONNECT";
let inferenceContext:any={};
async function recordFailure(request:any){
  const text=String(inferenceContext.text??""),trimmed=text.trim(),at=new Date().toISOString();
  const directory=root+"/artifacts/perception-failures";
  const record={at,stage,session_id:inferenceContext.session_id??null,request_id:String(request.id),
    method:request.method,repair_invalid_schema:request.repair_invalid_schema===true,
    frame_sha256:createHash("sha256").update(Buffer.from(request.png??"","base64")).digest("hex"),
    assistant_output_length:text.length,assistant_output_sha256:createHash("sha256").update(text).digest("hex"),
    assistant_text:trimmed==="{}"?text:(trimmed===""?"":"WITHHELD_NON_EMPTY_OUTPUT_SEE_NATIVE_SESSION"),
    native_turn:inferenceContext.turn??null,tool_calls:inferenceContext.toolCalls??0};
  try{await mkdir(directory,{recursive:true});await appendFile(directory+"/"+at.slice(0,10)+".jsonl",JSON.stringify(record)+"\n");}
  catch{console.error("PERCEPTION_FAILURE_AUDIT_WRITE_FAILED");}
}
function textOf(d:any):string {
  return typeof d==="string"?d:d?.text??(Array.isArray(d?.content)?d.content.map(textOf).join(""):Array.isArray(d)?d.map(textOf).join(""):"");
}
async function connect(){
  if(client)return client;
  const owner=JSON.parse(await readFile(`${root}/.agh-home-step7/data/daemon/owner.json`,"utf8"));
  client=createClient({transport:{kind:"unix",path:owner.socketPath},auth:{kind:"local"},journal:memoryJournal()});
  await client.initialize();
  const config=await client.config.get();
  if(!config.configured || config.provider?.id!=="agnes-ai" || config.provider?.model!=="agnes-3.0-flash")throw Error("VLM_PROVIDER_NOT_ACTIVE");
  return client;
}
async function detect(request:any){
  stage="CONNECT";inferenceContext={};
  const c=await connect();
  if(request.method==="audit")return {provider:"agnes-ai",model:"agnes-3.0-flash",configured:true,image_catalog_support:true,required_preset:"sensor-image"};
  stage="SESSION_NEW";
  const session=await c.session.new({cwd:root,preset:"sensor-image",sessionKey:`phase10-image-${Date.now()}`});
  inferenceContext.session_id=session.id;
  await session.attach();
  const remove=session.onPermissionRequest(async(r:any)=>({optionId:r.options.find((o:any)=>o.kind==="reject_once").optionId}));
  const iterator=session.events()[Symbol.asyncIterator]();
  let text="";
  let toolCalls=0;
  const reading=(async()=>{for(;;){const item=await iterator.next();if(item.done)break;
    if(item.value.type==="tool/call") {toolCalls++;inferenceContext.toolCalls=toolCalls;void session.cancel().catch(()=>undefined);}
    if(item.value.type==="assistant/message"){
      const d=item.value.data;
      text+=textOf(d);inferenceContext.text=text;
    }
  }})();
  try{
    stage="IMAGE_PROMPT";
    const prompt=(request.method==="detect_door"?DOOR_INSPECTION_PROMPT:VISUAL_INSPECTION_PROMPT)
      +(request.repair_invalid_schema===true?VISUAL_SCHEMA_CORRECTION_PROMPT:"");
    const timeout=Number.isFinite(request.timeout_ms)?Math.max(1000,Math.min(45000,Math.floor(request.timeout_ms))):45000;
    const signal=AbortSignal.timeout(timeout);
    try {
      inferenceContext.turn=await session.prompt([{type:"text",text:prompt},
        {type:"image",data:request.png,mimeType:"image/png"}],{signal});
    } catch (error) {
      if(signal.aborted)stage="INFERENCE_TIMEOUT";
      throw error;
    }
    const failure=visualTurnFailure(inferenceContext.turn, signal.aborted);
    if(failure){stage=failure;throw Error("VLM_"+failure);}
    stage="EVENT_READING";
    await iterator.return?.();await reading;
    if(toolCalls){stage="TOOL_CALL_FORBIDDEN";throw Error("VLM_TOOL_CALL_FORBIDDEN");}
    if(!text.trim()){stage="EMPTY_ASSISTANT_OUTPUT";throw Error("VLM_EMPTY_OUTPUT");}
    stage="JSON_PARSE";
    let detections: any[];
    try { detections = parseVisualDetections(text); }
    catch { stage="NO_VALID_DETECTIONS_JSON"; throw Error("VLM_INVALID_OUTPUT"); }
    return {provider:"agnes-ai",model:"agnes-3.0-flash",detections,tool_calls:toolCalls};
  }finally{remove();await iterator.return?.();await reading;await session.detach?.();}
}
try{
  for await(const line of createInterface({input:process.stdin})){
    const request=JSON.parse(line);
    try{const result=await detect(request);console.log(JSON.stringify({id:request.id,ok:true,result}));}
    catch{await recordFailure(request);console.log(JSON.stringify({id:request.id,ok:false,error:{code:"VLM_UNAVAILABLE_OR_INVALID_OUTPUT",stage}}));}
  }
}finally{await client?.close();}
