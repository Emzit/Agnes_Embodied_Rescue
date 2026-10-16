import assert from "node:assert/strict";
import test from "node:test";
import {
  embodiedRescuePlugin,
  embodiedRescueSkills,
} from "../index.mjs";

const captureTools = () => {
  const tools: Array<Record<string, any>> = [];
  const hooks:any[]=[];
  embodiedRescuePlugin.apply({
    extension: () => ({
      registerTool: (tool: Record<string, any>) => tools.push(tool),
      registerHook: (name:string,handler:any)=>hooks.push({name,handler}),
    }),
  });
  Object.assign(tools,{hooks});
  return tools;
};

test("Agnes runtime entry registers only cognitive tools", async () => {
  const tools = captureTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "mission_get_state",
      "mission_reset",
      "world_memory_get",
      "world_memory_update",
      "decision_score_candidates",
    ],
  );
  assert.equal(tools.some((tool) => tool.name === "navigate_to"), false);
  assert.equal(tools.find((tool) => tool.name === "mission_get_state").meta.isReadOnly, true);
  assert.equal(tools.find((tool) => tool.name === "world_memory_get").meta.isReadOnly, true);
  assert.equal(tools.find((tool) => tool.name === "world_memory_update").meta.isReadOnly, false);
  assert.equal(tools.find((tool) => tool.name === "mission_reset").meta.isReadOnly, false);

  const decisionTool = tools.find((tool) => tool.name === "decision_score_candidates");
  const decision = await decisionTool.execute({
    goal: "reach target",
    world_state: {},
    candidates: [
      {
        id: "route_room_c",
        type: "navigate",
        features: { safety: 0.9, success: 0.9, cost: 0.6, information_gain: 0.3 },
      },
      {
        id: "wait",
        type: "wait",
        features: { safety: 1, success: 0.1, cost: 0.1, information_gain: 0 },
      },
    ],
  });
  assert.equal(decision.structured.provider_name, "fallback");

  const malformedDecision = await decisionTool.execute({
    goal: "find a person",
    world_state: {},
    candidates: [{ option: "navigate_to_Room_C" }],
  });
  assert.equal(malformedDecision.isError, undefined);
  assert.equal(malformedDecision.structured.selected_action, null);
  assert.deepEqual(malformedDecision.structured.reason_codes, ["INVALID_DECISION_INPUT"]);
  const candidateSchema = decisionTool.parameters.properties.candidates.items;
  assert.deepEqual(candidateSchema.required, ["id", "type", "features"]);
  assert.deepEqual(candidateSchema.properties.features.required, ["safety", "success", "cost", "information_gain"]);

  const updateTool = tools.find((tool) => tool.name === "world_memory_update");
  await updateTool.execute({ searched_room: "Room_A" });
  const stateTool = tools.find((tool) => tool.name === "mission_get_state");
  const updated = await stateTool.execute({});
  assert.deepEqual(updated.structured.world_memory.searched_rooms, ["Room_A"]);

  const resetTool = tools.find((tool) => tool.name === "mission_reset");
  await resetTool.execute({});
  const reset = await stateTool.execute({});
  assert.deepEqual(reset.structured.world_memory.searched_rooms, []);
});

test("Agnes runtime entry contributes one embodied-rescue Skill", () => {
  const skills: Array<Record<string, string>> = [];
  embodiedRescueSkills.apply({
    skills: { register: (skill: Record<string, string>) => skills.push(skill) },
  });
  assert.deepEqual(skills.map((skill) => skill.name), ["embodied-rescue"]);
  assert.match(skills[0].body, /Do not expand a single-target search into an exhaustive room or door survey/);
});

test("runtime mission_reset rejects a completed mission without changing state", async () => {
  const tools = captureTools();
  const updateTool = tools.find((tool) => tool.name === "world_memory_update");
  const stateTool = tools.find((tool) => tool.name === "mission_get_state");
  const resetTool = tools.find((tool) => tool.name === "mission_reset");

  await (tools as any).hooks[0].handler({name:'mcp_robot_mcp_hash_get_observation',result:{structured:{status:'SUCCEEDED',detections:[{id:'observed',label:'person',confidence:.95,source:'ros2_camera_perception',evidence:{method:'vlm',provider:'agnes-ai',frame_sha256:'a'.repeat(64),frame_timestamp:{sec:1}}}]}}});
  await updateTool.execute({ target_status: "FOUND", replan: true, active_perception: true });
  const before = await stateTool.execute({});
  const rejected = await resetTool.execute({});
  const after = await stateTool.execute({});

  assert.equal(rejected.structured.ok, false);
  assert.equal(rejected.structured.code, "MISSION_ALREADY_COMPLETE");
  assert.deepEqual(after.structured, before.structured);
});

test("runtime target completion requires actual confident sensor evidence, not a model-written claim",async()=>{
 const tools=captureTools(),update=tools.find(t=>t.name==='world_memory_update'),state=tools.find(t=>t.name==='mission_get_state');
 const hook=(tools as any).hooks[0].handler;
 const person=(confidence:number)=>({id:'visual-test',label:'person',confidence,source:'ros2_camera_perception',evidence:{method:'vlm',provider:'agnes-ai',frame_sha256:'a'.repeat(64),frame_timestamp:{sec:1}}});
 for(const raw of [{status:'SUCCEEDED',still_uncertain:true,detections:[person(.42)]},{status:'SUCCEEDED',detections:[person(.35)]}]){
  await hook({name:'mcp_robot_mcp_hash_inspect_object',result:{structured:raw}});
  const rejected=await update.execute({target_status:'found',active_perception:true,last_observation:'confirmed'});
  assert.equal(rejected.structured.code,'TARGET_NOT_CONFIRMED');assert.equal(rejected.isError,true);
  assert.equal((await state.execute({})).structured.status,'IDLE');
 }
 await hook({name:'world_memory_update',result:{structured:{status:'SUCCEEDED',detections:[person(.99)]}}});
 assert.equal((await update.execute({target_status:'found'})).structured.code,'TARGET_NOT_CONFIRMED');
 await hook({name:'mcp_envdoor_hash_open_door',result:{structured:{status:'SUCCEEDED',verification:{fresh_camera_observation:{status:'SUCCEEDED',detections:[person(.95)]}}}}});
 assert.equal((await update.execute({target_status:'found'})).isError,undefined);
 assert.equal((await state.execute({})).structured.status,'COMPLETED');
});
