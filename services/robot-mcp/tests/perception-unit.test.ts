import assert from "node:assert/strict";
import test from "node:test";
import { Ros2RobotGateway } from "../src/transport/ros2-gateway.ts";
import { WorldRegistry } from "../src/transport/world-registry.ts";
import { RuntimeWorldState } from "../src/transport/runtime-world-state.ts";
import { BridgeError,type JsonlBridge } from "../src/transport/jsonl-bridge.ts";
import { fileURLToPath } from "node:url";
test("inspection validates room and real pose, never teleports or returns mock",async()=>{
  const registry=WorldRegistry.load(fileURLToPath(new URL("../../../simulation/phase9f/world_registry.json",import.meta.url)));
  const calls:string[]=[];
  const bridge={request:async(method:string)=>{
    calls.push(method);if(method==="get_robot_state")return {pose:{x:0,y:0}};
    throw new BridgeError("INVALID_OBJECT");
  }} as unknown as JsonlBridge;
  const g=new Ros2RobotGateway({registry,bridge});
  assert.equal((await g.inspectRoom("absent")).code,"INVALID_LOCATION");
  assert.equal((await g.inspectRoom("Room_B")).code,"NOT_AT_LOCATION");
  assert.equal((await g.inspectObject("never_observed")).code,"INVALID_OBJECT");
  assert.ok(!calls.includes("navigate_to"));
});
test("runtime records only actual perception evidence; uncertain confidence is not inflated",()=>{
  const r=new RuntimeWorldState();
  assert.deepEqual(r.snapshot().observed_objects,[]);
  const d={id:"unit-fixture",label:"person",confidence:0.61,timestamp:{sec:1,nanosec:0},evidence:{method:"unit-only"}};
  r.recordDetections([d],"some_region");
  r.recordInspection({status:"SUCCEEDED",room:"some_region",inspected:true,detections:[d]},"some_region");
  r.recordInspection({status:"SUCCEEDED",object_id:d.id,before_confidence:0.61,after_confidence:0.58,still_uncertain:true,evidence:[]},"some_region");
  assert.equal(r.snapshot().observed_objects[0].confidence,0.58);
  assert.equal(r.snapshot().confidence_history.at(-1).after,0.58);
  assert.deepEqual(r.snapshot().inspected_rooms,["some_region"]);
});
