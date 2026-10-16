#!/usr/bin/env python3
"""Transactional switch of this project's owned Gazebo stack. Never navigates."""
import os,sys,json,time,fcntl,subprocess,shutil,signal,hashlib
from pathlib import Path
from datetime import datetime,timezone
from scene_observers import restart_observers
R=Path('/data-ssd/zhongchengkai/agnes'); O=R/'artifacts/demo-ui-final'
assert Path.cwd().resolve()==R
sys.path.insert(0,str(R))
from simulation.final_rescue.object_spawn import validate_spawn_evidence
map_id,job=sys.argv[1:3]
import re
assert re.fullmatch(r'(classic|lotus|office-fire|map-[a-f0-9-]{36})',map_id)
assert re.fullmatch(r'[a-f0-9-]{36}',job)
D=O/'scene-switch/jobs'/job;D.mkdir(parents=True,exist_ok=True)
NODE=str(R/'tools/node/bin/node'); START=time.time()
def read(p):return json.loads(Path(p).read_text())
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix('.tmp');t.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');t.replace(p)
state={'job_id':job,'requested_map':map_id,'status':'RUNNING','started_at':START,'phase':'安全检查'}
def phase(text,**extra):
 state.update(phase=text,updated_at=time.time(),**extra);save(D/'status.json',state);save(O/'scene-switch/current-job.json',state)
def run(args,name,timeout=90):
 result=subprocess.run(args,cwd=R,env=os.environ.copy(),capture_output=True,text=True,timeout=timeout)
 log=D/(name+'.log')
 if log.exists():log=D/(name+'-'+str(time.time_ns())+'.log')
 log.write_text(result.stdout+'\n'+result.stderr)
 if result.returncode:
  message=next((line.partition('Error: ')[2] for line in result.stderr.splitlines() if line.startswith('Error: ')),None)
  if not message:message=(result.stderr.strip() or result.stdout.strip())[-500:]
  raise RuntimeError(name+'_FAILED:'+message)
 return result.stdout
def sdk(mode):return run([NODE,'--import','./third_party/agnes-harness/node_modules/tsx/dist/loader.mjs','scripts/demo-ui-final/scene-resources.mts',mode,job],'sdk-'+mode,180)
def fresh_guard(held=False,native=True):
 r=read(O/'ros-state.json'); s=read(O/'native-session-state.json')
 assert r['ros_domain_id']==106 and time.time()-r['updated_at']<3 and r.get('pose_age_ms',99999) is not None and r['pose_age_ms']<2500,'FRESH_ROS_REQUIRED'
 assert r['navigation']['status']=='IDLE' and not r['navigation']['active_goals'],'NAVIGATION_NOT_IDLE'
 lease=r['navigation']['motion_lease']
 assert not lease['held'] or held and lease['owner'].get('job_id')==job,'MOTION_LEASE_BUSY'
 assert r.get('velocity') and all(abs(v)<.001 for v in r['velocity'].values()),'ZERO_CMD_VEL_REQUIRED'
 if native:
  assert s.get('observer_connected') and time.time()-datetime.fromisoformat(s['observer_updated_at'].replace('Z','+00:00')).timestamp()<4,'FRESH_NATIVE_REQUIRED'
  assert s['status'] in ['IDLE','SUCCEEDED','PARTIAL','FAILED','CANCELED','COMPLETED'] and not s.get('pending_approvals') and not s.get('pending_inputs'),'NATIVE_SESSION_BUSY'
 return {'ros':r,'native':{'session_id':s['session_id'],'status':s['status'],'last_seq':s['last_seq']}}
def verify_owned(require=True):
 entries=read(R/'.runtime-final_rescue/processes.json')['entries']
 if require:assert entries,'NO_OWNED_STACK'
 for e in entries:
  p=Path('/proc')/str(e['pid'])
  if not p.exists():continue
  stat=(p/'stat').read_text().rsplit(')',1)[1].split()
  if stat[0]=='Z':continue
  assert stat[19]==e['start_time'] and p.stat().st_uid==os.getuid(),'STACK_PID_IDENTITY_MISMATCH'
  assert (p/'cwd').resolve()==R,'STACK_CWD_MISMATCH'
  env=(p/'environ').read_bytes().split(b'\0')
  assert b'ROS_DOMAIN_ID=106' in env and b'GZ_PARTITION=agnes_final_rescue' in env,'STACK_DOMAIN_MISMATCH'
 return entries
def stop():
 verify_owned(False)
 data=run(['bash','scripts/final-rescue/stop-stack.sh'],'stack-stop',60)
 assert any(json.loads(line).get('all_stopped') for line in data.splitlines() if line.startswith('{')),'STACK_STOP_NOT_VERIFIED'
def zero_velocity():
 # Only this domain/project, while the scene transaction owns the motion lease.
 run(['bash','-lc','source scripts/final-rescue/env.sh; tools/pixi/bin/pixi run --locked --manifest-path runtime/ros2-jazzy/pixi.toml ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.0}}"'],'zero-cmd-vel',25)
