"""Pure guards: no simulator, model, SDK, files or robot actions."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, mock_open
from contextlib import ExitStack
from types import SimpleNamespace
import os
import signal

spec=importlib.util.spec_from_file_location("scene_prepare",Path(__file__).with_name("prepare-scene.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
CONFIG={"seed":123,"world_name":"test-world","snapshot_sha256":"a"*64}
APPROVAL={**CONFIG,"authorized":True,"action":"reset_same_scene","human_confirmation":"User approved this reset",
          "approved_at":"2026-10-13T00:00:00+00:00","expires_at":"2026-10-13T00:30:00+00:00"}
NOW=module.epoch("2026-10-13T00:01:00+00:00")

class Guards(unittest.TestCase):
    def test_matching_recent_explicit_approval(self):
        module.validate_approval(APPROVAL,CONFIG,NOW)
    def test_default_false_missing_quote_and_config_mismatch(self):
        for change in ({"authorized":False},{"human_confirmation":""},{"seed":124},
                       {"world_name":"other"},{"snapshot_sha256":"b"*64},{"action":"other"}):
            with self.assertRaises(RuntimeError):module.validate_approval({**APPROVAL,**change},CONFIG,NOW)
    def test_expired_future_overlong_and_naive_timestamps(self):
        for change in ({"expires_at":"2026-10-13T00:00:30+00:00"},
                       {"approved_at":"2026-10-13T00:05:00+00:00"},
                       {"expires_at":"2026-10-13T03:00:00+00:00"},
                       {"approved_at":"2026-10-13T00:00:00"}):
            with self.assertRaises(RuntimeError):module.validate_approval({**APPROVAL,**change},CONFIG,NOW)
    def test_output_and_approval_paths_must_stay_inside_project(self):
        self.assertEqual(module.inside("artifacts/demo-video/test"),module.R/"artifacts/demo-video/test")
        for value in ("/tmp/test",str(module.R/"../other"),str(module.R)):
            with self.assertRaises(RuntimeError):module.inside(value)
    def test_default_check_never_applies_or_creates_output(self):
        checked=(CONFIG,{"ros":{}},None,None)
        with patch.object(module.sys,"argv",["prepare-scene.py"]), patch.object(module,"checked",return_value=checked), \
             patch.object(module,"apply_scene") as apply, patch.object(module,"save") as save, \
             patch.object(module.Path,"cwd",return_value=module.R), patch("builtins.print"):
            module.main()
        apply.assert_not_called();save.assert_not_called()
    def test_signal_interruptions_are_catchable_failures(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.assertRaisesRegex(RuntimeError, "PREPARATION_INTERRUPTED"):
                module.interrupted(sig,None)
    def test_safety_rejects_nonfinite_future_and_stale_pose(self):
        native={"status":"IDLE","observer_connected":True,
                "observer_updated_at":"2026-10-13T00:01:00+00:00"}
        ros={"ros_domain_id":106,"updated_at":NOW,"pose_age_ms":0,
             "navigation":{"status":"IDLE","active_goals":[],"motion_lease":{"held":False}},
             "velocity":{"linear_x":0,"linear_y":0,"angular_z":0}}
        for change in ({"updated_at":float("nan")},{"updated_at":float("inf")},{"updated_at":NOW+1},
                       {"pose_age_ms":float("nan")},{"pose_age_ms":-1},{"pose_age_ms":2500}):
            with patch.object(module,"read",side_effect=[{**ros,**change},native]), \
                 patch.object(module.time,"time",return_value=NOW):
                with self.assertRaises(RuntimeError):module.safety()
    def verify_transaction(self, *, lock_pid=7, node_ppid=7, fingerprint=None):
        lease={"kind":"demo_scene_prepare","job_id":"job","pid":7}
        def read(p):
            return lease if str(p).endswith("motion-control.lock") else {"job_id":"job"} if "used-scene-approvals" in str(p) else APPROVAL
        def text(p,*args,**kwargs):
            return "11 (node task) S "+str(node_ppid)+" 0" if str(p).endswith("/stat") else (
                "1: FLOCK ADVISORY WRITE "+str(lock_pid)+" 08:02:99 0 EOF")
        def resolve(p,*args,**kwargs):
            return module.R if str(p)=="/proc/7/cwd" else Path(os.path.normpath(str(p)))
        with ExitStack() as ctx:
            ctx.enter_context(patch.object(module,"read",side_effect=read))
            ctx.enter_context(patch.object(module,"digest",return_value="hash"))
            ctx.enter_context(patch.object(module,"current_config",return_value={**CONFIG,**({"snapshot_sha256":fingerprint} if fingerprint else {})}))
            ctx.enter_context(patch.object(module,"safety",return_value={}))
            ctx.enter_context(patch.object(module.time,"time",return_value=NOW))
            ctx.enter_context(patch.object(Path,"read_text",text))
            ctx.enter_context(patch.object(Path,"read_bytes",return_value=b"python3\0-B\0scripts/demo-video/prepare-scene.py\0--apply\0"))
            ctx.enter_context(patch.object(Path,"resolve",resolve))
            ctx.enter_context(patch.object(Path,"stat",return_value=SimpleNamespace(st_uid=os.getuid(),st_dev=os.makedev(8,2),st_ino=99)))
            ctx.enter_context(patch.object(Path,"open",mock_open()))
            ctx.enter_context(patch.object(module.fcntl,"flock",side_effect=BlockingIOError()))
            return module.verify_reconnect_transaction("artifacts/demo-video/approval.json",11,7)
    def test_reconnect_requires_live_exact_parent_flock_and_current_config(self):
        self.assertTrue(self.verify_transaction()["pass"])
        for change in ({"lock_pid":9},{"node_ppid":9},{"fingerprint":"b"*64}):
            with self.assertRaises(RuntimeError):self.verify_transaction(**change)
    def test_unknown_navigation_requires_explicit_new_generation_gate(self):
        native={"status":"IDLE","observer_connected":True,
                "observer_updated_at":"2026-10-13T00:01:00+00:00"}
        ros={"ros_domain_id":106,"updated_at":NOW,"pose_age_ms":0,
             "navigation":{"status":"UNKNOWN","active_goals":[],"goal_statuses":[],
                           "status_received_at":None,"motion_lease":{"held":False}},
             "velocity":{"linear_x":0,"linear_y":0,"angular_z":0}}
        with patch.object(module,"read",side_effect=[ros,native]), patch.object(module.time,"time",return_value=NOW):
            with self.assertRaisesRegex(RuntimeError,"NAVIGATION_NOT_IDLE"):module.safety()
        with patch.object(module,"read",side_effect=[ros,native]), patch.object(module.time,"time",return_value=NOW):
            self.assertEqual(module.safety(fresh_generation=True)["ros"]["navigation"]["status"],"UNKNOWN")
        ros["navigation"]["active_goals"]=[{"status":2}]
        with patch.object(module,"read",side_effect=[ros,native]), patch.object(module.time,"time",return_value=NOW):
            with self.assertRaisesRegex(RuntimeError,"NAVIGATION_NOT_IDLE"):module.safety(fresh_generation=True)
    def test_generation_proof_requires_exact_new_stack_and_does_not_publish_motion(self):
        out=module.R/"artifacts/demo-video/test"
        ready={"ready":True,"clock_advancing":True,"fresh_odom":True,"tf_ready":True}
        entries=[{"name":"supervisor","pid":21,"ppid":20},{"name":"nav2","pid":22,"ppid":21,"start_time":"123"}]
        def run(env):
            with patch.object(module,"read",side_effect=[ready,{"pid":20}]), \
                 patch.object(module,"owned_stack",return_value=(entries,env)), \
                 patch.object(module,"current_config",return_value=CONFIG), patch.object(module,"save") as save:
                value=module.publish_generation(CONFIG,out,"job",NOW)
                self.assertEqual(save.call_count,2)
                return value
        proof=run({"FINAL_RUN_DIR":str(out/"runtime")})
        self.assertEqual(proof["nav_pid"],22)
        with self.assertRaisesRegex(RuntimeError,"NEW_STACK_GENERATION_MISMATCH"):run({"FINAL_RUN_DIR":"wrong"})
        entries[1]["ppid"]=999
        with self.assertRaisesRegex(RuntimeError,"NEW_STACK_GENERATION_MISMATCH"):run({"FINAL_RUN_DIR":str(out/"runtime")})
if __name__=="__main__":unittest.main()
