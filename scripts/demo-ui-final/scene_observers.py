import os,time,signal,subprocess
from pathlib import Path
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-ui-final'
def restart_observers(check_only=False):
 specs=[
  (O/'ros-monitor.pid','scripts/demo-ui-final/ros_monitor.py','tools/pixi/bin/pixi run --locked --manifest-path runtime/ros2-jazzy/pixi.toml python scripts/demo-ui-final/ros_monitor.py',O/'ros-monitor.log'),
  (R/'artifacts/interactive-live/pids/camera.pid','scripts/interactive/live-camera-adapter.mjs','tools/node/bin/node --import ./third_party/agnes-harness/node_modules/tsx/dist/loader.mjs scripts/interactive/live-camera-adapter.mjs',R/'artifacts/interactive-live/logs/camera.log')]
 for pidfile,needle,command,logpath in specs:
  pid=int(pidfile.read_text().strip());procdir=Path('/proc')/str(pid)
  if procdir.exists():
   assert procdir.stat().st_uid==os.getuid() and (procdir/'cwd').resolve()==R and needle in (procdir/'cmdline').read_bytes().replace(bytes([0]),b' ').decode(),'OBSERVER_PID_NOT_OWNED'
   assert os.getpgid(pid)==pid,'OBSERVER_NOT_GROUP_LEADER'
   members=[]
   for item in Path('/proc').iterdir():
    if not item.name.isdigit():continue
    try:
     stat=(item/'stat').read_text().rsplit(')',1)[1].split()
     if int(stat[2])!=pid or stat[0]=='Z':continue
     assert item.stat().st_uid==os.getuid() and (item/'cwd').resolve()==R,'OBSERVER_GROUP_OWNERSHIP_MISMATCH'
     assert b'ROS_DOMAIN_ID=106' in (item/'environ').read_bytes().split(bytes([0])),'OBSERVER_DOMAIN_MISMATCH'
     members.append((item,stat[19]))
    except (FileNotFoundError,ProcessLookupError):pass
   if check_only:continue
   os.killpg(pid,signal.SIGTERM)
   deadline=time.time()+12
   while time.time()<deadline:
    live=[]
    for item,start in members:
     try:
      stat=(item/'stat').read_text().rsplit(')',1)[1].split()
      if stat[0]!='Z' and stat[19]==start:live.append(str(item))
     except OSError:pass
    if not live:break
    time.sleep(.15)
   assert not live,'OWNED_OBSERVER_DID_NOT_EXIT'
  if check_only:continue
  log=logpath.open('ab')
  proc=subprocess.Popen(['bash','-lc','source scripts/final-rescue/env.sh; exec '+command],cwd=R,env=os.environ.copy(),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  log.close();pidfile.write_text(str(proc.pid));time.sleep(.25)
  assert proc.poll() is None,'OBSERVER_START_FAILED'

if __name__=='__main__':
 assert Path.cwd().resolve()==R
 restart_observers()
 print('Verified project-owned Camera and read-only ROS monitor refreshed; no navigation commands.')
