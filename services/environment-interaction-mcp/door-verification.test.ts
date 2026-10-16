import test from "node:test";
import assert from "node:assert/strict";
import { freshStoppedDoorSample, postDoorReads, cameraAfterDoorStop } from "./door-verification.ts";
import type { DoorSample } from "./door-actuation.ts";

const baseline: DoorSample = { hinge_angle:1.55,handle_angle:.01,hinge_velocity:0,
  handle_velocity:-.05,sim_time:10,received_at:1000 };
test("zero acknowledgement does not substitute for a fresh stopped simulation sample", async () => {
  let t=1000, sample={...baseline};
  const value=await freshStoppedDoorSample({sample:()=>sample,setVelocity:async()=>{throw Error("read only");}},
    baseline,async ms=>{t+=ms;if(t>=1050)sample={...baseline,handle_velocity:0,sim_time:10.1,received_at:t};},()=>t);
  assert.equal(value?.sim_time,10.1);
  assert.equal(value?.handle_velocity,0);
  assert.ok(t>=1050);
});
for (const [name,sample] of [
  ["unchanged simulation frame",{...baseline,handle_velocity:0}],
  ["hinge still moving",{...baseline,hinge_velocity:.05,handle_velocity:0,sim_time:10.1}],
  ["handle still moving",{...baseline,handle_velocity:-.05,sim_time:10.1}],
  ["stale sample",{...baseline,handle_velocity:0,sim_time:10.1,received_at:0}],
  ["missing velocities",{...baseline,handle_velocity:undefined,sim_time:10.1}],
  ["nonfinite angle",{...baseline,hinge_angle:NaN,handle_velocity:0,sim_time:10.1}],
] as const) {
  test("verification fails closed for "+name,async()=>{
    let t=1000;
    const value=await freshStoppedDoorSample({sample:()=>sample as DoorSample,setVelocity:async()=>({code:0})},
      baseline,async ms=>{t+=ms;},()=>t,100);
    assert.equal(value,null);
  });
}
test("post-door panel and new-image perception start independently without serial wait",async()=>{
  const starts:string[]=[];
  let panelResolve:(v:any)=>void=()=>{},cameraResolve:(v:any)=>void=()=>{};
  const pending=postDoorReads(
    ()=>{starts.push("panel");return new Promise(resolve=>panelResolve=resolve);},
    ()=>{starts.push("camera");return new Promise(resolve=>cameraResolve=resolve);});
  assert.deepEqual(starts,["panel","camera"]);
  cameraResolve({perception_status:"AVAILABLE",semantic_objects:[]});
  panelResolve({yaw_rad:1.55});
  const value=await pending;
  assert.equal(value.panel.yaw_rad,1.55);
  assert.equal(value.camera.perception_status,"AVAILABLE");
});

test("post-door observation must follow the stopped joint header on the real simulation clock",()=>{
  const sample={...baseline,handle_velocity:0,sim_time:10.2};
  const camera=(sec:number,nanosec:number)=>({camera:{available:true,frame_timestamp:{sec,nanosec}}});
  assert.equal(Boolean(cameraAfterDoorStop(camera(10,200000001),sample)),true);
  assert.equal(Boolean(cameraAfterDoorStop(camera(10,200000000),sample)),false);
  assert.equal(Boolean(cameraAfterDoorStop(camera(10,190000000),sample)),false);
  assert.equal(Boolean(cameraAfterDoorStop(camera(10,1e9),sample)),false);
  assert.equal(Boolean(cameraAfterDoorStop(camera(10,.5),sample)),false);
  assert.equal(Boolean(cameraAfterDoorStop({camera:{available:false}},sample)),false);
  assert.equal(Boolean(cameraAfterDoorStop(camera(10,500000000),null)),false);
});
