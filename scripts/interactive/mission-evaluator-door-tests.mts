import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMission, extractRequirements } from "./mission-evaluator.mts";

const context={
  locations:[{id:"Start",name:"起点",type:"start"},{id:"Right_Front_Room",name:"右前方小房间",type:"room"},
             {id:"Right_Front_Door_interaction",name:"门口",type:"corridor"}],
  doors:[{id:"Right_Front_Door",connects:["Right_Front_Room"],interaction_location:"Right_Front_Door_interaction",interaction_pose:{x:3.4,y:5.7}}],
};
const task="去Right Front Room把门打开";
const nav=(target="Right_Front_Door_interaction")=>({type:"tool_result",tool:"mcp_robot_mcp_hash_navigate_to",
  result:{status:"SUCCEEDED",accepted:true,action_status:"SUCCEEDED",target}});
const inspect=()=>({type:"tool_result",tool:"mcp_envdoor_hash_inspect_door",result:{
  status:"SUCCEEDED",door_id:"Right_Front_Door",evidence:{source:"real Camera + Agnes VLM + Gazebo panel",
  near_interaction_pose:true,frame_hashes:["a".repeat(64)]}}});
const open=(id="Right_Front_Door",status="SUCCEEDED")=>({type:"tool_result",tool:"mcp_envdoor_hash_open_door",
  result:{status,door_id:id,runtime_state:"OPEN",code:"DOOR_OPEN_VERIFIED",verification:{source:"real Gazebo joint"}}});
const evaluate=(events:any[],text=task)=>evaluateMission(text,events,"已经到达门口并通过实测确认门已打开。",null,false,undefined,null,context);

test("original command, ID formatting and Chinese room name select outside door approach",()=>{
  for(const text of [task,"去Right_Front_Room把门打开","前往右前方小房间并开门","go to Right Front Room and open the door"]) {
    const req=extractRequirements(text,undefined,context);
    assert.deepEqual(req.required_locations,["Right_Front_Door_interaction"]);
    assert.equal(req.required_door_openings[0]?.door_id,"Right_Front_Door");
    assert.equal(req.navigation_target_missing,false);
  }
});
test("arrival alone cannot complete a door-opening task",()=>{
  const result=evaluate([nav()]);
  assert.equal(result.status,"PARTIAL");
  assert.ok(result.reasons.includes("REQUIRED_DOOR_OPEN_NOT_CONFIRMED"));
});
test("arrival, real frame-backed inspection and measured open complete the outside-door objective",()=>{
  const result=evaluate([nav(),inspect(),open()]);
  assert.equal(result.status,"SUCCEEDED");
  assert.equal(result.evidence.doors[0].open_verified,true);
});
test("wrong, failed or unobserved opening cannot be certified",()=>{
  for(const events of [[nav(),inspect(),open("obsolete_door")],[nav(),inspect(),open("Right_Front_Door","FAILED")],[nav(),open()]]) {
    assert.notEqual(evaluate(events).status,"SUCCEEDED");
  }
});
test("opening and entering remain separate objectives",()=>{
  const text="去Right Front Room把门打开，然后进入房间";
  assert.deepEqual(extractRequirements(text,undefined,context).required_locations,["Right_Front_Door_interaction","Right_Front_Room"]);
  assert.notEqual(evaluate([nav(),inspect(),open()],text).status,"SUCCEEDED");
  assert.equal(evaluate([nav(),inspect(),open(),nav("Right_Front_Room")],text).status,"SUCCEEDED");
});
test("explicit return still requires the real final navigation",()=>{
  const text=task+"，完成后返回Start";
  assert.notEqual(evaluate([nav(),inspect(),open()],text).status,"SUCCEEDED");
  assert.equal(evaluate([nav(),inspect(),open(),nav("Start")],text).status,"SUCCEEDED");
});
test("the original failed tool records remain failed, never cosmetically promoted",()=>{
  const result=evaluateMission(task,[
    {type:"tool_result",tool:"mcp_robot_mcp_hash_navigate_to",result:{status:"FAILED",accepted:false,code:"INVALID_LOCATION",target:"Right Front Room"}},
    {type:"tool_result",tool:"mcp_envdoor_hash_open_door",result:{status:"FAILED",code:"UNKNOWN_DOOR",door_id:"door_room4_5_left"}},
  ],"两个操作都失败了。让我重新检查。",null,false,undefined,null,context);
  assert.equal(result.status,"FAILED");
  assert.ok(result.reasons.includes("REQUIRED_DOOR_OPEN_NOT_CONFIRMED"));
});
test("forbidden opening remains a constraint violation",()=>{
  const text="去Right Front Room，不要开门";
  const req=extractRequirements(text,undefined,context);
  assert.deepEqual(req.required_door_openings,[]);
  const result=evaluate([nav("Right_Front_Room"),inspect(),open()],text);
  assert.notEqual(result.status,"SUCCEEDED");
  assert.ok(result.reasons.includes("FORBIDDEN_CONSTRAINT_VIOLATED"));
});

const state=(x=3.24,y=5.77)=>({type:"tool_result",tool:"mcp_robot_mcp_hash_get_robot_state",
 timestamp:"2026-10-13T02:28:14Z",result:{pose:{x,y,frame_id:"map"},navigation_active:false,linear_velocity:0,angular_velocity:0}});
const approachInspect=()=>({...inspect(),timestamp:"2026-10-13T02:28:19Z",result:{...inspect().result,
 robot_pose:{x:3.24,y:5.77,frame_id:"map"}}});
