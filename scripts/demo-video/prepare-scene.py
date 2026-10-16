#!/usr/bin/env python3
"""Prepare the existing simulation for a recorded run; --check is read-only.

--apply requires a recent human approval bound to the exact current config.
No seed generation, scenario compilation, model call, target lookup or
navigation occurs here. The only physical reset is an owned stack restart.
"""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
R = Path("/data-ssd/zhongchengkai/agnes")
O = R / "artifacts/demo-ui-final"
BASE = R / "artifacts/demo-video"
NODE = R / "tools/node/bin/node"
GZ = R / "runtime/ros2-jazzy/.pixi/envs/default/bin/gz"
TERMINAL = {"IDLE", "SUCCEEDED", "PARTIAL", "FAILED", "CANCELED", "COMPLETED"}
def read(p): return json.loads(Path(p).read_text())
def inside(p):
    p = Path(p)
    p = (R / p).resolve() if not p.is_absolute() else p.resolve()
    if R not in p.parents: raise RuntimeError("PATH_OUTSIDE_PROJECT")
    return p
def digest(p): return hashlib.sha256(inside(p).read_bytes()).hexdigest()
def stamp(): return datetime.now(timezone.utc).isoformat()
def epoch(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None: raise RuntimeError("TIMEZONE_REQUIRED")
    return parsed.timestamp()
def save(p, data):
    p = inside(p)
    temporary = p.with_suffix(p.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(p)
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, inside(file))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def current_config():
    public = read(R / "artifacts/interactive-live/current-scenario.json")
    if any(k in public for k in ("hidden_ground_truth", "person_target_room", "person_pose_orientation")):
        raise RuntimeError("PUBLIC_SCENARIO_NOT_SANITIZED")
    layout = public["layout"]
    if not layout.get("imported"): raise RuntimeError("IMPORTED_SCENE_REQUIRED")
    env_file = R / "artifacts/interactive-live/current-scenario.env"
    lines = env_file.read_text().splitlines()
    opaque_private = next((line.split("=", 1)[1] for line in lines if line.startswith("export SCENARIO_PRIVATE_FILE=")), None)
    if not opaque_private: raise RuntimeError("EXISTING_SCENARIO_CONTROLLER_CONFIG_REQUIRED")
    files = [R / "artifacts/interactive-live/current-scenario.json", env_file,
             R / "artifacts/interactive-live/imported-map.env", inside(opaque_private)]
    files += [inside(layout[k]) for k in ("world", "map", "registry", "nav2", "bridge")]
    files += [inside(layout["registry"]).parent / "interaction-registry.json"]
    image_line = re.search(r"^image:\s*(.+?)\s*$", inside(layout["map"]).read_text(), re.M)
    if not image_line: raise RuntimeError("STATIC_MAP_IMAGE_REQUIRED")
    image_name = image_line[1].strip().strip(chr(34) + chr(39))
    files += [inside(inside(layout["map"]).parent / image_name)]
    # The controller config is fingerprinted as opaque bytes, never decoded:
    # no target identity, room or pose is read into this preparation tool.
    hashes = {str(p.relative_to(R)): digest(p) for p in files}
    identity = {"seed": public["seed"], "world_name": layout["id"], "files": hashes}
    fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    registry = read(inside(layout["registry"]))
    start = next(x["pose"] for x in registry["locations"] if x["id"] == "Start")
    doors = read(inside(layout["registry"]).parent / "interaction-registry.json")["doors"]
    if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", d["id"]) for d in doors):
        raise RuntimeError("INVALID_DOOR_IDENTIFIER")
    return {**identity, "snapshot_sha256": fingerprint, "start": start, "doors": doors}

def validate_approval(approval, config, now=None):
    now = time.time() if now is None else now
    if approval.get("authorized") is not True or approval.get("action") != "reset_same_scene":
        raise RuntimeError("EXPLICIT_HUMAN_APPROVAL_REQUIRED")
    if not isinstance(approval.get("human_confirmation"), str) or not approval["human_confirmation"].strip():
        raise RuntimeError("HUMAN_CONFIRMATION_REQUIRED")
    for key in ("seed", "world_name", "snapshot_sha256"):
        if approval.get(key) != config[key]: raise RuntimeError("APPROVAL_CONFIG_MISMATCH:" + key)
    approved, expires = epoch(approval["approved_at"]), epoch(approval["expires_at"])
    if not 0 <= now - approved <= 3600 or not now < expires <= approved + 3600:
        raise RuntimeError("APPROVAL_EXPIRED")

def safety(held_job=None, fresh_generation=False):
    ros, native = read(O / "ros-state.json"), read(O / "native-session-state.json")
    now = time.time()
    if ros.get("ros_domain_id") != 106 or not 0 <= now - ros["updated_at"] < 3:
        raise RuntimeError("FRESH_ROS_REQUIRED")
    if ros.get("pose_age_ms") is None or not 0 <= ros["pose_age_ms"] < 2500:
        raise RuntimeError("FRESH_ROS_POSE_REQUIRED")
    nav = ros["navigation"]
    initial_generation = (fresh_generation and nav["status"] == "UNKNOWN" and
                          nav.get("status_received_at") is None and nav.get("goal_statuses") == [])
    if (nav["status"] != "IDLE" and not initial_generation) or nav["active_goals"]:
        raise RuntimeError("NAVIGATION_NOT_IDLE")
    lease = nav["motion_lease"]
    if lease["held"] and (not held_job or (lease.get("owner") or {}).get("job_id") != held_job):
        raise RuntimeError("MOTION_LEASE_BUSY")
    velocity = ros.get("velocity")
    if not velocity or not all(math.isfinite(v) and abs(v) < .001 for v in velocity.values()):
        raise RuntimeError("ZERO_VELOCITY_REQUIRED")
    if native.get("status") not in TERMINAL or native.get("pending_approvals") or native.get("pending_inputs"):
        raise RuntimeError("NATIVE_SESSION_BUSY")
    if not native.get("observer_connected") or not 0 <= now - epoch(native["observer_updated_at"]) < 4:
        raise RuntimeError("FRESH_NATIVE_REQUIRED")
    return {"ros": ros, "native": {k: native.get(k) for k in ("session_id", "status", "observer_updated_at")}}

def owned_stack():
    stack = module("demo_owned_stack", "scripts/phase9d/stack.py")
    stack.PHASE = "final_rescue"
    stack.REGISTRY = R / ".runtime-final_rescue/processes.json"
    entries, live, env = stack.load()["entries"], [], None
    for entry in entries:
        if not stack.matches(entry): continue
        proc = Path("/proc") / str(entry["pid"])
        if (proc / "cwd").resolve() != R or proc.stat().st_uid != os.getuid():
            raise RuntimeError("STACK_PROCESS_NOT_OWNED")
        pairs = (proc / "environ").read_bytes().split(bytes([0]))
        values = dict(v.decode().split("=", 1) for v in pairs if b"=" in v)
        if values.get("ROS_DOMAIN_ID") != "106" or values.get("GZ_PARTITION") != "agnes_final_rescue":
            raise RuntimeError("STACK_DOMAIN_MISMATCH")
        if entry.get("group") and os.getpgid(entry["pid"]) != entry["pid"]:
            raise RuntimeError("STACK_PROCESS_GROUP_MISMATCH")
        live.append(entry)
        if entry["name"] == "gz-server": env = values
    if not {"supervisor", "gz-server", "nav2", "ros-gz-bridge", "odom-tf"}.issubset({e["name"] for e in live}) or env is None:
        raise RuntimeError("OWNED_STACK_NOT_RUNNING")
    return live, env

def door_states(config, env):
    def one(door):
        response = subprocess.run([str(GZ), "model", "-m", "door_" + door["id"], "-l", "panel"],
            cwd=R, env=env, capture_output=True, text=True, timeout=12)
        matches = list(re.finditer(r"\[\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\]\s*$", response.stdout, re.M))
        yaw = float(matches[-1][3]) if response.returncode == 0 and matches else None
        angle = math.atan2(math.sin(yaw-door["nominal_orientation"]), math.cos(yaw-door["nominal_orientation"])) if yaw is not None else None
        return {"door_id": door["id"], "panel_yaw_rad": yaw, "hinge_angle_rad": angle,
                "state": "UNKNOWN" if angle is None else "CLOSED" if abs(angle) < .05 else "OPEN" if abs(angle) >= 1.45 else "PARTLY_OPEN",
                "source": "read-only Gazebo door panel pose", "observed_at": stamp()}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: return list(pool.map(one, config["doors"]))

def verify_reconnect_transaction(approval_path, node_pid, prepare_pid):
    """Read-only proof that this helper belongs to the still-held prepare job."""
    if not isinstance(prepare_pid, int) or prepare_pid <= 1 or not isinstance(node_pid, int):
        raise RuntimeError("PREPARE_PARENT_REQUIRED")
    node_proc, parent_proc = Path("/proc") / str(node_pid), Path("/proc") / str(prepare_pid)
    # /proc stat's comm field can contain spaces; the ppid is field two after ')'.
    node_ppid = int((node_proc / "stat").read_text().rsplit(")", 1)[1].split()[1])
    parent_args = (parent_proc / "cmdline").read_bytes().split(bytes([0]))
    prepare_script = (R / "scripts/demo-video/prepare-scene.py").resolve()
    parent_is_prepare = any(
        (R / os.fsdecode(arg)).resolve() == prepare_script
        for arg in parent_args[1:] if arg and not arg.startswith(b"-")
    )
    if node_ppid != prepare_pid or parent_proc.stat().st_uid != os.getuid() or (
        parent_proc / "cwd").resolve() != R or not parent_is_prepare or b"--apply" not in parent_args:
        raise RuntimeError("DIRECT_PREPARE_PARENT_REQUIRED")
    lease_path = R / "runtime/motion-control.lock"
    lease = read(lease_path)
    if lease.get("kind") != "demo_scene_prepare" or lease.get("pid") != prepare_pid:
        raise RuntimeError("PREPARE_LEASE_OWNER_REQUIRED")
    stat = lease_path.stat()
    key = (os.major(stat.st_dev), os.minor(stat.st_dev), stat.st_ino)
    actual_owner = False
    for line in Path("/proc/locks").read_text().splitlines():
        fields = line.split()
        if len(fields) < 6 or fields[1:4] != ["FLOCK", "ADVISORY", "WRITE"]:
            continue
        device = fields[5].split(":")
        if len(device) == 3 and (int(device[0], 16), int(device[1], 16), int(device[2])) == key:
            actual_owner = int(fields[4]) == prepare_pid
            if actual_owner: break
    if not actual_owner: raise RuntimeError("LIVE_PREPARE_FLOCK_REQUIRED")
    # Probe the same inode as well: stale textual metadata cannot authorize reconnect.
    with lease_path.open("rb") as probe:
        try: fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: pass
        else:
            fcntl.flock(probe, fcntl.LOCK_UN)
            raise RuntimeError("LIVE_PREPARE_FLOCK_REQUIRED")
    approval_path = inside(approval_path)
    config = current_config()
    validate_approval(read(approval_path), config)
    consumed = read(BASE / "used-scene-approvals" / (digest(approval_path) + ".json"))
    if consumed.get("job_id") != lease.get("job_id"):
        raise RuntimeError("ACTIVE_APPROVAL_TRANSACTION_REQUIRED")
    safety(held_job=lease["job_id"])
    return {"pass": True, "job_id": lease["job_id"], "prepare_pid": prepare_pid,
            "snapshot_sha256": config["snapshot_sha256"]}

def interrupted(signum, _frame):
    raise RuntimeError("PREPARATION_INTERRUPTED:" + signal.Signals(signum).name)

def sdk(check=True, approval=None):
    args = [str(NODE), "--import", "./third_party/agnes-harness/node_modules/tsx/dist/loader.mjs",
            "scripts/demo-video/reconnect-tools.mts", "--check" if check else "--apply"]
    if approval: args += ["--approval", str(approval)]
    result = subprocess.run(args, cwd=R, capture_output=True, text=True, timeout=110)
    if result.returncode: raise RuntimeError("MCP_CHECK_OR_RECONNECT_FAILED:" + result.stderr[-700:])
    return json.loads(result.stdout.splitlines()[-1])

def checked():
    config = current_config()
    before = safety()
    entries, env = owned_stack()
    observers = module("demo_scene_observers", "scripts/demo-ui-final/scene_observers.py")
    observers.restart_observers(check_only=True)
    doors = door_states(config, env)
    if any(d["state"] == "UNKNOWN" for d in doors): raise RuntimeError("DOOR_POSE_UNAVAILABLE")
    native = sdk()
    before = safety()
    return config, {**before, "stack": entries, "doors": doors, "mcp": native}, env, observers

def publish_generation(config, output, job, started):
    """Record verified stack identity, as existing scene-switch does, not action status."""
    ready = read(output / "readiness.json")
    launcher = read(output / "launcher.json")
    entries, env = owned_stack()
    if not ready.get("ready") or not all(ready.get(k) is True for k in ("clock_advancing", "fresh_odom", "tf_ready")):
        raise RuntimeError("NEW_STACK_READINESS_REQUIRED")
    supervisor = next(e for e in entries if e["name"] == "supervisor")
    nav = next(e for e in entries if e["name"] == "nav2")
    if supervisor["ppid"] != launcher["pid"] or nav["ppid"] != supervisor["pid"] or env.get("FINAL_RUN_DIR") != str(output / "runtime"):
        raise RuntimeError("NEW_STACK_GENERATION_MISMATCH")
    if current_config()["snapshot_sha256"] != config["snapshot_sha256"]:
        raise RuntimeError("SCENE_CONFIG_CHANGED")
    proof = {"ready": True, "started_at": started, "verified_at": time.time(),
             "nav_pid": nav["pid"], "nav_start_time": nav["start_time"], "job_id": job,
             "source": "fresh owned Nav2 process + check_stack real lifecycle/TF/clock; no goals issued"}
    save(O / "scene-generation.json", proof)
    save(output / "verified-generation.json", proof)
    return proof

def resume_scene(approval_path, output):
    """Finish this exact approved restart; never repeat the physical reset."""
    output, approval_path = inside(output), inside(approval_path)
    if BASE not in output.parents: raise RuntimeError("OUTPUT_MUST_BE_UNDER_ARTIFACTS_DEMO_VIDEO")
    if (output / "after.json").exists(): raise RuntimeError("SCENE_PREPARATION_ALREADY_COMPLETE")
    config, before = current_config(), read(output / "before.json")
    validate_approval(read(approval_path), config)
    if before["config"]["snapshot_sha256"] != config["snapshot_sha256"]:
        raise RuntimeError("RESUME_CONFIG_MISMATCH")
    consumed = read(BASE / "used-scene-approvals" / (digest(approval_path) + ".json"))
    job = before["job_id"]
    if consumed.get("job_id") != job or consumed.get("output") != str(output):
        raise RuntimeError("EXACT_APPROVED_PREPARATION_REQUIRED")
    failed, launcher = read(output / "failure.json"), read(output / "launcher.json")
    if failed.get("job_id") != job or failed.get("launched_pid") != launcher["pid"]:
        raise RuntimeError("FAILED_NEW_STACK_PREPARATION_REQUIRED")
    initial = safety(fresh_generation=True)
    entries, env = owned_stack()
    pose, start = initial["ros"]["pose"], config["start"]
    yaw_error = abs(math.atan2(math.sin(pose["yaw"]-start["yaw"]), math.cos(pose["yaw"]-start["yaw"])))
    if math.hypot(pose["x"]-start["x"], pose["y"]-start["y"]) > .35 or yaw_error > .15:
        raise RuntimeError("RESUME_REQUIRES_UNMOVED_START")
    if any(d["state"] != "CLOSED" for d in door_states(config, env)):
        raise RuntimeError("RESUME_REQUIRES_RESET_DOORS")
    fd, locked, previous_signals = None, False, {}
    try:
        for sig in (signal.SIGINT, signal.SIGTERM): previous_signals[sig] = signal.signal(sig, interrupted)
        fd = os.open(R / "runtime/motion-control.lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); locked = True
        os.ftruncate(fd, 0)
        os.write(fd, json.dumps({"kind":"demo_scene_prepare","job_id":job,"pid":os.getpid(),
                                "acquired_at":time.time(),"resume":True}).encode()); os.fsync(fd)
        safety(held_job=job, fresh_generation=True)
        validate_approval(read(approval_path), current_config())
        save(output / "resume-before.json", {"at":stamp(),"job_id":job,"current":initial,
             "physical_reset_repeated":False})
        publish_generation(config, output, job, launcher["started_at"])
        result = finish_scene(config, before, launcher["started_at"], job, approval_path, output)
        result["resumed"] = True
        result["physical_reset_repeated"] = False
        save(output / "after.json", result)
        return result
    except Exception as error:
        save(output / "resume-failure.json", {"pass":False,"status":"NEEDS_REVIEW","job_id":job,
             "at":stamp(),"error":str(error),"physical_reset_repeated":False})
        raise
    finally:
        if locked:
            os.ftruncate(fd, 0); fcntl.flock(fd, fcntl.LOCK_UN)
        if fd is not None: os.close(fd)
        for sig, handler in previous_signals.items(): signal.signal(sig, handler)

def finish_scene(config, before, started, job, approval_path, output):
    deadline = time.monotonic() + 30
    while True:
        try:
            safety(held_job=job)
            break
        except RuntimeError as error:
            if str(error) not in {"NAVIGATION_NOT_IDLE", "FRESH_ROS_REQUIRED", "FRESH_ROS_POSE_REQUIRED"} or time.monotonic() >= deadline: raise
            time.sleep(.2)
    refreshed = sdk(check=False, approval=approval_path)
    save(output / "refreshed-tools.json", refreshed)
    after = camera = None
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            after = safety(held_job=job)
            camera = read(R / "artifacts/interactive-live/camera/latest-meta.json")
            pose, start = after["ros"]["pose"], config["start"]
            distance = math.hypot(pose["x"]-start["x"], pose["y"]-start["y"])
            yaw_error = abs(math.atan2(math.sin(pose["yaw"]-start["yaw"]), math.cos(pose["yaw"]-start["yaw"])))
            frame_at = epoch(camera["captured_at"])
            if distance <= .35 and yaw_error <= .15 and camera.get("real_sensor") and started < frame_at <= time.time() and time.time()-frame_at < 2.5:
                break
        except (RuntimeError, OSError, KeyError): pass
        time.sleep(.3)
    else: raise RuntimeError("NEW_START_POSE_OR_CAMERA_NOT_VERIFIED")
    entries, actual_env = owned_stack()
    doors = door_states(config, actual_env)
    if any(d["state"] != "CLOSED" for d in doors): raise RuntimeError("DOORS_NOT_RESET_CLOSED")
    after_config = current_config()
    if after_config["snapshot_sha256"] != config["snapshot_sha256"]:
        raise RuntimeError("SCENE_CONFIG_CHANGED")
    if after["ros"]["map"]["sha256"] != before["ros"]["map"]["sha256"]:
        raise RuntimeError("STATIC_MAP_CHANGED")
    result = {"pass": True, "job_id": job, "status": "READY_AT_START", "prepared_at": stamp(),
              "output": str(output), "seed": config["seed"], "world_name": config["world_name"],
              "config_sha256_before": config["snapshot_sha256"], "config_sha256_after": after_config["snapshot_sha256"],
              "file_hashes_before": config["files"], "file_hashes_after": after_config["files"],
              "pose_before": before["ros"]["pose"], "pose_after": after["ros"]["pose"],
              "doors_before": before["doors"], "doors_after": doors, "camera": camera, "stack": entries,
              "model_calls": 0, "navigation_commands": 0, "zero_stop_commands": 1, "mcp_reconnected": True}
    save(output / "after.json", result)
    return result

def apply_scene(approval_path, output):
    config, before, env, observers = checked()
    approval_path = inside(approval_path)
    approval = read(approval_path)
    validate_approval(approval, config)
    output = inside(output)
    if BASE not in output.parents: raise RuntimeError("OUTPUT_MUST_BE_UNDER_ARTIFACTS_DEMO_VIDEO")
    output.mkdir(parents=True, exist_ok=False)
    job = str(uuid.uuid4())
    previous_signals = {}
    fd = None
    launched = None
    locked = False
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous_signals[sig] = signal.signal(sig, interrupted)
        fd = os.open(R / "runtime/motion-control.lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locked = True
        os.ftruncate(fd, 0)
        os.write(fd, json.dumps({"kind": "demo_scene_prepare", "job_id": job, "pid": os.getpid(), "acquired_at": time.time()}).encode())
        os.fsync(fd)
        safety(held_job=job)
        if current_config()["snapshot_sha256"] != config["snapshot_sha256"]:
            raise RuntimeError("SCENE_CONFIG_CHANGED")
        validate_approval(read(approval_path), config)
        used_dir = BASE / "used-scene-approvals"
        used_dir.mkdir(parents=True, exist_ok=True)
        with (used_dir / (digest(approval_path) + ".json")).open("x") as used:
            json.dump({"job_id": job, "output": str(output), "started_at": stamp()}, used)
        save(output / "before.json", {**before, "config": config, "approval": approval, "job_id": job})
        sdk()
        stopped = subprocess.run(["bash", "scripts/final-rescue/stop-stack.sh"], cwd=R, env=env,
                                 capture_output=True, text=True, timeout=60)
        (output / "stop.log").write_text(stopped.stdout + "\n" + stopped.stderr)
        stopped_rows = [json.loads(line) for line in stopped.stdout.splitlines() if line.startswith("{")]
        if stopped.returncode or not any(row.get("all_stopped") is True for row in stopped_rows):
            raise RuntimeError("OWNED_STACK_STOP_NOT_VERIFIED")
        # New run evidence is separate; the source scenario and seed stay byte-identical.
        run_dir = output / "runtime"
        run_dir.mkdir()
        launch_env = {**env, "FINAL_RUN_DIR": str(run_dir)}
        # The helper already proves exact project-owned observer identities.
        observers.restart_observers()
        started = time.time()
        with (output / "start.log").open("ab") as stream:
            launched = subprocess.Popen(["bash", "scripts/final-rescue/start-stack.sh"], cwd=R,
                env=launch_env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        save(output / "launcher.json", {"pid": launched.pid, "started_at": started})
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if launched.poll() is not None: raise RuntimeError("RESTARTED_STACK_EXITED")
            lines = (output / "start.log").read_text(errors="replace").splitlines()
            ready = next((json.loads(line.split("FINAL_RESCUE_STACK_READY ", 1)[1]) for line in lines if line.startswith("FINAL_RESCUE_STACK_READY ")), None)
            if ready and ready.get("ready"): break
            time.sleep(.5)
        else: raise RuntimeError("RESTARTED_STACK_READY_TIMEOUT")
        save(output / "readiness.json", ready)
        publish_generation(config, output, job, started)
        # A bounded zero Twist is only a stop; never a navigation/turn command.
        zero = subprocess.run([str(R / "tools/pixi/bin/pixi"), "run", "--locked", "--manifest-path",
            "runtime/ros2-jazzy/pixi.toml", "ros2", "topic", "pub", "--once", "/cmd_vel",
            "geometry_msgs/msg/Twist", "{linear: {x: 0.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.0}}"],
            cwd=R, env=launch_env, capture_output=True, text=True, timeout=25)
        (output / "zero-stop.log").write_text(zero.stdout + "\n" + zero.stderr)
        if zero.returncode: raise RuntimeError("ZERO_STOP_FAILED")
        return finish_scene(config, before, started, job, approval_path, output)
    except Exception as error:
        save(output / "failure.json", {"pass": False, "status": "NEEDS_REVIEW", "error": str(error), "at": stamp(), "job_id": job,
              "launched_pid": launched.pid if launched else None,
              "note": "No rollback of physical state is claimed. No navigation was commanded."})
        raise
    finally:
        # A failed lock attempt must never clear another owner's record.
        if locked:
            os.ftruncate(fd, 0)
            fcntl.flock(fd, fcntl.LOCK_UN)
        if fd is not None: os.close(fd)
        for sig, handler in previous_signals.items(): signal.signal(sig, handler)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--approval")
    parser.add_argument("--out")
    parser.add_argument("--resume", help="Finish this exact approved output without another stack restart")
    args = parser.parse_args()
    if Path.cwd().resolve() != R: raise RuntimeError("WORKSPACE_REQUIRED")
    if args.resume and not args.apply: raise RuntimeError("RESUME_REQUIRES_APPLY")
    if args.resume and args.out: raise RuntimeError("RESUME_CANNOT_CHANGE_OUTPUT")
    if not args.apply:
        config, before, _, _ = checked()
        result = {"pass": True, "mode": "read_only_check", "config": config, "current": before,
                  "approval_required": True, "approval_template": {
                    "authorized": False, "action": "reset_same_scene", "seed": config["seed"],
                    "world_name": config["world_name"], "snapshot_sha256": config["snapshot_sha256"],
                    "human_confirmation": "", "approved_at": "", "expires_at": ""}}
    else:
        if not args.approval: raise RuntimeError("EXPLICIT_HUMAN_APPROVAL_REQUIRED")
        output = args.out or str(BASE / ("scene-preparation-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")))
        result = resume_scene(args.approval, args.resume) if args.resume else apply_scene(args.approval, output)
    print(json.dumps(result, ensure_ascii=False))
if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"pass": False, "error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
