#!/usr/bin/env python3
"""Isolated two-source codec and rejection checks; all fixtures are synthetic."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/"artifacts/demo-video-20261013/edit-validation"
OUT=BASE/("multi-source-"+uuid.uuid4().hex)
OUT.mkdir()
BIN=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin"
EDITOR=ROOT/"scripts/demo-video/edit-video.py"
A=BASE/"TECHNICAL_TEST_ONLY.webm"
B=OUT/"TECHNICAL_TEST_ONLY_SECOND.webm"
subprocess.run([str(BIN/"ffmpeg"),"-v","error","-f","lavfi","-i","color=c=green:size=320x180:rate=15","-f","lavfi","-i","sine=frequency=550:sample_rate=48000","-t","4","-c:v","libvpx","-c:a","libopus","-shortest","-n",str(B)],check=True)
def relative(p): return str(p.relative_to(ROOT))
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
notes=OUT/"TECHNICAL_SOURCE_NOTES.json"
notes.write_text(json.dumps({"kind":"TECHNICAL_TEST_ONLY","note":"Synthetic footage; no robot/model/action recording or success claim."}))
review={"verified":True,"reviewer":"isolated-codec-test","reviewed_at":"2026-10-13T00:00:00Z","notes":"Synthetic technical fixture only; never deliver as robot footage."}
timeline={"version":1,"source_kind":"synthetic-validation","review":review,"target_duration":5,"tolerance_seconds":0.1,
 "sources":{"a":{"path":relative(A),"sha256":digest(A)},"b":{"path":relative(B),"sha256":digest(B)}},"source_order":["a","b"],
 "ending":{"result":"observation_only","evidence":[]},"omitted_tail_reason":"Technical fixture tail excluded; no real event.",
 "segments":[
 {"id":"a1","source_id":"a","start":0,"end":2,"speed":1,"kind":"overview","caption":"技术测试 · 第一来源","evidence":[relative(notes)]},
 {"id":"a2","source_id":"a","start":2,"end":4,"speed":2,"kind":"action","speed_reason":"Synthetic speed-filter validation only","caption":"技术测试 · 倍速处理","evidence":[relative(notes)]},
 {"id":"b1","source_id":"b","start":0,"end":2,"speed":1,"kind":"action","caption":"技术测试 · 第二来源","evidence":[relative(notes)],
 "source_transition_reason":"Technical test concatenation of two distinct synthetic sources; no real action.",
 "source_transition_evidence":[relative(notes)]}]}
tests=[]
def invoke(data,name,ok,encode=False):
 p=OUT/(name+".json");p.write_text(json.dumps(data,ensure_ascii=False,indent=2))
 cmd=[sys.executable,"-B",str(EDITOR),"--timeline",relative(p),"--output",relative(OUT/(name+".mp4")),"--technical-validation","--width","320","--height","180","--fps","15","--preset","veryfast"]
 if not encode:cmd.append("--check")
 result=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True)
 (OUT/(name+".log")).write_text(result.stdout+"\n"+result.stderr)
 assert (result.returncode==0)==ok,(name,result.returncode,result.stderr)
 tests.append({"name":name,"status":"PASS"})
 return result
invoke(timeline,"two-source-encode",True,True)
manifest=json.loads((OUT/"two-source-encode.edit-manifest.json").read_text())
assert manifest["source_order"]==["a","b"] and len(manifest["sources"])==2
assert manifest["segments"][2]["source_id"]=="b"
assert manifest["source_transitions"][0]["evidence_files"][0]["sha256"]==digest(notes)
assert manifest["technical_validation_only"] is True
assert abs(manifest["output"]["duration"]-5)<0.2
subprocess.run([str(BIN/"ffmpeg"),"-v","error","-i",str(OUT/"two-source-encode.mp4"),"-f","null","-"],check=True)
tests.append({"name":"decode-and-multi-source-manifest","status":"PASS"})
# Compatibility with the established single-source validation timeline.
invoke(json.loads((BASE/"validation.timeline.json").read_text()),"legacy-single-source",True)
for name,mutate in [
 ("reject-missing-source-id",lambda d:d["segments"][0].pop("source_id")),
 ("reject-return-to-earlier-source",lambda d:d["segments"].append(copy.deepcopy(d["segments"][0]))),
 ("reject-overlap-in-source",lambda d:d["segments"][1].update(start=1)),
 ("reject-missing-transition-reason",lambda d:d["segments"][2].pop("source_transition_reason")),
 ("reject-missing-transition-evidence",lambda d:d["segments"][2].pop("source_transition_evidence")),
 ("reject-unreviewed-source",lambda d:d["sources"]["b"].update(review={"verified":False})),
 ("reject-wrong-source-sha",lambda d:d["sources"]["b"].update(sha256="bad")),
 ("reject-duplicate-source-file",lambda d:d["sources"].update(b=copy.deepcopy(d["sources"]["a"]))),
 ("reject-final-tail-without-reason",lambda d:d.pop("omitted_tail_reason")),
 ("reject-unknown-source-order",lambda d:d.update(source_order=["b","unknown"])),
]:
 data=copy.deepcopy(timeline);mutate(data);invoke(data,name,False)
report={"kind":"TECHNICAL_TEST_ONLY_MULTI_SOURCE_EDIT_VALIDATION","pass":True,"directory":relative(OUT),"tests":tests}
(OUT/"report.json").write_text(json.dumps(report,indent=2))
print(json.dumps(report))
