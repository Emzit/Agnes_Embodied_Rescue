import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readInteractionMap } from "./interaction-map.ts";


const ROOT="/data-ssd/zhongchengkai/agnes";
test("office door map exposes approach IDs without pretending to observe door state", () => {
  const folder=ROOT+"/artifacts/door-command-fix-20261013/map-tests";
  mkdirSync(folder,{recursive:true});
  const dir=mkdtempSync(folder+"/case-");
  const entries=[["Upper_Connector",2.25,5.9],["Right_Front_Room",6.75,5.9],["Right_Front_Door_interaction",3.4,5.7]];
  writeFileSync(dir+"/world_registry.json",JSON.stringify({version:1,frame_id:"map",nearest_threshold:.45,
    locations:entries.map(([id,x,y])=>({id,name:id,type:"corridor",pose:{x,y,yaw:0,frame_id:"map"},adjacency:[]}))}));
  writeFileSync(dir+"/interaction-registry.json",JSON.stringify({source:"map_prior",doors:[{id:"Right_Front_Door",
    connects:["Upper_Connector","Right_Front_Room"],interaction_pose:{x:3.4,y:5.7,yaw:0},at:[4.5,5.7],mechanism:"hinge"}]}));
  const map=readInteractionMap(dir+"/interaction-registry.json",dir+"/world_registry.json","office_test");
  assert.equal(map.status,"SUCCEEDED");
  assert.equal(map.world_name,"office_test");
  assert.equal(map.map_prior_only,true);
  const door=map.doors.find((d:any)=>d.connects.includes("Right_Front_Room"));
  assert.equal(door.id,"Right_Front_Door");
  assert.equal(door.interaction_location,"Right_Front_Door_interaction");
  assert.equal(door.runtime_state,"UNKNOWN");
  const approach=map.locations.find(l=>l.id===door.interaction_location);
  assert.deepEqual(approach?.pose,{...door.interaction_pose,frame_id:"map"});
  assert.ok(map.doors.every((d:any)=>d.runtime_state==="UNKNOWN"));
  assert.ok(!JSON.stringify(map).includes("person_pose"));
});
test("map reader rejects paths outside the authorized workspace", () => {
  assert.throws(()=>readInteractionMap("/tmp/map.json",undefined,"fake"),/MAP_PRIOR_OUTSIDE_WORKSPACE/);
});
