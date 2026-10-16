import assert from "node:assert/strict";
import test from "node:test";
import { Ros2RobotGateway } from "../src/transport/ros2-gateway.ts";
import { BridgeError, type JsonlBridge } from "../src/transport/jsonl-bridge.ts";

test("sensor gateway delegates to ROS bridge and propagates failure without mock fallback", async () => {
  const calls: unknown[]=[];
  const bridge={request: async (...args:unknown[])=>{
    calls.push(args); throw new BridgeError("SENSOR_TEST_UNAVAILABLE");
  }} as unknown as JsonlBridge;
  const gateway=new Ros2RobotGateway({bridge});
  await assert.rejects(gateway.getObservation({object_id:"any-input"}),{code:"SENSOR_TEST_UNAVAILABLE"});
  assert.deepEqual(calls,[["get_observation",{},65000]]);
  for(const result of [await gateway.inspectRoom("any"),await gateway.inspectObject("any")]) {
    assert.equal(result.status,"FAILED");assert.notEqual(result.code,"ROS2_MVP_NOT_IMPLEMENTED");
  }
});

test("motion lease rejection remains an explicit safe reason", async () => {
  const bridge={request: async (method:string)=>{
    if (method === "get_robot_state") return {pose:{x:2,y:1}, current_location:"Room_A"};
    throw new BridgeError("MOTION_CONTROL_BUSY");
  }} as unknown as JsonlBridge;
  const gateway=new Ros2RobotGateway({bridge});
  const result=await gateway.inspectRoom("Room_A");
  assert.equal(result.status,"FAILED");
  assert.equal(result.code,"MOTION_CONTROL_BUSY");
  assert.equal(result.reason,"MOTION_CONTROL_BUSY");
});
