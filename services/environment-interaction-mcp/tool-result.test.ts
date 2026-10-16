
import test from "node:test";
import assert from "node:assert/strict";
import {environmentToolResult} from "./tool-result.ts";
const image={type:"image",mimeType:"image/png",data:"x".repeat(500000)};
test("large real-frame payload stays out of native textual JSON without losing verification",()=>{
 const input={status:"SUCCEEDED",code:"DOOR_OPEN_VERIFIED",runtime_state:"OPEN",
  verification:{joint_state:{angle_rad:1.55},fresh_camera_observation:{status:"SUCCEEDED",camera:{available:true},
   semantic_objects:[{label:"door",evidence:{frame_sha256:"a".repeat(64)}}],_camera_image:image}}};
 const output=environmentToolResult(input);
 assert.ok(output.content[0].text.length<2000);
 assert.deepEqual(JSON.parse(output.content[0].text),output.structuredContent);
 assert.equal(output.structuredContent.verification.joint_state.angle_rad,1.55);
 assert.equal(output.content.length,1);
 assert.equal(output.structuredContent.verification.fresh_camera_observation._camera_image,undefined);
 assert.equal(input.verification.fresh_camera_observation._camera_image,image);
});
test("door inspection preserves bounded, parseable evidence without another native image artifact",()=>{
 const output=environmentToolResult({status:"FAILED",code:"DOOR_NOT_VISUALLY_OBSERVED",camera_observation:[],_camera_image:image});
 assert.equal(output.isError,true);
 assert.deepEqual(output.structuredContent.camera_observation,[]);
 assert.equal(output.content.length,1);
 assert.ok(!output.content[0].text.includes(image.data));
});
