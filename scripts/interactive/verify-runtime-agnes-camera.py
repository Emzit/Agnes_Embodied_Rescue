"""Image-only Agnes verification at the current pose; no motion or scene writes."""
from pathlib import Path
import os,sys,subprocess,json,time,threading,base64,hashlib
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/runtime-diagnostics-20261014/navigation-camera'
def main():
 if Path.cwd().resolve()!=ROOT:raise RuntimeError('WORKSPACE_REQUIRED')
 if '--child' not in sys.argv:
  candidates=[]
  for proc in Path('/proc').iterdir():
   if not proc.name.isdigit():continue
   try:
    if proc.stat().st_uid!=os.getuid()or(proc/'cwd').resolve()!=ROOT or b'/ros2_bridge/bridge.py'not in(proc/'cmdline').read_bytes():continue
    env=dict(x.split('=',1)for x in(proc/'environ').read_bytes().decode().split('\0')if'='in x)
    if env.get('ROBOT_PERCEPTION')=='vlm':candidates.append((int(proc.name),env))
   except OSError:pass
  if not candidates:raise RuntimeError('OWNED_AGNES_BRIDGE_REQUIRED')
  _,env=max(candidates,key=lambda v:v[0]);env['PYTHONDONTWRITEBYTECODE']='1';env['ROBOT_TRACE_DIR']=str(OUT)
  return subprocess.run([str(ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin/python'),'-B',__file__,'--child'],cwd=ROOT,env=env).returncode
 sys.path.insert(0,str(ROOT/'services/robot-mcp/ros2_bridge'))
 import rclpy
 from rclpy.executors import MultiThreadedExecutor
 from bridge import Bridge
 rclpy.init();node=Bridge();ex=MultiThreadedExecutor(num_threads=4);ex.add_node(node);th=threading.Thread(target=ex.spin,daemon=True);th.start()
 try:
  before=node.get_state();began=time.monotonic();result=node.observation();block=result.pop('_camera_image',None);data=base64.b64decode(block['data'])if block else None
  path=OUT/'live-agnes-camera-recheck.json'
  if data:(OUT/'live-agnes-camera-recheck.png').write_bytes(data)
  report={'status':'PASS'if result['camera']['available']and result['perception_status']=='AVAILABLE'else'FAILED','kind':'ACTUAL_ROS_CAMERA_TO_AGNES_HARNESS_MULTIMODAL_OBSERVATION','duration_sec':time.monotonic()-began,'observation':result,'before_pose':before['pose'],'after_pose':node.get_state()['pose'],'motion_commands':0,'camera_sha256':hashlib.sha256(data).hexdigest()if data else None}
  path.write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps({'status':report['status'],'duration_sec':report['duration_sec'],'camera_available':result['camera']['available'],'perception_status':result['perception_status'],'perception_error_stage':result.get('perception_error_stage'),'semantic_labels':[v['label']for v in result['semantic_objects']],'report':str(path)}),flush=True)
  return 0 if report['status']=='PASS'else 1
 finally:
  if node.perception:node.perception.close()
  node.motion_stop_shutdown.set();node.motion_stop_thread.join(8);node.camera_stream.close();ex.shutdown();th.join(3);node.destroy_node()
  if rclpy.ok():rclpy.shutdown()
if __name__=='__main__':raise SystemExit(main())
