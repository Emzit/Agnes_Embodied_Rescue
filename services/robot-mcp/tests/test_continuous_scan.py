"""Exercise the actual continuous scan controller without ROS, motion or models."""
import ast
import math
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace as N

source=ast.parse((Path(__file__).resolve().parents[1]/"ros2_bridge/bridge.py").read_text())
klass=next(n for n in source.body if isinstance(n,ast.ClassDef) and n.name=="Bridge")
error=next(n for n in source.body if isinstance(n,ast.ClassDef) and n.name=="SafeError")
selected=ast.ClassDef(name="Bridge",bases=[],keywords=[],decorator_list=[],body=[
 n for n in klass.body if isinstance(n,ast.FunctionDef) and n.name=="capture_scan_circle"])
clock=N(value=0.0)
scope={"math":math,"time":N(monotonic=lambda:clock.value,time=lambda:clock.value),
       "Twist":lambda:N(linear=N(x=0.0,y=0.0,z=0.0),angular=N(x=0.0,y=0.0,z=0.0))}
exec(compile(ast.fix_missing_locations(ast.Module(body=[error,selected],type_ignores=[])),"<actual-circle>", "exec"),scope)
Bridge,SafeError=scope["Bridge"],scope["SafeError"]

def robot(stale_camera=False,cancel_at=None,drift_at=None,lost_owner_at=None,offset_camera=0.0):
    clock.value=0.0
    b=Bridge();b.lock=threading.Lock();b.inspection_cancel=threading.Event()
    b.active_inspection_owner="scan";b.commands=[];b.zero_count=0
    b.yaw=0.0;b.x=0.0;b.views=[];b.frame_count=0;b.sensors={}
    b.continuous_odometry=lambda:{"x":b.x,"y":0.0,"yaw":math.atan2(math.sin(b.yaw),math.cos(b.yaw)),"frame_id":"odom", "timestamp":{"sec":int(clock.value),"nanosec":int((clock.value%1)*1e9)}}
    def state():
        # Stationary map corrections are distinct from continuous odometry.
        return {"position":{"x":clock.value,"y":0},"pose":{"x":clock.value,"y":0,"frame_id":"map"},
                "yaw":math.atan2(math.sin(b.yaw+1.0+.2*clock.value),math.cos(b.yaw+1.0+.2*clock.value))}
    b.get_state=state
    def frame():
        b.frame_count+=1
        stamp=int((clock.value+offset_camera)*1e9)+b.frame_count
        msg=N(header=N(stamp=N(sec=stamp//1000000000,nanosec=stamp%1000000000)))
        b.sensors["camera"]=(msg,clock.value)
        return msg
    b.fresh_frame=lambda *args:frame()
    def sleep(seconds):
        clock.value+=seconds
        if not stale_camera:frame()
        if cancel_at is not None and clock.value>=cancel_at:b.inspection_cancel.set()
        if drift_at is not None and clock.value>=drift_at:b.x=.21
        if lost_owner_at is not None and clock.value>=lost_owner_at:b.active_inspection_owner="other"
    scope["time"].sleep=sleep
    def publish(twist):
        b.commands.append(twist)
        b.yaw+=twist.angular.z*.05
    b.velocity=N(publish=publish)
    b._zero_twist=lambda:setattr(b,"zero_count",b.zero_count+1)
    def check():
        if b.inspection_cancel.is_set():raise SafeError("ROBOT_STOPPED")
        if b.active_inspection_owner!="scan":raise SafeError("MOTION_OWNERSHIP_LOST")
        if math.hypot(b.x,0)>.20:raise SafeError("ROTATION_XY_DRIFT")
    b.check_scan=check
    def capture(msg,state,odom,motion):
        b.views.append((msg,state,odom,motion,len(b.commands)))
    b.capture=capture
    return b

class ContinuousScanTests(unittest.TestCase):
    def run_scan(self,b):
        return b.capture_scan_circle(b.get_state(),b.continuous_odometry(),"scan",b.capture,b.check_scan)
    def test_eight_distinct_frames_continuous_safe_rate_and_full_odometry_circle(self):
        b=robot();result=self.run_scan(b)
        self.assertEqual(len(b.views),8)
        keys=[(v[0].header.stamp.sec,v[0].header.stamp.nanosec) for v in b.views]
        self.assertEqual(keys,sorted(set(keys)))
        for i,view in enumerate(b.views):
            self.assertLess(abs(math.atan2(math.sin(view[2]["yaw"]-i*math.pi/4),
                                          math.cos(view[2]["yaw"]-i*math.pi/4))),.06)
            self.assertEqual(view[3]["status"],"SUCCEEDED")
            self.assertEqual(view[3]["control_frame"],"odom")
        self.assertLess(abs(result["measured_radians"]-2*math.pi),.06)
        self.assertEqual(result["return_motion"]["status"],"SUCCEEDED")
        self.assertEqual(b.zero_count,1)
        self.assertTrue(all(0<t.angular.z<=.55 for t in b.commands))
        self.assertTrue(all(t.linear.x==0 and t.linear.y==0 for t in b.commands))
        # No per-view slowdown: every published turn before the final capture
        # uses the unchanged cruise limit.
        self.assertTrue(all(t.angular.z==.55 for t in b.commands[:b.views[-1][4]]))
        self.assertLess(result["capture_sec"],13.5)  # simulated sensor clock
    def test_stalled_camera_stops_without_skipping_or_reusing_frames(self):
        b=robot(stale_camera=True)
        with self.assertRaises(SafeError) as fail:self.run_scan(b)
        self.assertEqual(fail.exception.code,"CAMERA_UNAVAILABLE")
        self.assertEqual(len(b.views),1);self.assertEqual(b.zero_count,1)
    def test_cancel_drift_and_owner_loss_stop_during_the_sweep(self):
        for kwargs,reason in [({"cancel_at":.5},"ROBOT_STOPPED"),
                              ({"drift_at":.5},"ROTATION_XY_DRIFT"),
                              ({"lost_owner_at":.5},"MOTION_OWNERSHIP_LOST")]:
            with self.subTest(reason=reason):
                b=robot(**kwargs)
                with self.assertRaises(SafeError) as fail:self.run_scan(b)
                self.assertEqual(fail.exception.code,reason)
                self.assertEqual(b.zero_count,1)
                self.assertLess(len(b.views),8)
    def test_camera_timestamp_must_match_captured_odometry_time(self):
        b=robot(offset_camera=1.0)
        with self.assertRaises(SafeError) as fail:self.run_scan(b)
        self.assertEqual(fail.exception.code,"CAMERA_UNAVAILABLE")
        self.assertEqual(b.views,[]);self.assertEqual(b.zero_count,1)
    def test_no_camera_frame_is_accepted_after_its_bearing_was_missed(self):
        b=robot()
        original=b.check_scan
        def delayed():
            original()
            if 1.35<clock.value<1.45:
                b.yaw+=.2
        b.check_scan=delayed
        with self.assertRaises(SafeError) as fail:self.run_scan(b)
        self.assertEqual(fail.exception.code,"INSPECTION_CAMERA_BEARING_MISSED")
        self.assertEqual(len(b.views),1);self.assertEqual(b.zero_count,1)

if __name__=="__main__":unittest.main()
