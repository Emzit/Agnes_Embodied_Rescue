import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createMapCatalog} from '../../demo/final-dashboard/map-catalog.mjs';
import {scenarioForSeed,writeScenario} from '../interactive/scenario-manager.mjs';
import {withOfficeLocalization} from '../interactive/office-localization.mjs';
import {validateScenario} from '../interactive/solvability-gate.mjs';
const ROOT='/data-ssd/zhongchengkai/agnes',NODE=ROOT+'/tools/node/bin/node';
const [mode,id,job]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(job||''))throw Error('INVALID_JOB');
const out=ROOT+'/artifacts/demo-ui-final/scene-switch/jobs/'+job;fs.mkdirSync(out,{recursive:true});
const save=(n,v)=>fs.writeFileSync(out+'/'+n,JSON.stringify(v,null,2)+'\n');
if(mode==='commit'){writeScenario(JSON.parse(fs.readFileSync(out+'/plan-private.json','utf8')));process.exit(0);}
if(mode!=='prepare')throw Error('INVALID_MODE');
const entry=createMapCatalog().detail(id);
let layout;
if(id==='classic')layout={...scenarioForSeed(1185).layout,id:'layout_c'};
else{
 const builtinSources={lotus:'maps/imported/lotus_demo/lotus_skeleton.json','office-fire':'maps/imported/office_fire/office_skeleton.json'};
 const src=builtinSources[id]?ROOT+'/'+builtinSources[id]:ROOT+'/artifacts/import-skeleton-showcase/uploads/'+entry.upload_id+'.json';
 const source=JSON.parse(fs.readFileSync(src,'utf8'));
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 if(!source.boundary||!['min_x','max_x','min_y','max_y'].every(k=>finite(source.boundary[k])&&Math.abs(source.boundary[k])<=45))throw Error('PHYSICAL_MAP_MUST_FIT_PROJECT_100M_GROUND');
 const b=source.boundary,inside=(x,y)=>finite(x)&&finite(y)&&x>=b.min_x&&x<=b.max_x&&y>=b.min_y&&y<=b.max_y;
 for(const wall of source.walls||[])if(!Array.isArray(wall.a)||!Array.isArray(wall.b)||!inside(...wall.a)||!inside(...wall.b))throw Error('PHYSICAL_WALL_OUTSIDE_BOUNDARY');
 for(const area of [...(source.rooms||[]),...(source.corridors||[])])if(!area.bounds||!inside(area.bounds.min_x,area.bounds.min_y)||!inside(area.bounds.max_x,area.bounds.max_y))throw Error('PHYSICAL_ROOM_OUTSIDE_BOUNDARY');
 for(const door of source.doors||[])if(!Array.isArray(door.at)||!inside(...door.at))throw Error('PHYSICAL_DOOR_OUTSIDE_BOUNDARY');
 const resolution=source.optional_navigation_constraints?.resolution??.1;
 if(!finite(resolution)||resolution<.05||resolution>.2)throw Error('PHYSICAL_RESOLUTION_MUST_BE_0_05_TO_0_2_M');
 for(const wall of source.walls||[])for(const [key,def,min,max] of [['height',2.4,.5,5],['thickness',.15,.03,2]]){const v=wall[key]??def;if(!finite(v)||v<min||v>max)throw Error('UNSAFE_PHYSICAL_WALL_'+key);}
 for(const door of source.doors||[])for(const [key,def,min,max] of [['height',2.2,.5,5],['width',1,.86,5],['orientation',0,-1000,1000]]){const v=door[key]??def;if(!finite(v)||v<min||v>max)throw Error('UNSAFE_PHYSICAL_DOOR_'+key);}
 for(const start of source.start_poses||[])if(![start.x,start.y,start.yaw??0].every(finite))throw Error('INVALID_PHYSICAL_START_POSE');

 if(!source.boundary||source.boundary.max_x-source.boundary.min_x>120||source.boundary.max_y-source.boundary.min_y>120)throw Error('PHYSICAL_MAP_SIZE_LIMIT');
 for(const key of ['rooms','corridors','walls','doors','start_poses'])for(const item of source[key]||[])if(!/^[A-Za-z0-9_-]{1,80}$/.test(item.id||''))throw Error('PHYSICAL_ID_MUST_BE_XML_SAFE:'+key);
 if((source.walls||[]).length>1500||(source.doors||[]).length>100||(source.rooms||[]).length+(source.corridors||[]).length>100)throw Error('PHYSICAL_GEOMETRY_LIMIT');
 source.metadata={...source.metadata,id:'agnes_map_'+job.replaceAll('-','')};
 save('source.json',source);
 const compiled=out+'/compiled';execFileSync('python3',[ROOT+'/scripts/map-import/map_import.py','compile',out+'/source.json','--out',compiled],{cwd:ROOT,timeout:30000});
 // Reuse reviewed controller/costmap settings; office adds real laser localization.
 const reviewed=ROOT+'/simulation/scenarios/layout_c/nav2_params.yaml';
 const params=fs.readFileSync(reviewed,'utf8');if(!params.includes(ROOT+'/simulation/scenarios/layout_c/map.yaml'))throw Error('REVIEWED_MAP_PATH_NOT_FOUND');
 const mapParams=params.replaceAll(ROOT+'/simulation/scenarios/layout_c/map.yaml',compiled+'/map.yaml');
 fs.writeFileSync(compiled+'/nav2_params.yaml',id==='office-fire'?withOfficeLocalization(mapParams,source.start_poses[0]):mapParams);
 layout={id:source.metadata.id,label:entry.name,world:compiled+'/world.sdf',map:compiled+'/map.yaml',nav2:compiled+'/nav2_params.yaml',bridge:compiled+'/bridge.yaml',registry:compiled+'/world_registry.json',alternate_route:true,imported:true,...(id==='office-fire'?{localization:'amcl'}:{})};
}
execFileSync(NODE,['--import','./third_party/agnes-harness/node_modules/tsx/dist/loader.mjs','scripts/demo-ui-final/validate-registry.mts',layout.registry.startsWith('/')?layout.registry:ROOT+'/'+layout.registry],{cwd:ROOT,timeout:15000});
let spec,check;const attempts=[];
for(let n=0;n<8;n++){
 const seed=(Math.floor(Math.random()*0xfffffffe)+1)>>>0;
 spec=scenarioForSeed(seed,{layout});check=validateScenario(spec,{runtime:false});attempts.push({seed,pass:check.pass,reasons:check.static?.failure_reasons});
 if(check.pass)break;
}
if(layout.localization==='amcl'&&spec.layout.localization!=='amcl')throw Error('SELECTED_MAP_LOCALIZATION_NOT_PRESERVED');
const registry=JSON.parse(fs.readFileSync(layout.registry.startsWith('/')?layout.registry:ROOT+'/'+layout.registry,'utf8'));
const rooms=new Map(registry.locations.filter(x=>x.type==='room').map(x=>[x.id,x]));
const placements=[{...spec.person_pose_orientation,room:spec.person_target_room},...spec.object_placements];
const insideRoom=placements.every(x=>{const b=rooms.get(x.room)?.bounds;return b&&x.x>b.min_x+.2&&x.x<b.max_x-.2&&x.y>b.min_y+.2&&x.y<b.max_y-.2;});
if(!insideRoom)throw Error('PLACEMENT_OUTSIDE_SELECTED_MAP_ROOM');
save('static-validation-private.json',{check,attempts,placement_rooms_verified:insideRoom});if(!check?.pass)throw Error('NEW_MAP_STATIC_GATE_FAILED:'+JSON.stringify(attempts));
save('plan-private.json',spec);
save('plan-public.json',{map_id:id,map_name:entry.name,seed:spec.seed,layout_id:spec.layout_id,world:layout.world,map:layout.map,registry:layout.registry,nav2:layout.nav2,bridge:layout.bridge,world_name:layout.id,imported:Boolean(layout.imported),localization:layout.localization||'static',static_pass:check.pass,static_checks:check.static.checks,placement_algorithm:'existing ScenarioManager seeded PRNG + safeRoomPose, constrained to selected map rooms',dynamic_classic_events:layout.imported?'DISABLED_FIXED_OLD_COORDINATES':'UNCHANGED',activation:'NOT_YET_ACTIVATED'});
console.log(JSON.stringify({pass:true,map_id:id,seed:spec.seed,job,layout_id:spec.layout_id}));
