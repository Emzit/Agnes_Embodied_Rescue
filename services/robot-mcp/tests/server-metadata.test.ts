import assert from "node:assert/strict";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";

// Real MCP initialize/listTools protocol against the isolated mock backend:
// no daemon connection, model request, ROS node, navigation, or live tracing.
test("MCP catalog marks only passive state and location listing as read-only",async()=>{
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const client=new Client({name:"metadata-regression",version:"1.0"},{capabilities:{}});
  const env=Object.fromEntries(Object.entries(process.env).filter(([,v])=>typeof v==="string")) as Record<string,string>;
  const transport=new StdioClientTransport({
    command:process.execPath,
    args:["--import",root+"third_party/agnes-harness/node_modules/tsx/dist/loader.mjs",root+"services/robot-mcp/src/server.ts"],
    cwd:root,env:{...env,ROBOT_GATEWAY:"mock",ROBOT_TRACE_DIR:""},
  });
  try{
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.equal(tools.length,8);
    assert.deepEqual(tools.filter(t=>t.annotations?.readOnlyHint===true).map(t=>t.name).sort(),
      ["get_robot_state","list_known_locations"]);
    for(const name of ["navigate_to","inspect_room","inspect_object","stop_robot","get_world_state","get_observation"]){
      assert.notEqual(tools.find(t=>t.name===name)?.annotations?.readOnlyHint,true);
    }
    const state=tools.find(t=>t.name==="get_robot_state")!;
    assert.deepEqual(state.inputSchema,{type:"object",properties:{},additionalProperties:false});
  }finally{
    await client.close();
  }
});
