"""Same-user, operation-bound stop requests for the existing motion owner.

The mailbox can only ask the owning bridge to stop. It never publishes Twist,
changes a lease, starts a goal, or exposes arbitrary bridge methods.
"""
import json
import math
import os
from pathlib import Path
import re
import stat
import time

ROOT = Path("/data-ssd/zhongchengkai/agnes/runtime/motion-stop")
TOKEN = re.compile(r"[A-Za-z0-9_-]{1,120}")
class StopMailbox:
    def __init__(self, node, root=ROOT):
        self.node = node
        self.root = Path(root)
        self.handled = []

    def poll(self):
        owner = self.node._motion_owner_snapshot()
        if not owner or not TOKEN.fullmatch(str(owner.get("operation_id", ""))): return
        request_path = self.root / "requests" / (owner["operation_id"] + ".json")
        if not request_path.parent.exists(): return
        # Reject writable/shared or redirected mailboxes before opening input.
        for directory in (self.root, request_path.parent):
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                return
        try:
            fd = os.open(request_path, os.O_RDONLY | os.O_NOFOLLOW)
        except (FileNotFoundError, OSError): return
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 4096:
                return
            request = json.loads(os.read(fd, 4096))
        except (OSError, ValueError): return
        finally: os.close(fd)
        if not isinstance(request, dict): return
        key = request.get("request_id")
        now = time.time()
        if not isinstance(key, str) or not TOKEN.fullmatch(key) or key in self.handled: return
        if request.get("action") != "stop" or request.get("schema_version") != 1: return
        if request.get("operation_id") != owner["operation_id"] or request.get("pid") != os.getpid(): return
        if request.get("bridge_instance_id") != self.node.bridge_instance_id: return
        if not isinstance(request.get("run_id"), str) or not TOKEN.fullmatch(request["run_id"]): return
        issued, expires = request.get("issued_at"), request.get("expires_at")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (issued, expires)): return
        if not 0 <= now-issued <= 15 or not now < expires <= issued+15: return
        result = self.node.stop_owned_operation(owner["operation_id"])
        response = {"schema_version":1, "request_id":key, "run_id":request["run_id"],
                    "operation_id":owner["operation_id"], "bridge_instance_id":self.node.bridge_instance_id,
                    "pid":os.getpid(), "handled_at":time.time(), "source":"actual_motion_owner_stop",
                    "result":result}
        directory = self.root / "results"
        directory.mkdir(mode=0o700, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            return
        temporary = directory / (key + ".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try: os.write(fd, json.dumps(response).encode())
        finally: os.close(fd)
        temporary.replace(directory / (key + ".json"))
        if result.get("reason") != "OWNER_NOT_READY":
            self.handled = (self.handled + [key])[-128:]
