"""Offline tests of stop-only mailbox authentication and replay behavior."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace as N
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"ros2_bridge"))
from motion_stop import StopMailbox
R=Path("/data-ssd/zhongchengkai/agnes")
class MailboxTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=R/".tmp")
        self.root=Path(self.temp.name)
        (self.root/"requests").mkdir(mode=0o700)
        self.calls=[]
        self.node=N(bridge_instance_id="bridge-unit",_motion_owner_snapshot=lambda:{"operation_id":"inspect-unit"},
            stop_owned_operation=lambda ident:(self.calls.append(ident) or {"status":"PENDING","cancel_status":"ACCEPTED_PENDING"}))
        self.mailbox=StopMailbox(self.node,self.root)
        now=time.time()
        self.request={"schema_version":1,"action":"stop","request_id":"request-unit","run_id":"run-unit",
                      "operation_id":"inspect-unit","pid":os.getpid(),"bridge_instance_id":"bridge-unit",
                      "issued_at":now,"expires_at":now+10}
    def tearDown(self):self.temp.cleanup()
    def write(self,changes=None,mode=0o600):
        p=self.root/"requests/inspect-unit.json"
        p.write_text(json.dumps({**self.request,**(changes or {})}))
        p.chmod(mode)
    def test_exact_owner_stop_once_with_actual_owner_ack(self):
        self.write();self.mailbox.poll();self.mailbox.poll()
        self.assertEqual(self.calls,["inspect-unit"])
        ack=json.loads((self.root/"results/request-unit.json").read_text())
        self.assertEqual(ack["source"],"actual_motion_owner_stop")
        self.assertEqual(ack["result"]["cancel_status"],"ACCEPTED_PENDING")
    def test_wrong_owner_expired_and_non_stop_requests_are_ignored(self):
        for changes in ({"operation_id":"other"},{"pid":999999},{"bridge_instance_id":"other"},
                        {"expires_at":time.time()-1},{"issued_at":time.time()+10},
                        {"expires_at":time.time()+1000},{"action":"navigate"},
                        {"request_id":"../outside"},{"run_id":"../outside"}):
            self.write(changes);self.mailbox.poll()
        self.assertEqual(self.calls,[])
    def test_shared_file_or_directory_is_rejected(self):
        self.write(mode=0o644);self.mailbox.poll()
        self.write();(self.root/"requests").chmod(0o755);self.mailbox.poll()
        self.assertEqual(self.calls,[])
    def test_symlink_request_cannot_redirect_reader(self):
        target=self.root/"other.json";target.write_text(json.dumps(self.request));target.chmod(0o600)
        (self.root/"requests/inspect-unit.json").symlink_to(target)
        self.mailbox.poll();self.assertEqual(self.calls,[])
if __name__=="__main__":unittest.main()
