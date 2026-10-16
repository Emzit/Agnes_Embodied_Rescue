import sys
from pathlib import Path
from types import SimpleNamespace as N
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"ros2_bridge"))
from perception import Perception, PerceptionError

def frame(sec=1,nanosec=2,data=b"abc",frame_id="camera"):
 return N(header=N(stamp=N(sec=sec,nanosec=nanosec),frame_id=frame_id),width=1,height=1,encoding="rgb8",step=3,data=data)

p=Perception(); calls=[]
def request(method,png):
 calls.append(method)
 return {"detections":[{"label":"door","confidence":0.6,"bbox":[0,0,1,1]}] if method=="detect_door" else [],"tool_calls":0}
p.request=request
msg=frame()
assert p.detect(msg)==[]
d=p.detect(msg,focus="door")
assert len(d)==1 and d[0]["evidence"]["inspection_focus"]=="door"
assert p.detect(msg,focus="door")==d
assert p.detect(msg)==[]
assert calls==["detect","detect_door"], calls
assert len(d[0]["evidence"]["frame_sha256"])==64
# The cache is isolated from downstream detection mutation.
d[0]["label"]="person"
assert p.detect(msg,focus="door")[0]["label"]=="door"
# A new frame stamp, changed pixels or camera frame must never borrow old evidence.
new=p.detect(frame(nanosec=3),focus="door")
changed=p.detect(frame(data=b"def"),focus="door")
camera=p.detect(frame(frame_id="camera2"),focus="door")
assert len(calls)==5
assert new[0]["timestamp"]["nanosec"]==3
assert changed[0]["evidence"]["frame_sha256"]!=new[0]["evidence"]["frame_sha256"]
assert changed[0]["id"]!=p.detect(msg,focus="door")[0]["id"]
assert camera[0]["frame_id"]=="camera2"
for i in range(12):p.detect(frame(sec=20+i),focus="door")
assert len(p.cache)==8
count=len(calls);p.detect(msg,focus="door")
assert len(calls)==count+1

# Quick malformed/empty model output gets one retry; structural, permission and
# timeout failures return immediately rather than doubling the long wait.
for stage,retries in [("NO_VALID_DETECTIONS_JSON",2),("EMPTY_ASSISTANT_OUTPUT",2),
 ("RESPONSE_TIMEOUT",1),("IMAGE_PROMPT",1),("CONNECT",1),("TOOL_CALL_FORBIDDEN",1)]:
 q=Perception();attempts=[]
 def failing(method,png,**options):
  attempts.append((method,png,options))
  if len(attempts)==1:raise PerceptionError(stage)
  return {"detections":[],"tool_calls":0}
 q.request=failing
 try:q.detect(frame())
 except PerceptionError as error:assert error.stage==stage and retries==1
 else:assert retries==2
 assert len(attempts)==retries,(stage,attempts)
 if retries==2:
  assert attempts[1][0]==attempts[0][0]
  assert attempts[1][1]==attempts[0][1], "retry must use identical sensor pixels"
  assert attempts[1][2]["repair_invalid_schema"] is True
  assert 1000<=attempts[1][2]["timeout_ms"]<=45000, attempts
print("exact-frame focus cache, pixel/stamp/frame invalidation, bounded storage and selective retry passed")
