import test from 'node:test';
import assert from 'node:assert/strict';
import {withOfficeLocalization} from './office-localization.mjs';
test('office config enables actual beamskip and door alignment while retaining safety',()=>{
 const input=`planner_server:
  ros__parameters:
    GridBased:
      tolerance: 0.05
controller_server:
  ros__parameters:
    FollowPath:
      desired_linear_vel: 0.4
      lookahead_dist: 0.6
      min_lookahead_dist: 0.3
      max_lookahead_dist: 0.9
      rotate_to_heading_min_angle: 0.3
      use_collision_detection: true
      use_cost_regulated_linear_velocity_scaling: false
global_costmap:
  global_costmap:
    ros__parameters:
      robot_radius: 0.4
lifecycle_manager:
  ros__parameters:
    node_names: [map_server, planner_server]
`;
 const output=withOfficeLocalization(input,{x:0,y:-6.7,yaw:Math.PI/2});
 assert.match(output,/laser_model_type: likelihood_field_prob/);
 assert.match(output,/do_beamskip: true/);
 assert.match(output,/use_cost_regulated_linear_velocity_scaling: true/);
 assert.match(output,/lookahead_dist: 0.35/);
 assert.match(output,/tolerance: 0.15/);
 assert.match(output,/use_collision_detection: true/);
 assert.match(output,/robot_radius: 0.4/);
 assert.match(output,/desired_linear_vel: 0.4/);
 assert.equal((output.match(/^amcl:$/gm)||[]).length,1);
 assert.equal(withOfficeLocalization(output,{x:0,y:-6.7,yaw:Math.PI/2}),output);
});
test('invalid localization start fails before creating a config',()=>{
 assert.throws(()=>withOfficeLocalization('',{x:NaN,y:0,yaw:0}),/INVALID_LOCALIZATION_START/);
});

import fs from 'node:fs';
import {scenarioForSeed,writeScenario}from'./scenario-manager.mjs';
test('localization survives map selection, seeded generation and runtime environment writing',t=>{
 const layout={...scenarioForSeed(1185).layout,imported:true,localization:'amcl'};
 const spec=scenarioForSeed(1185,{layout});
 assert.equal(spec.layout.localization,'amcl');
 const writes=[];t.mock.method(fs,'mkdirSync',()=>undefined);t.mock.method(fs,'writeFileSync',(file,data)=>writes.push({file:String(file),data:String(data)}));
 writeScenario(spec);
 const env=writes.find(row=>row.file.endsWith('/current-scenario.env'));
 assert.ok(env);assert.match(env.data,/^export SCENARIO_LOCALIZATION=amcl$/m);
});
test('classic selection clears AMCL so switches cannot inherit office localization',t=>{
 const spec=scenarioForSeed(1185);
 const writes=[];t.mock.method(fs,'mkdirSync',()=>undefined);t.mock.method(fs,'writeFileSync',(file,data)=>writes.push({file:String(file),data:String(data)}));
 writeScenario(spec);assert.match(writes.find(row=>row.file.endsWith('/current-scenario.env')).data,/^export SCENARIO_LOCALIZATION=$/m);
});
