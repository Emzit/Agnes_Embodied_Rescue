#!/usr/bin/env python3
# UI-only, idempotent launcher. Does not start/reset the robot stack or issue motion.
import argparse,json,os,signal,socket,subprocess,time
from datetime import datetime
from pathlib import Path
ROOT=Path('/data-ssd/zhongchengkai/agnes')
assert Path.cwd().resolve()==ROOT, 'Run from the authorized Agnes workspace'
OUT=ROOT/'artifacts/demo-ui-final';OUT.mkdir(parents=True,exist_ok=True)
def read(name):
 try:return json.loads((OUT/name).read_text())
 except (OSError,ValueError):return {}
def owned(pid,needle):
 try:return Path(f'/proc/{pid}/cwd').resolve()==ROOT and needle in Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode()
 except OSError:return False
def listening(port):
 with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))==0
parser=argparse.ArgumentParser();parser.add_argument('--restart-ui',action='store_true');args=parser.parse_args()
specs=[
 ('native-web','scripts/agnes-proxy/web.mjs','tools/node/bin/node scripts/agnes-proxy/web.mjs serve --port 4177',4177),
 ('dashboard','demo/final-dashboard/server.mjs','tools/node/bin/node demo/final-dashboard/server.mjs',4188),
 ('native-observer','scripts/demo-ui-final/native-observer.mts','tools/node/bin/node --import ./third_party/agnes-harness/node_modules/tsx/dist/loader.mjs scripts/demo-ui-final/native-observer.mts',None),
 ('ros-monitor','runtime/ros2-jazzy/pixi.toml','tools/pixi/bin/pixi run --locked --manifest-path runtime/ros2-jazzy/pixi.toml python scripts/demo-ui-final/ros_monitor.py',None)]
if args.restart_ui:
 r=read('ros-state.json');s=read('native-session-state.json')
 assert s.get('status') in ['IDLE','SUCCEEDED','PARTIAL','FAILED','CANCELED','COMPLETED'], 'Native turn not verified terminal; do not restart UI'
 assert s.get('observer_connected') and time.time()-datetime.fromisoformat(s['observer_updated_at'].replace('Z','+00:00')).timestamp()<4, 'Fresh connected Session observer required'
 assert time.time()-r.get('updated_at',0)<3 and r.get('pose_age_ms',99999)<2500, 'Fresh ROS/TF required'
 assert r.get('navigation',{}).get('status')=='IDLE' and not r['navigation']['motion_lease']['held'], 'Robot must be IDLE with free lease'
for name,needle,command,port in specs:
 pidfile=OUT/(name+'.pid')
 try:pid=int(pidfile.read_text().strip())
 except (OSError,ValueError):pid=0
 is_owned=pid and owned(pid,needle)
 if args.restart_ui and name!='ros-monitor' and is_owned:
  os.kill(pid,signal.SIGTERM)
  for _ in range(30):
   if not owned(pid,needle):break
   time.sleep(.1)
  assert not owned(pid,needle), f'{name} did not exit; no force kill'
  if port:
   for _ in range(30):
    if not listening(port):break
    time.sleep(.1)
  is_owned=False
 if is_owned:print(name,'existing',pid);continue
 if port and listening(port):raise RuntimeError(f'Port {port} occupied without verified PID; inspect manually, never kill unknown PID')
 if name=='ros-monitor':
  r=read('ros-state.json')
  if time.time()-r.get('updated_at',0)<3:print(name,'existing fresh monitor');continue
 log=(OUT/(name+'.log')).open('ab')
 proc=subprocess.Popen(['bash','-lc','source scripts/final-rescue/env.sh; exec '+command],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 pidfile.write_text(str(proc.pid));print(name,'started',proc.pid)
 time.sleep(.3)
 if proc.poll() is not None:raise RuntimeError(f'{name} exited; inspect project log')
print('Canonical UI: http://127.0.0.1:4177/demo; dashboard4188 redirects here.')
