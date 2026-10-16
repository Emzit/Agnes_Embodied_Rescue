"""Plan/check a tiny simulated recovery using current laser and costmap.
Default is read-only. --apply is bounded to <=0.20m at <=0.06m/s.
No pose resets, obstacle removal, reduced Nav2 footprint, or disabled safety.
"""
from pathlib import Path
import os,sys,json,subprocess,time,math,threading,uuid,signal
ROOT=Path("/data-ssd/zhongchengkai/agnes")
OUT=ROOT/"artifacts/runtime-diagnostics-20261014/navigation-camera"
def distance_to_segment(x,y,length):
 return math.hypot(x-min(max(x,0),length),y)
def main():
 if Path.cwd().resolve()!=ROOT:raise RuntimeError("WORKSPACE_REQUIRED")
 if "--child" not in sys.argv:
  ps=[]
  for p in Path("/proc").iterdir():
   if not p.name.isdigit():continue
   try:
    if p.stat().st_uid==os.getuid() and (p/"cwd").resolve()==ROOT and b"nav2_controller/controller_server" in (p/"cmdline").read_bytes():ps.append(p)
   except OSError:pass
  if len(ps)!=1:raise RuntimeError("OWNED_CONTROLLER_REQUIRED")
  env=dict(x.split("=",1)for x in (ps[0]/"environ").read_bytes().decode().split("\0")if"="in x)
  env["ROBOT_PERCEPTION"]="none";env["PYTHONDONTWRITEBYTECODE"]="1";env["ROBOT_TRACE_DIR"]=str(OUT)
  return subprocess.run([str(ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/python"),"-B",__file__,"--child",*sys.argv[1:]],env=env,cwd=ROOT).returncode
 sys.path.insert(0,str(ROOT/"services/robot-mcp/ros2_bridge"))
 import rclpy
 from rclpy.executors import MultiThreadedExecutor
 from geometry_msgs.msg import Twist
 from bridge import Bridge
 rclpy.init();node=Bridge();ex=MultiThreadedExecutor(num_threads=4);ex.add_node(node);th=threading.Thread(target=ex.spin,daemon=True);th.start()
 moving=False;operation=None;records=[]
 def stop_signal(*_):node.inspection_cancel.set()
 signal.signal(signal.SIGINT,stop_signal);signal.signal(signal.SIGTERM,stop_signal)
 def evidence(length):
  state=node.get_state();pose=state["pose"];yaw=pose["heading"]
  with node.lock:entry=node.sensors.get("lidar");grid=node.costmap
  if not entry or time.monotonic()-entry[1]>.2 or grid is None:raise RuntimeError("FRESH_SCAN_COSTMAP_REQUIRED")
  scan=entry[0];laser=[]
  for i,d in enumerate(scan.ranges):
   if not math.isfinite(d) or d<scan.range_min or d>=scan.range_max:continue
   a=scan.angle_min+i*scan.angle_increment;laser.append((.1+d*math.cos(a),d*math.sin(a)))
  if len(laser)<40:raise RuntimeError("INSUFFICIENT_LIDAR")
  clearance=min(distance_to_segment(x,y,length)for x,y in laser)
  resolution=grid.info.resolution;ox=grid.info.origin.position.x;oy=grid.info.origin.position.y
  lethal=[]
  for index,cost in enumerate(grid.data):
   if cost<100:continue
   x=ox+(index%grid.info.width)*resolution;y=oy+(index//grid.info.width)*resolution
   if math.hypot(x-pose["x"],y-pose["y"])<1.5:lethal.append((x,y))
  if not lethal:raise RuntimeError("LOCAL_STATIC_EVIDENCE_REQUIRED")
  def margin(t):
   x=pose["x"]+t*math.cos(yaw);y=pose["y"]+t*math.sin(yaw)
   return min(math.hypot(max(a-x,0,x-a-resolution),max(b-y,0,y-b-resolution))for a,b in lethal)
  distances=[margin(length*i/20)for i in range(21)]
  return {"pose":pose,"odom":node.continuous_odometry(),"laser_capsule_clearance_m":clearance,"safety_radius_m":.4,"map_lethal_distance_along_segment_m":distances,"monotonic_escape":all(b>=a-1e-4 for a,b in zip(distances,distances[1:])),"distance":length,"scan_stamp":[scan.header.stamp.sec,scan.header.stamp.nanosec]}
 try:
  node.get_state()
  end=time.monotonic()+5
  while (node.costmap is None or node.sensors.get("lidar") is None) and time.monotonic()<end:time.sleep(.05)
  plan=evidence(.20);plan["apply_allowed"]=plan["laser_capsule_clearance_m"]>=.4 and plan["monotonic_escape"] and plan["map_lethal_distance_along_segment_m"][-1]>.44
  (OUT/"bounded-escape-plan.json").write_text(json.dumps(plan,indent=2)+"\n")
  if "--apply" not in sys.argv:print(json.dumps(plan));return 0
  if not plan["apply_allowed"]:raise RuntimeError("ESCAPE_NOT_PROVEN_SAFE")
  # Existing project lease and stop mailbox remain active for this operation.
  statuses=node.navigation_status_snapshot()
  if any(s in [1,2,3]for s in statuses["goal_statuses"]):raise RuntimeError("ACTIVE_NAVIGATION")
  operation="diagnostic-escape-"+uuid.uuid4().hex
  if not node._acquire_motion_lease("diagnostic_recovery",operation):raise RuntimeError("MOTION_BUSY")
  node.active_inspection_owner=operation;node.inspection_cancel.clear()
  origin=node.continuous_odometry();began=time.monotonic();moving=True
  while True:
   if node.inspection_cancel.is_set():raise RuntimeError("USER_STOPPED")
   now=node.continuous_odometry();travel=math.hypot(now["x"]-origin["x"],now["y"]-origin["y"])
   if travel>=.18:break
   if time.monotonic()-began>6:raise RuntimeError("ESCAPE_TIMEOUT")
   check=evidence(min(.03,.20-travel));check["travel_m"]=travel;records.append(check)
   if check["laser_capsule_clearance_m"]<.4 or not check["monotonic_escape"]:raise RuntimeError("ESCAPE_SAFETY_GUARD")
   twist=Twist();twist.linear.x=.06;node.velocity.publish(twist);time.sleep(.05)
  node.velocity.publish(Twist());time.sleep(.25);moving=False
  report={"status":"PASS","kind":"REAL_SIMULATION_DIAGNOSTIC_RECOVERY_NOT_AGNES_TASK_SUCCESS","operation_id":operation,"plan":plan,"records":records,"final":evidence(0),"model_calls":0,"pose_reset":False,"collision_checks_disabled":False}
  (OUT/"bounded-escape-execution.json").write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({k:v for k,v in report.items()if k!="records"}))
 finally:
  if moving:node.velocity.publish(Twist());time.sleep(.1)
  if operation:node.active_inspection_owner=None;node._release_motion_lease(operation)
  node.motion_stop_shutdown.set();node.motion_stop_thread.join(8);node.camera_stream.close();ex.shutdown();node.destroy_node()
  if rclpy.ok():rclpy.shutdown()
  th.join(3)
 return 0
if __name__=="__main__":raise SystemExit(main())
