"""Short-lived Gazebo transport for authorized door animations.

No pose writes. Every command controls the existing real joint velocity.
EOF, SIGTERM and stale input all attempt zero on both articulated joints.
"""
import json, math, signal, sys, threading, time
from gz.transport13 import Node
from gz.msgs10.double_pb2 import Double
from gz.msgs10.model_pb2 import Model

def main():
    ident = sys.argv[1]
    if not ident or any(c in ident for c in "\r\n/"):
        raise ValueError("INVALID_DOOR_ID")
    node = Node()
    publishers = {joint: node.advertise(f"/model/door_{ident}/joint/{ident}_{joint}/cmd_vel", Double)
                  for joint in ("hinge", "handle")}
    output_lock = threading.Lock()
    stopped = threading.Event()
    last_command = time.monotonic()
    def emit(value):
        with output_lock:
            print(json.dumps(value), flush=True)
    def zero():
        errors = []
        for joint, pub in publishers.items():
            try:
                if not pub.publish(Double(data=0.0)):errors.append(joint)
            except Exception:errors.append(joint)
        return errors
    def state(message):
        joints = {j.name.split("::")[-1]: j for j in message.joint}
        hinge, handle = joints.get(ident + "_hinge"), joints.get(ident + "_handle")
        if hinge is None or handle is None:return
        values = [hinge.axis1.position, handle.axis1.position, hinge.axis1.velocity, handle.axis1.velocity]
        if not all(math.isfinite(v) for v in values):return
        emit({"event": "sample", "hinge_angle": values[0], "handle_angle": values[1],
              "hinge_velocity": values[2], "handle_velocity": values[3],
              "sim_time": message.header.stamp.sec + message.header.stamp.nsec / 1e9})
    node.subscribe(Model, f"/model/door_{ident}/joint_state", state)
    def watchdog():
        while not stopped.wait(.15):
            if time.monotonic() - last_command > .65:zero()
    threading.Thread(target=watchdog, daemon=True).start()
    def interrupted(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        emit({"event": "ready"})
        for line in sys.stdin:
            request = json.loads(line)
            joint, velocity = request.get("joint"), float(request.get("velocity", 0))
            if joint not in publishers or not math.isfinite(velocity) or abs(velocity) > (1 if joint == "hinge" else 1.4):
                emit({"id": request.get("id"), "code": 1, "error": "INVALID_JOINT_COMMAND"});continue
            if joint == "hinge" and velocity < 0:
                emit({"id": request.get("id"), "code": 1, "error": "DOOR_CLOSE_NOT_SUPPORTED"});continue
            last_command = time.monotonic()
            ok = bool(publishers[joint].publish(Double(data=velocity)))
            emit({"id": request.get("id"), "published": ok, "code": 0 if ok else 1})
    finally:
        stopped.set()
        zero()
        time.sleep(.05)

if __name__ == "__main__":
    main()