def snapshot_stack_diagnostics(label):
 dest=D/(label+'-diagnostics');dest.mkdir(exist_ok=True)
 for name in ['gz-server','ros-gz-bridge','odom-tf','nav2','dynamic-scenario']:
  src=R/'logs/final_rescue'/(name+'.log')
  if src.is_file():shutil.copy2(src,dest/src.name)
 save(dest/'recorded-at.json',{'recorded_at':time.time(),'job_id':job,'label':label})

def launch(label):
 started=time.time()
 log=(D/(label+'.log')).open('ab')
 env=os.environ.copy();env.update(FINAL_RUN_DIR=str(R/'artifacts/interactive-live/full-mission'),ROS_DOMAIN_ID='106')
 proc=subprocess.Popen(['bash','scripts/final-rescue/start-stack.sh'],cwd=R,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 log.close();save(D/(label+'-launcher.json'),{'pid':proc.pid,'launched_at':time.time()})
 deadline=time.time()+180
 while time.time()<deadline:
  if proc.poll() is not None:
   snapshot_stack_diagnostics(label)
   failure=(D/(label+'.log')).read_text(errors='replace')
   reason=next((line.partition('PHASE9D_STACK_OPERATION_FAILED: ')[2] for line in reversed(failure.splitlines()) if line.startswith('PHASE9D_STACK_OPERATION_FAILED: ')),'')
   raise RuntimeError(label+'_EXITED'+(':'+reason if reason else ''))
  text=(D/(label+'.log')).read_text(errors='replace')
  if 'FINAL_RESCUE_STACK_READY ' in text:
   payload=json.loads(next(line.split('FINAL_RESCUE_STACK_READY ',1)[1] for line in text.splitlines() if 'FINAL_RESCUE_STACK_READY ' in line))
   assert payload.get('ready'),'STACK_NOT_READY'
   save(D/(label+'-readiness.json'),payload)
   snapshot_stack_diagnostics(label)
   entries=verify_owned();nav=next(e for e in entries if e['name']=='nav2')
   save(O/'scene-generation.json',{'ready':True,'started_at':started,'verified_at':time.time(),'nav_pid':nav['pid'],'nav_start_time':nav['start_time'],'job_id':job,'source':'fresh owned Nav2 process + check_stack real lifecycle/TF/clock; no commands issued'})
   return
  time.sleep(.5)
 snapshot_stack_diagnostics(label)
 raise RuntimeError(label+'_READY_TIMEOUT')
pointers=['artifacts/interactive-live/current-scenario.env','artifacts/interactive-live/current-scenario.json','artifacts/interactive-live/scenario-controller/current-private.json','artifacts/interactive-live/imported-map.env','artifacts/interactive-live/active-import.json','runtime/interactive-mission-origin.json','artifacts/demo-ui-final/active-map.json','artifacts/demo-ui-final/native-session-target.json','artifacts/demo-ui-final/scene-generation.json']
manifest=[];fd=None;disabled=False;stop_attempted=False;committed=False
try:
 phase('安全检查');before=fresh_guard();save(D/'safety-before.json',before);verify_owned();restart_observers(check_only=True)
 fd=os.open(R/'runtime/motion-control.lock',os.O_RDWR|os.O_CREAT,0o600);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 os.ftruncate(fd,0);os.write(fd,json.dumps({'kind':'scene_switch','job_id':job,'pid':os.getpid(),'acquired_at':START}).encode());os.fsync(fd)
 sdk('check')
 phase('编译骨架与随机布置候选')
 run([NODE,'scripts/demo-ui-final/scene-prepare.mjs','prepare',map_id,job],'prepare',90)
 plan=read(D/'plan-public.json');spec=read(D/'plan-private.json')
 assert spec['semantic_locations'] and spec['object_placements'] and all(x.get('room') for x in spec['object_placements']),'PLACEMENTS_REQUIRE_REAL_MAP_ROOMS'
 for rel in pointers:
  src=R/rel; exists=src.exists();manifest.append({'path':rel,'exists':exists})
  if exists:
   dst=D/'before'/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 save(D/'rollback-manifest.json',manifest)
 fresh_guard(True)
 phase('暂停本项目 MCP 与任务记忆')
 disabled=True;sdk('disable')
 sdk('check');fresh_guard(True,native=False)
 phase('停止已核实的本项目仿真进程')
 stop_attempted=True;stop()
 phase('提交新地图与随机 seed')
 run([NODE,'scripts/demo-ui-final/scene-prepare.mjs','commit',map_id,job],'commit',30);committed=True
 (R/'artifacts/interactive-live/imported-map.env').write_text('# Managed scene-switch: current-scenario.env is authoritative.\n')
 save(R/'artifacts/interactive-live/active-import.json',{'map_id':map_id,'job_id':job,'world':plan['world'],'map':plan['map'],'activated_at':time.time(),'physical_verification':'PENDING'})
 origin=R/'runtime/interactive-mission-origin.json'
 if origin.exists():origin.unlink() # exact backed-up old-world origin, never reused across maps
 phase('启动新 Gazebo / Nav2')
 restart_observers();launched=time.time();launch('new-stack');zero_velocity()
 phase('核对真实地图、TF、Camera 与物品')
 deadline=time.time()+35;proof=None
 while time.time()<deadline:
  r=read(O/'ros-state.json');cam=read(R/'artifacts/interactive-live/camera/latest-meta.json')
  try:objects=read(R/'artifacts/interactive-live/full-mission/scenario-physical-objects.json')
  except (OSError,ValueError):objects={}
  ca=datetime.fromisoformat(cam['captured_at'].replace('Z','+00:00')).timestamp()
  reg=read(plan['registry']);start=next(x['pose'] for x in reg['locations'] if x['id']=='Start')
  robot_ok=r.get('pose') and ((r['pose']['x']-start['x'])**2+(r['pose']['y']-start['y'])**2)**.5<.6
  yaw_ok=bool(r.get('pose')) and abs(__import__('math').atan2(__import__('math').sin(r['pose']['yaw']-start.get('yaw',0)),__import__('math').cos(r['pose']['yaw']-start.get('yaw',0))))<.15
  objects_ok=validate_spawn_evidence(objects,spec,plan['world_name'],observed_after=launched)
  expected=read(D/'static-validation-private.json')['check']['static']['map']
  m=r.get('map') or {}
  map_ok=m.get('received_at',0)>launched and m.get('width')==expected['width'] and m.get('height')==expected['height'] and abs(m.get('resolution',0)-expected['resolution'])<1e-5 and abs(m.get('origin',{}).get('x',999)-expected['origin'][0])<1e-5 and abs(m.get('origin',{}).get('y',999)-expected['origin'][1])<1e-5
  save(D/'last-live-check.json',{'ros':r,'camera':cam,'objects':objects,'map_ok':map_ok,'robot_ok':robot_ok,'yaw_ok':yaw_ok,'objects_ok':objects_ok})
  if time.time()-r['updated_at']<3 and r.get('pose_age_ms',99999) is not None and r['pose_age_ms']<2500 and robot_ok and yaw_ok and map_ok and cam.get('real_sensor') and (cam.get('pose') or {}).get('position') and ((cam['pose']['position']['x']-start['x'])**2+(cam['pose']['position']['y']-start['y'])**2)**.5<.6 and ca>launched and 0<=time.time()-ca<2.5 and objects_ok:
   proof={'ros':r,'camera':cam,'objects':objects,'new_map_received':True,'spawn_distance_ok':True,'navigation_commands_issued':0};break
  time.sleep(.4)
 if not proof:raise RuntimeError('LIVE_NEW_WORLD_VERIFICATION_FAILED:'+json.dumps({'map_ok':map_ok,'robot_ok':robot_ok,'yaw_ok':yaw_ok,'objects_ok':objects_ok}))
 save(D/'physical-proof.json',proof)
 phase('重新连接 8 工具 MCP 并创建原生会话')
 sdk('enable');disabled=False;sdk('session')
 target=read(D/'native-after.json')
 deadline=time.time()+15
 while time.time()<deadline:
  s=read(O/'native-session-state.json')
  if s.get('session_id')==target['session_id'] and s.get('observer_connected'):break
  time.sleep(.3)
 else:raise RuntimeError('NATIVE_OBSERVER_REBIND_TIMEOUT')
 active={**plan,'status':'ACTIVE','activation':'VERIFIED_REAL_GAZEBO_ROS','activated_at':time.time(),'job_id':job,'session_id':target['session_id'],'objects_spawned':4}
 save(O/'active-map.json',active);save(R/'artifacts/interactive-live/active-import.json',active)
 phase('切换完成',status='SUCCEEDED',active_map=active,finished_at=time.time(),navigation_commands_issued=0)
except Exception as error:
 (D/'failure-private.log').write_text(str(error))
 reason=str(error).splitlines()[0][:300];rollback='NOT_REQUIRED'
 if stop_attempted:
  try:
   phase('失败：恢复上一场景',error=reason)
   stop()
   for item in manifest:
    dst=R/item['path']
    if item['exists']:shutil.copy2(D/'before'/item['path'],dst)
    elif dst.exists():dst.unlink() # only exact transaction-created pointers
   restart_observers();launch('rollback-stack');zero_velocity();rollback='VERIFIED_STACK_READY'
  except Exception as recovery:rollback='FAILED:'+str(recovery)
 if disabled or stop_attempted:
  try:sdk('enable')
  except Exception as recovery:rollback+=';MCP_RESTORE_FAILED:'+str(recovery)
 phase('切换失败',status='FAILED',error=reason,rollback=rollback,finished_at=time.time())
finally:
 if fd is not None:
  try:fcntl.flock(fd,fcntl.LOCK_UN)
  finally:os.close(fd)
print(json.dumps(state,ensure_ascii=False))
sys.exit(0 if state['status']=='SUCCEEDED' else 1)
