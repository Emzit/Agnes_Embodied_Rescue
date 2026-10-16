
import test from "node:test";import assert from "node:assert/strict";
import {withOfficeLocalization} from "./office-localization.mjs";
test("office localization adds one AMCL node and uses the actual spawn prior",()=>{
 const base="lifecycle_manager:\n  ros__parameters:\n    node_names: [map_server, planner_server, controller_server]\n";
 const once=withOfficeLocalization(base,{x:0,y:-6.7,yaw:Math.PI/2});
 assert.equal(once.split("\namcl:").length,2);
 assert.match(once,/node_names: \[map_server, amcl,/);
 assert.match(once,/y: -6\.70000000/);
 assert.match(once,/yaw: 1\.57079633/);
 assert.match(once,/scan_topic: \/scan/);
 assert.equal(withOfficeLocalization(once,{x:0,y:-6.7,yaw:Math.PI/2}),once);
});
test("invalid pose priors are rejected",()=>{
 assert.throws(()=>withOfficeLocalization("",{x:NaN,y:0,yaw:0}),/INVALID_LOCALIZATION_START/);
});