test("already at the current door approach succeeds with this-turn stationary ROS pose and measured opening",()=>{
 const result=evaluate([state(),approachInspect(),open()]);
 assert.equal(result.status,"SUCCEEDED");
 assert.equal(result.counts.navigation,0);
 assert.equal(result.evidence.navigation.location_checks[0].navigation_success,false);
 assert.equal(result.evidence.navigation.location_checks[0].approach_pose_verified,true);
});
test("map prior, missing pose, distant robot, moving robot and stale pose cannot stand in for arrival",()=>{
 for(const events of [
  [approachInspect(),open()], [state(0,0),approachInspect(),open()],
  [{...state(),result:{...state().result,navigation_active:true}},approachInspect(),open()],
  [{...state(),timestamp:"2026-10-13T02:20:00Z"},approachInspect(),open()],
  [state(),inspect(),open()],
 ]) assert.notEqual(evaluate(events).status,"SUCCEEDED");
});
test("approach pose proof does not satisfy entering the room or returning elsewhere",()=>{
 for(const text of [task+"，然后进入房间",task+"，然后返回Start"])
  assert.notEqual(evaluate([state(),approachInspect(),open()],text).status,"SUCCEEDED");
});

test("a proven initial door approach can precede a separately verified asynchronous return",()=>{
 const pending={type:"tool_result",tool:"mcp_robot_mcp_hash_navigate_to",result:{status:"PENDING",operation_id:"return-1",target:"Start"}};
 const terminal={type:"tool_result",tool:"mcp_robot_mcp_hash_get_robot_state",result:{navigation_operation_id:"return-1",
  navigation_terminal_known:true,navigation_terminal_status:"SUCCEEDED",current_location:"Start",pose:{x:0,y:0,frame_id:"map"}}};
 assert.equal(evaluate([state(),approachInspect(),open(),pending,terminal],task+"，然后返回Start").status,"SUCCEEDED");
});

test("keeping an already open second door does not request another opening or navigation",()=>{
 const map={locations:context.locations,doors:[...context.doors,
  {id:"Right_Middle_Door",connects:[],interaction_location:"Right_Middle_Door_interaction"}]};
 const req=extractRequirements("前往 Right_Middle_Door_interaction，打开 Right_Middle_Door；Right_Front_Door 保持已打开状态。",undefined,map);
 assert.deepEqual(req.required_door_openings.map(d=>d.door_id),["Right_Middle_Door"]);
 assert.ok(!req.required_locations.includes("Right_Front_Door_interaction"));
});

test("a prior failed route is context, while an explicit final door waypoint keeps its order",()=>{
 const map={locations:[...context.locations,
  {id:"Main_Corridor",name:"主通道",type:"corridor"},{id:"Cross_Hall",name:"横向通道",type:"corridor"},
  {id:"Office_Aisle",name:"办公通道",type:"corridor"},{id:"Entry_Hall",name:"入口大厅",type:"corridor"}],doors:context.doors};
 const task="继续完成 Right_Front_Door 的开门复验。上一轮直接沿 Main_Corridor 的路线失败，请改走旁通道：依次 navigate_to Cross_Hall、Office_Aisle、Entry_Hall，最后 Right_Front_Door_interaction。";
 assert.deepEqual(extractRequirements(task,undefined,map).required_locations,
  ["Cross_Hall","Office_Aisle","Entry_Hall","Right_Front_Door_interaction"]);
});

// Native gateway may deliver an upstream error inside a nominally completed SSE turn.
test("single-sentence rescue tasks require observed people and cannot pass an embedded provider failure",()=>{
 for(const task of ["请找到一个待救援人员。","请找到待援救人员"]){
  const req=extractRequirements(task,undefined,context);
  assert.equal(req.person_search_required,true);assert.equal(req.rescue_task,true);
  const result=evaluateMission(task,[nav(),inspect(),open()],
   '门已打开，进入房间探索。\n[assistant turn failed: provider error 400: {"error":"message content cannot be empty"}]',null,false,undefined,null,context);
  assert.notEqual(result.status,"SUCCEEDED");
  assert.ok(result.reasons.includes("AGNES_EMBEDDED_PROVIDER_FAILURE"));
 }
});

test("an uncertain reinspection cannot complete a rescue goal even when the model says found",()=>{
 const detection={id:'visual-test',label:'person',confidence:.42,source:'ros2_camera_perception',evidence:{method:'vlm',provider:'agnes-ai',frame_sha256:'a'.repeat(64),frame_timestamp:{sec:1}}};
 const events=[nav(),{type:'tool_result',tool:'inspect_object',result:{status:'SUCCEEDED',still_uncertain:true,detections:[detection]}}];
 const result=evaluateMission('请找到一个待救援人员。',events,'已找到并确认人员，机器人已完成任务。',null,false,undefined,null,context);
 assert.notEqual(result.status,'SUCCEEDED');assert.equal(result.evidence.rescue.person_observed,false);
});

test("a fresh high-confidence Agnes camera target can finish a find-only task without redundant active reinspection",()=>{
 const d={id:'visual-test',label:'person',confidence:.95,source:'ros2_camera_perception',evidence:{method:'vlm',provider:'agnes-ai',frame_sha256:'a'.repeat(64),frame_timestamp:{sec:1}}};
 const events=[{type:'tool_result',tool:'get_observation',result:{status:'SUCCEEDED',source:'ros2_real_sensors',detections:[d]}}];
 const result=evaluateMission('请找到一个待救援人员。',events,'已通过本轮真实相机确认一名人员，视觉置信度0.95；已记录观察位置和图像证据，当前搜寻目标完成，不代表已经完成实际撤离或身份核验。',null,false,undefined,null,context);
 assert.equal(result.status,'SUCCEEDED');assert.equal(result.evidence.rescue.person_observed,true);
});
