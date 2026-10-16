"""Hardware-free execution of the actual Bridge scan methods with fake sensors.

AST extraction avoids importing ROS or creating a ROS node; all motion, camera
and inference adapters below are explicit unit-test doubles, never live data.
"""
import ast
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import threading
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace as N

source = ast.parse((Path(__file__).resolve().parents[1] / "ros2_bridge/bridge.py").read_text())
klass = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == "Bridge")
names = {"inspection_status_snapshot", "_update_inspection_progress", "start_room_inspection", "room_inspection", "stop", "stop_owned_operation"}
selected = ast.ClassDef(name="Bridge", bases=[], keywords=[], body=[n for n in klass.body if isinstance(n, ast.FunctionDef) and n.name in names], decorator_list=[])
error = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == "SafeError")
scope = {"ThreadPoolExecutor":ThreadPoolExecutor, "hashlib":hashlib, "png_bytes":lambda msg:str(msg.header.stamp.sec).encode(), "json": json, "math": math, "threading": threading, "time": time, "uuid": uuid,
         "os": N(environ={}), "await_future":lambda future, timeout:future, "GoalStatus": N(STATUS_ACCEPTED=1, STATUS_EXECUTING=2, STATUS_CANCELING=3, STATUS_CANCELED=5),
         "String": lambda **kw: N(**kw), "Twist": lambda: N()}
exec(compile(ast.fix_missing_locations(ast.Module(body=[error, selected], type_ignores=[])), "<actual-bridge-scan-methods>", "exec"), scope)
Bridge, SafeError = scope["Bridge"], scope["SafeError"]

def make_bridge():
    b = Bridge()
    b.lock = threading.Lock()
    b.motion_owner_guard = threading.Lock()
    b.motion_owner = None
    b.inspection_lock = threading.Lock()
    b.inspection_cancel = threading.Event()
    b.inspection_operation = b.inspection_thread = b.active_inspection_owner = None
    b.navigation_operation = b.active_goal = b.result_future = None
    b.goal_statuses = []
    b.perception = object()
    b.leased = False
    b.rotations = []
    b.zero_count = 0
    b.frames = 0
    b.yaw = 0.3
    b.odom_yaw = -0.2
    b.odom_targets = []
    b.continuous_odometry = lambda: {"x":0,"y":0,"yaw":b.odom_yaw,"frame_id":"odom"}
    b.inspection_event_values = []
    b.inspection_events = N(publish=lambda value: b.inspection_event_values.append(value))
    b.published_zeros = []
    b.velocity = N(publish=lambda value: b.published_zeros.append(value))
    b._external_motion_owner = lambda: None
    def acquire(*args):
        if b.leased:return False
        b.leased = True
        b.motion_owner = {"operation_id":args[-1]}
        return True
    b._acquire_motion_lease = acquire
    def release(*args):
        b.leased = False
        b.motion_owner = None
    b._release_motion_lease = release
    b.get_state = lambda: {"position":{"x":1,"y":2},"pose":{"x":1,"y":2,"frame_id":"map"},
                           "yaw":b.yaw,"linear_velocity":0,"angular_velocity":0}
    def rotate(target_yaw, **kwargs):
        if b.inspection_cancel.is_set():raise SafeError("ROBOT_STOPPED")
        b.rotations.append(target_yaw)
        odom_target=kwargs.get("odom_target_yaw",b.odom_yaw)
        b.odom_targets.append(odom_target)
        measured=math.atan2(math.sin(odom_target-b.odom_yaw),math.cos(odom_target-b.odom_yaw))
        b.odom_yaw=math.atan2(math.sin(odom_target),math.cos(odom_target))
        b.yaw = math.atan2(math.sin(target_yaw), math.cos(target_yaw))
        return {"status":"SUCCEEDED","target_yaw":target_yaw,"control_frame":"odom","measured_radians":measured}
    b.rotate_in_place = rotate
    def circle(initial, initial_odom, owner_token, on_view, check_scan):
        measured=0.0
        for i in range(8):
            check_scan()
            motion=rotate(initial["yaw"]+i*math.pi/4,
                          odom_target_yaw=initial_odom["yaw"]+i*math.pi/4)
            measured+=motion["measured_radians"]
            on_view(b.fresh_frame(), b.get_state(), b.continuous_odometry(), motion)
        motion=rotate(initial["yaw"]+2*math.pi,
                      odom_target_yaw=initial_odom["yaw"]+2*math.pi)
        measured+=motion["measured_radians"]
        return {"measured_radians":measured,"return_motion":motion,"capture_sec":0.1}
    b.capture_scan_circle=circle
    def fresh(*args):
        b.frames += 1
        return N(header=N(stamp=N(sec=b.frames,nanosec=0)))
    b.fresh_frame = fresh
    b.detect_frame = lambda *args: []
    b._zero_twist = lambda: setattr(b,"zero_count",b.zero_count+1)
    return b

