"""Actual Nav2 regression, no model decisions or simulated terminal results."""
from pathlib import Path
import os,sys,json,subprocess,time,threading,signal
ROOT=Path("/data-ssd/zhongchengkai/agnes");OUT=ROOT/"artifacts/runtime-diagnostics-20261014/navigation-camera"
def main():
 if "--child" not in sys.argv:
  ps=[]
  for p in Path("/proc").iterdir():
   if not p.name.isdigit():continue
   try:
    if p.stat().st_uid==os.getuid() and (p/"cwd").resolve()==ROOT and b"nav2_controller/controller_server" in (p/"cmdline").read_bytes():ps.append(p)
   except OSError:pass
  if len(ps)!=1:raise RuntimeError("OWNED_CONTROLLER_REQUIRED")
  env=dict(x.split("=",1)for x in (ps[0]/"environ").read_bytes().decode().split("\0")if"="in x)
  env["ROBOT_PERCEPTION"]="none";env["ROBOT_TRACE_DIR"]=str(OUT);env["PYTHONDONTWRITEBYTECODE"]="1"
  return subprocess.run([str(ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/python"),"-B",__file__,"--child",*sys.argv[1:]],env=env,cwd=ROOT).returncode
 sys.path.insert(0,str(ROOT/"services/robot-mcp/ros2_bridge"))
 import rclpy
 from rclpy.executors import MultiThreadedExecutor
 from bridge import Bridge
 from perception import png_bytes
 rclpy.init();node=Bridge();ex=MultiThreadedExecutor(num_threads=4);ex.add_node(node);th=threading.Thread(target=ex.spin,daemon=True);th.start()
 signal.signal(signal.SIGINT,lambda *_:node.stop());signal.signal(signal.SIGTERM,lambda *_:node.stop())
 locations=sys.argv[sys.argv.index("--locations")+1].split(",")
 reg=json.loads(Path(os.environ["ROBOT_WORLD_REGISTRY"]).read_text())
 results=[]
 try:
  node.get_state();node.fresh_frame()
  if "--recover" in sys.argv:
   recovery=node.recover_navigation();(OUT/"live-navigation-pretest-recovery.json").write_text(json.dumps(recovery,indent=2)+"\n")
   if not recovery.get("pass"):raise RuntimeError("PREFLIGHT_FAILED")
   time.sleep(1.2)
  for location in locations:
   pose=next(v["pose"]for v in reg["locations"]if v["id"]==location)
   before=node.get_state();began=time.monotonic()
   result=node.navigate({"target":location,"pose":pose,"timeout_sec":75})
   record={"target":location,"before":before,"result":result,"after":node.get_state(),"duration_sec":time.monotonic()-began}
   results.append(record)
   (OUT/"live-navigation-repair-qa.json").write_text(json.dumps({"status":"RUNNING","results":results},indent=2)+"\n")
   print(json.dumps({"target":location,"status":result.get("status"),"action_status":result.get("action_status"),"error_code":result.get("error_code"),"reason":result.get("reason"),"duration_sec":record["duration_sec"],"after":record["after"]}),flush=True)
   if result.get("status")!="SUCCEEDED":raise RuntimeError("ACTUAL_NAVIGATION_FAILED")
   msg=node.fresh_frame();(OUT/f"nav-{location}-camera.png").write_bytes(png_bytes(msg))
  stop=node.stop()
  report={"status":"PASS","kind":"ACTUAL_ROS_NAV2_REGRESSION_NOT_NEW_AGNES_RUN","results":results,"stop":stop,"final":node.get_state(),"pose_reset":False,"model_calls":0,"collision_checks_disabled":False}
  (OUT/"live-navigation-repair-qa.json").write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({"status":"PASS","stop":stop,"final":report["final"]}),flush=True)
 except Exception as error:
  (OUT/"live-navigation-repair-qa.json").write_text(json.dumps({"status":"FAILED","kind":"ACTUAL_ROS_NAV2_REGRESSION_NOT_NEW_AGNES_RUN","error":str(error),"results":results},indent=2)+"\n")
  raise
 finally:
  node.stop();node.motion_stop_shutdown.set();node.motion_stop_thread.join(8);node.camera_stream.close();ex.shutdown();th.join(3);node.destroy_node()
  if rclpy.ok():rclpy.shutdown()
  th.join(3)
 return 0
if __name__=="__main__":raise SystemExit(main())
