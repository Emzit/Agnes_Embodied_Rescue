"""Read-only live camera verification using the production bridge class."""
from pathlib import Path
import os,sys,json,threading,time,hashlib,subprocess
ROOT=Path("/data-ssd/zhongchengkai/agnes")
OUT=ROOT/"artifacts/runtime-diagnostics-20261014/navigation-camera"
def main():
 if Path.cwd().resolve()!=ROOT:raise RuntimeError("WORKSPACE_REQUIRED")
 candidates=[]
 for p in Path("/proc").iterdir():
  if not p.name.isdigit():continue
  try:
   if p.stat().st_uid!=os.getuid() or (p/"cwd").resolve()!=ROOT:continue
   cmd=(p/"cmdline").read_bytes()
   if b"nav2_controller/controller_server" in cmd:candidates.append(p)
  except OSError:pass
 if len(candidates)!=1:raise RuntimeError("OWNED_CONTROLLER_REQUIRED")
 env=dict(x.split("=",1)for x in (candidates[0]/"environ").read_bytes().decode().split("\0")if"="in x)
 env["ROBOT_PERCEPTION"]="none";env["PYTHONDONTWRITEBYTECODE"]="1"
 env["ROBOT_TRACE_DIR"]=str(OUT)
 if "--child" not in sys.argv:
  return subprocess.run([str(ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/python"),"-B",__file__,"--child"],env=env,cwd=ROOT).returncode
 sys.path.insert(0,str(ROOT/"services/robot-mcp/ros2_bridge"))
 import rclpy
 from rclpy.executors import MultiThreadedExecutor
 from bridge import Bridge
 from perception import png_bytes
 rclpy.init();node=Bridge();ex=MultiThreadedExecutor(num_threads=4);ex.add_node(node)
 th=threading.Thread(target=ex.spin,daemon=True);th.start()
 records=[]
 try:
  previous=None
  for i in range(3):
   began=time.monotonic();msg=node.fresh_frame(previous);previous=(msg.header.stamp.sec,msg.header.stamp.nanosec)
   path=OUT/f"live-camera-repair-{i}.png";data=png_bytes(msg);path.write_bytes(data)
   records.append({"stamp":previous,"wait_sec":time.monotonic()-began,"sha256":hashlib.sha256(data).hexdigest(),"path":str(path.relative_to(ROOT)),"diagnostics":node.camera_stream.diagnostics()})
   time.sleep(.2)
  assert len({tuple(x["stamp"])for x in records})==3
  before=node.camera_stream.diagnostics();assert node.camera_stream.recreate()
  msg=node.fresh_frame(previous);after=node.camera_stream.diagnostics()
  assert after["generation"]>before["generation"] and after["available"]
  assert (msg.header.stamp.sec,msg.header.stamp.nanosec)!=previous
  result={"status":"PASS","at":time.time(),"records":records,"reader_recreate":{"before":before,"after":after},"motion_commands":0,"model_calls":0,"robot_state":node.get_state()}
  (OUT/"live-camera-repair-qa.json").write_text(json.dumps(result,indent=2)+"\n")
  print(json.dumps(result))
 finally:
  node.motion_stop_shutdown.set();node.motion_stop_thread.join(8);node.camera_stream.close()
  ex.shutdown();node.destroy_node()
  if rclpy.ok():rclpy.shutdown()
  th.join(3)
 return 0
if __name__=="__main__":raise SystemExit(main())
