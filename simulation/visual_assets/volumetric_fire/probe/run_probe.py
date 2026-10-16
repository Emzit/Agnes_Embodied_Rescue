from pathlib import Path
import subprocess,os,signal,time,json,sys
BASE=Path(__file__).resolve().parents[1];ROOT=BASE.parents[2];P=BASE/"probe";PREFIX=ROOT/"runtime/ros2-jazzy/.pixi/envs/default"
subprocess.run([sys.executable,str(P/"make_probe.py")],check=True)
env=os.environ.copy()
env.update({"GZ_PARTITION":"agnes_volume_probe_"+str(os.getpid()),"ROS_DOMAIN_ID":"196",
            "HOME":str(P/"home"),"TMPDIR":str(P/"tmp"),"XDG_CACHE_HOME":str(P/"cache"),
            "XDG_CONFIG_HOME":str(P/"config"),"XDG_DATA_HOME":str(P/"data"),
            "GZ_LOG_PATH":str(P/"logs"),"GZ_SIM_RESOURCE_PATH":str(P)})
for k in ["HOME","TMPDIR","XDG_CACHE_HOME","XDG_CONFIG_HOME","XDG_DATA_HOME","GZ_LOG_PATH"]:Path(env[k]).mkdir(parents=True,exist_ok=True)
variant="baseline-" if "--baseline" in sys.argv else ""
env["PROBE_VARIANT"]=variant
log=(P/(variant+"gazebo.log")).open("w")
proc=subprocess.Popen([str(PREFIX/"bin/gz"),"sim","-s","-r","--headless-rendering","-v","3",str(P/("baseline.sdf" if variant else "world.sdf"))],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
(P/"owned-process.json").write_text(json.dumps({"pid":proc.pid,"partition":env["GZ_PARTITION"],"world":str(P/"world.sdf")}))
try:
 r=subprocess.run([str(PREFIX/"bin/python"),"-B",str(P/"capture.py")],cwd=ROOT,env=env,capture_output=True,text=True,timeout=35)
 (P/(variant+"capture.log")).write_text(r.stdout+r.stderr);print(r.stdout+r.stderr);r.check_returncode()
 if proc.poll() is not None:raise RuntimeError("isolated Gazebo exited: "+str(proc.returncode))
finally:
 if proc.poll() is None:
  os.killpg(proc.pid,signal.SIGINT)
  try:proc.wait(timeout=8)
  except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGTERM);proc.wait(timeout=5)
 log.close()
print((P/"runtime.json").read_text() if (P/"runtime.json").exists() else "NO_RUNTIME_STATUS")