PARAMS = {"room":"Start","region_type":"start","expected_pose":{"x":1,"y":2},"async":True}

class RegionInspectionTests(unittest.TestCase):
    def test_async_pending_full_circle_and_release(self):
        b=make_bridge(); gate=threading.Event(); entered=threading.Event()
        def detect(*_):entered.set();gate.wait(3);return []
        b.detect_frame=detect
        result=b.start_room_inspection(PARAMS)
        self.assertEqual(result["status"],"PENDING")
        self.assertTrue(entered.wait(1))
        self.assertTrue(b.leased)
        self.assertFalse(b.inspection_status_snapshot()["terminal_known"])
        with self.assertRaises(SafeError) as failure:b.start_room_inspection(PARAMS)
        self.assertEqual(failure.exception.code,"INSPECTION_BUSY")
        gate.set();b.inspection_thread.join(3)
        state=b.inspection_status_snapshot()
        self.assertEqual(state["status"],"SUCCEEDED")
        self.assertTrue(state["terminal_known"]);self.assertFalse(state["active"])
        self.assertEqual(state["result"]["scan_views"],8)
        self.assertEqual(len({v["frame_sha256"] for v in state["result"]["evidence"]}),8)
        self.assertTrue(state["result"]["rotation_complete"])
        self.assertEqual(len(b.rotations),9)
        self.assertAlmostEqual(b.rotations[-1]-b.rotations[0],2*math.pi)
        self.assertAlmostEqual(b.yaw,0.3)
        self.assertAlmostEqual(b.odom_targets[-1]-b.odom_targets[0],2*math.pi)
        self.assertAlmostEqual(state["result"]["rotation_evidence"]["measured_radians"],2*math.pi)
        self.assertFalse(b.leased);self.assertFalse(b.inspection_lock.locked())
        self.assertFalse(state["result"]["complete_visibility_claimed"])
        self.assertEqual(b.inspection_event_values,[])  # not a room-completed dynamic trigger

    def test_eight_views_and_return_stay_odom_anchored_through_map_correction(self):
        b=make_bridge()
        original=b.get_state
        calls=[0]
        def jumping_map():
            calls[0]+=1
            state=original()
            if calls[0]>1:
                state["position"]={"x":9+calls[0],"y":-2}
                state["yaw"]+=0.4
            return state
        b.get_state=jumping_map
        b.start_room_inspection(PARAMS);b.inspection_thread.join(3)
        result=b.inspection_status_snapshot()["result"]
        self.assertEqual(result["status"],"SUCCEEDED")
        self.assertEqual(result["scan_views"],8);self.assertTrue(result["rotation_complete"])
        self.assertEqual(result["rotation_evidence"]["max_xy_drift_m"],0)
        for index,target in enumerate(b.odom_targets):
            self.assertAlmostEqual(target,-0.2+index*math.pi/4)

    def test_navigation_and_pose_change_refuse_start(self):
        for change,code in [
            (lambda b:setattr(b,"navigation_operation",{"id":"nav"}),"NAVIGATION_NOT_IDLE"),
            (lambda b:setattr(b,"goal_statuses",[N(status=2)]),"NAVIGATION_NOT_IDLE"),
            (lambda b:setattr(b,"leased",True),"MOTION_CONTROL_BUSY"),
        ]:
            b=make_bridge();change(b)
            with self.assertRaises(SafeError) as failure:b.start_room_inspection(PARAMS)
            self.assertEqual(failure.exception.code,code)
            self.assertFalse(b.inspection_lock.locked());self.assertEqual(b.rotations,[])
        b=make_bridge()
        with self.assertRaises(SafeError) as failure:
            b.start_room_inspection({**PARAMS,"expected_pose":{"x":8,"y":2}})
        self.assertEqual(failure.exception.code,"INSPECTION_POSE_CHANGED")
        self.assertFalse(b.leased);self.assertFalse(b.inspection_lock.locked())

    def test_cancel_during_inference_keeps_lease_until_worker_observes_cancel(self):
        b=make_bridge();gate=threading.Event();entered=threading.Event()
        def detect(*_):entered.set();gate.wait(5);return []
        b.detect_frame=detect;b.start_room_inspection(PARAMS);self.assertTrue(entered.wait(1))
        stopped=b.stop_owned_operation(b.active_inspection_owner)
        self.assertFalse(stopped["terminal_known"])
        self.assertEqual(stopped["cancel_status"],"ACCEPTED_PENDING")
        self.assertTrue(b.leased)
        gate.set();b.inspection_thread.join(3)
        result=b.inspection_status_snapshot()["result"]
        self.assertEqual(result["status"],"PARTIAL");self.assertEqual(result["reason"],"ROBOT_STOPPED")
        self.assertFalse(result["rotation_complete"]);self.assertLessEqual(len(b.rotations),9)
        self.assertFalse(b.leased);self.assertFalse(b.inspection_lock.locked())
        self.assertGreater(b.zero_count,0)

    def test_capture_and_return_finish_while_first_inference_is_waiting(self):
        b=make_bridge(); gate=threading.Event(); entered=threading.Event()
        seen=[]
        def detect(msg, state):
            seen.append((msg.header.stamp.sec, state["yaw"]))
            entered.set(); gate.wait(3); return []
        b.detect_frame=detect
        b.start_room_inspection(PARAMS)
        self.assertTrue(entered.wait(1))
        deadline=time.monotonic()+1
        while time.monotonic()<deadline and len(b.rotations)<9:time.sleep(.01)
        state=b.inspection_status_snapshot()
        self.assertEqual(len(b.rotations),9)
        self.assertEqual(state["captured_views"],8)
        self.assertEqual(state["analyzed_views"],0)
        self.assertEqual(state["phase"],"ANALYZING")
        self.assertFalse(state["terminal_known"])
        self.assertTrue(b.leased)
        gate.set();b.inspection_thread.join(3)
        state=b.inspection_status_snapshot()
        self.assertEqual(state["status"],"SUCCEEDED")
        self.assertEqual(state["analyzed_views"],8)
        self.assertEqual(len(seen),8)
        self.assertEqual([v[0] for v in seen],sorted(v[0] for v in seen))
        self.assertEqual(state["result"]["timing"]["capture_sec"],0.1)
        self.assertGreaterEqual(state["result"]["timing"]["perception_drain_sec"],0)

    def test_scoped_stop_never_touches_replacement_owner(self):
        b=make_bridge();b.motion_owner={"operation_id":"new-operation"}
        result=b.stop_owned_operation("old-operation")
        self.assertEqual(result["reason"],"OWNER_CHANGED")
        self.assertEqual(b.published_zeros,[])
        self.assertFalse(b.inspection_cancel.is_set())

    def test_scoped_stop_cancels_only_the_captured_nav_handle(self):
        b=make_bridge();canceled=[]
        b.motion_owner={"operation_id":"nav-owned"};b.navigation_operation={"operation_id":"nav-owned"}
        b.active_goal=N(cancel_goal_async=lambda:(canceled.append("captured") or N(goals_canceling=[1])))
        b.result_future=N(status=5)
        result=b.stop_owned_operation("nav-owned")
        self.assertTrue(result["stopped"]);self.assertTrue(result["terminal_known"])
        self.assertEqual(canceled,["captured"]);self.assertEqual(len(b.published_zeros),1)

    def test_scoped_stop_before_nav_acceptance_does_not_publish_competing_velocity(self):
        b=make_bridge();b.motion_owner={"operation_id":"nav-owned"};b.navigation_operation={"operation_id":"nav-owned"}
        result=b.stop_owned_operation("nav-owned")
        self.assertEqual(result["reason"],"OWNER_NOT_READY");self.assertEqual(b.published_zeros,[])

    def test_perception_failure_and_unexpected_failure_are_terminal_without_success(self):
        for exception in (SafeError("PERCEPTION_UNAVAILABLE"), ValueError("test failure")):
            b=make_bridge()
            def fail(*_):raise exception
            b.detect_frame=fail;b.start_room_inspection(PARAMS);b.inspection_thread.join(3)
            state=b.inspection_status_snapshot()
            self.assertTrue(state["terminal_known"]);self.assertNotEqual(state["status"],"SUCCEEDED")
            self.assertFalse(state["result"]["rotation_complete"])
            self.assertFalse(b.leased);self.assertFalse(b.inspection_lock.locked())
            self.assertGreater(b.zero_count,0)

if __name__ == "__main__":unittest.main()
