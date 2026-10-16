"""Run actual continuous-odometry controller with pure, bounded sensor doubles."""
import ast
import math
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace as N

source=ast.parse((Path(__file__).resolve().parents[1]/"ros2_bridge/bridge.py").read_text())
klass=next(n for n in source.body if isinstance(n,ast.ClassDef) and n.name=="Bridge")
error=next(n for n in source.body if isinstance(n,ast.ClassDef) and n.name=="SafeError")
methods={"continuous_odometry","rotate_in_place"}
selected=ast.ClassDef(name="Bridge",bases=[],keywords=[],decorator_list=[],body=[
 n for n in klass.body if isinstance(n,ast.FunctionDef) and n.name in methods])
clock=N(value=0.0)
fake_time=N(monotonic=lambda:clock.value,time=lambda:clock.value,sleep=lambda seconds:setattr(clock,"value",clock.value+seconds))
scope={"math":math,"time":fake_time,"Twist":lambda:N(linear=N(x=0.0,y=0.0,z=0.0),angular=N(x=0.0,y=0.0,z=0.0))}
exec(compile(ast.fix_missing_locations(ast.Module(body=[error,selected],type_ignores=[])),"<actual-rotation>","exec"),scope)
Bridge,SafeError=scope["Bridge"],scope["SafeError"]

def robot(drift=False):
 clock.value=0.0
 b=Bridge();b.lock=threading.Lock();b.inspection_cancel=threading.Event();b.active_inspection_owner="scan"
 b.local_odometry={"x":0.0,"y":0.0,"yaw":0.0,"frame_id":"odom"}
 b.odom_received_monotonic=0.0;b.commands=[];b.zero_count=0;b.map_calls=0
 def state():
  b.map_calls+=1
  # An AMCL correction may change global position/yaw during a stationary turn.
  x=b.map_calls*2.0
  return {"position":{"x":x,"y":-6.7},"pose":{"x":x,"y":-6.7,"frame_id":"map"},
          "yaw":b.local_odometry["yaw"]+(1.0 if b.map_calls==1 else 1.4)}
 b.get_state=state
 def publish(twist):
  b.commands.append(twist)
  b.local_odometry["yaw"]+=twist.angular.z*.05
  if drift:b.local_odometry["x"]+=.21
  b.odom_received_monotonic=clock.value+.05
 b.velocity=N(publish=publish);b._zero_twist=lambda:setattr(b,"zero_count",b.zero_count+1)
 return b

class RotationTests(unittest.TestCase):
 def test_map_jump_does_not_abort_real_stationary_odom_rotation(self):
  b=robot();result=b.rotate_in_place(1+math.pi/4,owner_token="scan")
  self.assertEqual(result["status"],"SUCCEEDED");self.assertEqual(result["control_frame"],"odom")
  self.assertEqual(result["xy_drift"],0);self.assertGreater(result["map_xy_displacement"],.2)
  self.assertAlmostEqual(result["target_odometry_yaw"],math.pi/4)
  self.assertLess(abs(result["measured_radians"]-math.pi/4),.06)
  self.assertTrue(all(t.linear.x==0 and t.linear.y==0 for t in b.commands))
  self.assertEqual(b.zero_count,1)
 def test_real_odom_drift_still_stops_at_unchanged_threshold(self):
  b=robot(drift=True)
  with self.assertRaises(SafeError) as failed:b.rotate_in_place(1+math.pi/4,owner_token="scan")
  self.assertEqual(failed.exception.code,"ROTATION_XY_DRIFT");self.assertEqual(b.zero_count,1)
 def test_stale_local_odometry_cannot_control(self):
  b=robot();clock.value=2
  with self.assertRaises(SafeError) as failed:b.rotate_in_place(1+math.pi/4,owner_token="scan")
  self.assertEqual(failed.exception.code,"POSE_STALE");self.assertEqual(b.commands,[])
if __name__=="__main__":unittest.main()
