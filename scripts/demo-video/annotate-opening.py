#!/usr/bin/env python3
"""Add an explicitly editorial task card during the reviewed full-page opening only."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path("/data-ssd/zhongchengkai/agnes")
BIN=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin"
FONT=ROOT/"artifacts/demo-video-20261013/assets/fonts/NotoSansCJKsc-Regular.otf"
DIMENSIONS=(1438,1080)
PROTECTED={"camera_and_navigation_cards":{"x":400,"y":131,"w":1018,"h":612}}
RECTS=[
 {"id":"conversation_task_card","x":22,"y":296,"w":362,"h":444},
 {"id":"mission_task_card","x":402,"y":750,"w":1014,"h":94},
]
def inside(value,existing=False):
 p=Path(value);p=(ROOT/p).resolve() if not p.is_absolute() else p.resolve()
 if ROOT not in p.parents:raise ValueError("Path must stay inside the authorized project")
 if existing and not p.is_file():raise ValueError("Required file missing: "+str(p))
 return p
def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def write_new(p,value):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("x",encoding="utf-8") as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write("\n")
def media(p,count=False):
 cmd=[str(BIN/"ffprobe"),"-v","error"]
 if count:cmd+=["-count_packets"]
 cmd+=["-show_format","-show_streams","-of","json",str(p)]
 return json.loads(subprocess.check_output(cmd,text=True))
def video(m):return next(s for s in m["streams"] if s["codec_type"]=="video")
def overlap(a,b):return a["x"]<b["x"]+b["w"] and a["x"]+a["w"]>b["x"] and a["y"]<b["y"]+b["h"] and a["y"]+a["h"]>b["y"]
def safe_geometry(rectangles):
 for r in rectangles:
  if any(not isinstance(r[k],int) for k in ("x","y","w","h")) or r["x"]<0 or r["y"]<0 or r["w"]<=0 or r["h"]<=0 or r["x"]+r["w"]>1438 or r["y"]+r["h"]>1080:raise ValueError("Invalid annotation geometry")
  if any(overlap(r,p) for p in PROTECTED.values()):raise ValueError("Annotation would cover camera or navigation map")
def esc(p):return str(p).replace("\\","\\\\").replace(":","\\:").replace("'","\\'").replace(",","\\,").replace("[","\\[").replace("]","\\]")
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 mode=ap.add_mutually_exclusive_group(required=True);mode.add_argument("--prepare",action="store_true");mode.add_argument("--apply",action="store_true");mode.add_argument("--finalize-qa",action="store_true")
 ap.add_argument("--plan",required=True)
 ap.add_argument("--run");ap.add_argument("--recording-id")
 ap.add_argument("--full-page-end",type=float,default=18.0,help="Latest reviewed full-page time in original first recording, at most 18.5s")
 ap.add_argument("--input");ap.add_argument("--edit-manifest");ap.add_argument("--output");ap.add_argument("--annotation-manifest");ap.add_argument("--qa-review")
 args=ap.parse_args()
 if Path.cwd().resolve()!=ROOT:raise ValueError("WORKSPACE_REQUIRED")
 plan_path=inside(args.plan)
 safe_geometry(RECTS)
 if args.finalize_qa:
  if not args.annotation_manifest or not args.qa_review or not args.output:raise ValueError("--annotation-manifest --qa-review --output required")
  annotation_path=inside(args.annotation_manifest,True);annotation=json.loads(annotation_path.read_text())
  out=inside(args.output,True);qa_path=inside(args.qa_review,True);qa=json.loads(qa_path.read_text())
  if annotation.get("status")!="ENCODED_REQUIRES_VISUAL_QA" or annotation.get("output",{}).get("path")!=str(out.relative_to(ROOT)) or annotation["output"].get("sha256")!=digest(out):
   raise ValueError("Annotation manifest must bind this actual output")
  expected=("task_card_legible","clearly_editorial","camera_map_unobscured","connection_footer_retained","layer_absent_after_intro")
  if qa.get("verified") is not True or not qa.get("reviewer") or not qa.get("reviewed_at") or qa.get("video_sha256")!=digest(out) or any(qa.get("checks",{}).get(k) is not True for k in expected):
   raise ValueError("Actual visual QA must verify legibility, editorial nature, unobscured camera/map and the intro boundary")
  prior_info=annotation["prior_edit_manifest"];snapshot=inside(prior_info["snapshot"],True)
  if digest(snapshot)!=prior_info["sha256"]:raise ValueError("Prior silent edit manifest snapshot changed")
  result=copy.deepcopy(json.loads(snapshot.read_text()))
  final_media=media(out);final_video=video(final_media)
  result["generated_at"]=datetime.now(timezone.utc).isoformat()
  result["opening_annotation_lineage"]={"kind":annotation["kind"],"annotation_manifest":{"path":str(annotation_path.relative_to(ROOT)),"sha256":digest(annotation_path)},
    "prior_silent_edit_manifest":prior_info,"prepared_plan":annotation["prepared_plan"],
    "visual_qa":{"path":str(qa_path.relative_to(ROOT)),"sha256":digest(qa_path),"reviewer":qa["reviewer"],"reviewed_at":qa["reviewed_at"]},
    "output_time":annotation["annotation_output_time"],"rectangles":annotation["rectangles"],"disclosure":annotation["disclosure"]}
  result.setdefault("processing",{})["opening_task_explanation_layer"]=True
  result["output"]={**annotation["output"],"streams":[{"type":s["codec_type"],"codec":s["codec_name"]} for s in final_media["streams"]]}
  write_new(out.with_suffix(".edit-manifest.json"),result)
  print(json.dumps({"edit_manifest":str(out.with_suffix(".edit-manifest.json")),"video_sha256":result["output"]["sha256"],"qa_verified":True},ensure_ascii=False));return
 if args.prepare:
  if not args.run or not args.recording_id:raise ValueError("--run and --recording-id required")
  if not 0<args.full_page_end<=18.5:raise ValueError("Opening annotation must stop before the reviewed full→dual transition")
  run=inside("artifacts/demo-video-20261013/runs/"+args.run)
  prompts=inside(run/"prompts.jsonl",True)
  initial=[json.loads(line) for line in prompts.read_text().splitlines() if line.strip()]
  initial=[e for e in initial if e.get("kind")=="initial"]
  if len(initial)!=1 or initial[0].get("text")!="请找到待救援人员。":raise ValueError("Actual initial task provenance mismatch")
  recording=inside("artifacts/demo-video-20261013/recordings/"+args.recording_id)
  metadata=inside(recording/"metadata.json",True);m=json.loads(metadata.read_text())
  source=inside(recording/"source.webm",True)
  if m.get("id")!=args.recording_id or m.get("status")!="COMPLETE" or m.get("source")!="user_selected_browser_display_capture":raise ValueError("First raw source must be a completed actual browser recording")
  source_hash=digest(source)
  if source_hash!=m.get("sha256"):raise ValueError("Original raw recording hash mismatch")
  v=video(media(source))
  if (v["width"],v["height"])!=DIMENSIONS:raise ValueError("Expected original 1438×1080 capture")
  qa=inside("artifacts/demo-video-20261013/qa/"+args.recording_id+"/live-opening-review/opening-visual-qa.json",True)
  plan={"version":1,"kind":"POST_PRODUCTION_TASK_EXPLANATION_LAYER","created_at":datetime.now(timezone.utc).isoformat(),
   "run_id":args.run,"actual_initial_prompt":initial[0],"prompt_log":{"path":str(prompts.relative_to(ROOT)),"sha256":digest(prompts)},
   "first_raw_source":{"path":str(source.relative_to(ROOT)),"sha256":source_hash,"recording_id":args.recording_id},
   "recording_metadata":{"path":str(metadata.relative_to(ROOT)),"sha256":digest(metadata)},
   "visual_qa":{"path":str(qa.relative_to(ROOT)),"sha256":digest(qa)},
   "font":{"path":str(FONT.relative_to(ROOT)),"sha256":digest(inside(FONT,True))},
   "font_license":{"path":"artifacts/demo-video-20261013/assets/fonts/OFL-1.1.txt","sha256":digest(inside("artifacts/demo-video-20261013/assets/fonts/OFL-1.1.txt",True))},
   "font_source_manifest":{"path":"artifacts/demo-video-20261013/assets/fonts/source-manifest.json","sha256":digest(inside("artifacts/demo-video-20261013/assets/fonts/source-manifest.json",True))},
   "dimensions":list(DIMENSIONS),"original_full_page_time":{"start":0,"end":args.full_page_end},
   "rectangles":RECTS,"protected_geometry":PROTECTED,
   "rendered_text":{"title":"任务目标","goal":initial[0]["text"],"provenance_label":"来自本次原始任务记录","editorial_label":"视频任务说明"},
   "disclosure":"Opening native conversation content and mission guidance text are covered by an explicitly editorial task-description card. No native user bubble, Agnes answer, status or execution outcome is synthesized. Raw recordings and all background instructions remain preserved; narrated route disclosure remains.",
   "source_modified":False,"ui_modified":False,"encoding_performed":False}
  write_new(plan_path,plan);print(json.dumps({"plan":str(plan_path),"rectangles":RECTS,"source_full_page_end":args.full_page_end,"encoding":False},ensure_ascii=False));return
 if not all([args.input,args.edit_manifest,args.output]):raise ValueError("--input --edit-manifest --output required for --apply")
 plan=json.loads(inside(plan_path,True).read_text());safe_geometry(plan["rectangles"])
 if plan.get("kind")!="POST_PRODUCTION_TASK_EXPLANATION_LAYER" or plan.get("dimensions")!=list(DIMENSIONS):raise ValueError("Invalid prepared annotation plan")
 for key in ("prompt_log","recording_metadata","visual_qa","font","font_license","font_source_manifest","first_raw_source"):
  entry=plan[key]
  if digest(inside(entry["path"],True))!=entry["sha256"]:raise ValueError("Prepared provenance changed: "+key)
 inp=inside(args.input,True);edit_path=inside(args.edit_manifest,True);out=inside(args.output)
 if out.suffix!=".mp4" or out.exists() or out==inp:raise ValueError("Use a new MP4 output; never overwrite an input or prior output")
 original_edit=json.loads(edit_path.read_text())
 if original_edit.get("output",{}).get("sha256")!=digest(inp):raise ValueError("Prior silent edit manifest does not bind actual input hash")
 segments=original_edit.get("segments",[])
 if not segments:raise ValueError("Prior edit has no reviewed opening segment")
 opening=segments[0]
 raw=plan["first_raw_source"]["path"]
 sources=original_edit.get("sources",{})
 opening_source=sources.get(opening.get("source_id"),{}).get("source",original_edit.get("source"))
 if opening_source!=raw or opening.get("kind")!="overview" or opening.get("speed")!=1:raise ValueError("Task layer is limited to the original first full-page overview at 1×")
 source_start=float(opening.get("start",opening.get("source_start")));source_end=float(opening.get("end",opening.get("source_end")))
 full_end=float(plan["original_full_page_time"]["end"])
 # The edit must cut away any unreviewed opening tail before layout changes.
 if source_start<0 or source_end>full_end+.001:raise ValueError("Opening segment extends beyond reviewed full-page annotation boundary; shorten it in the editor first")
 start=float(opening["output_start"]);end=float(opening["output_end"])
 if start!=0 or not 0<end<=full_end+.001:raise ValueError("Annotation must be confined to the actual first overview segment")
 before=media(inp,True);v=video(before)
 if (v["width"],v["height"])!=DIMENSIONS:raise ValueError("Input must remain native 1438×1080; do not add 16:9 padding")
 work=out.parent/(out.stem+".annotation-work")
 if work.exists():raise ValueError("Use a new output name; work directory exists")
 work.mkdir(parents=True)
 prior=work/"prior-silent-edit-manifest.json";shutil.copyfile(edit_path,prior)
 title=work/"title.txt";goal=work/"goal.txt";label=work/"provenance-label.txt";editorial=work/"editorial-label.txt"
 for p,text in [(title,"任务目标"),(goal,plan["actual_initial_prompt"]["text"]),(label,"来自本次原始任务记录"),(editorial,"视频任务说明")]:
  with p.open("x",encoding="utf-8") as f:f.write(text)
 enabled=f"gte(t,{start:.6f})*lt(t,{end:.6f})"
 filters=[]
 for r in plan["rectangles"]:
  g=f"x={r['x']}:y={r['y']}:w={r['w']}:h={r['h']}"
  filters.extend([f"drawbox={g}:color=0xf5f8fc:t=fill:enable='{enabled}'",f"drawbox={g}:color=0xbac9de:t=2:enable='{enabled}'"])
 for p,x,y,size,color in [(title,50,330,24,"0x224666"),(goal,50,393,26,"0x152d44"),(label,50,473,16,"0x526a81"),(editorial,50,506,15,"0x526a81"),
                           (title,430,765,20,"0x224666"),(goal,560,765,24,"0x152d44"),(label,430,808,16,"0x526a81")]:
  filters.append(f"drawtext=fontfile='{esc(FONT)}':textfile='{esc(p)}':x={x}:y={y}:fontsize={size}:fontcolor={color}:enable='{enabled}'")
 command=[str(BIN/"ffmpeg"),"-nostdin","-hide_banner","-loglevel","warning","-n","-i",str(inp),"-map","0:v:0","-map","0:a?","-map","0:s?",
  "-vf",",".join(filters),"-c:v","libx264","-crf","20","-preset","fast","-threads","4","-pix_fmt","yuv420p","-c:a","copy","-c:s","copy",
  "-map_metadata","0","-metadata","comment=Editorial opening task-description layer; original raw AGH dialogue and prescribed route preserved in audit records; no synthesized native reply or result.",
  "-movflags","+faststart",str(out)]
 pending={"version":1,"kind":plan["kind"],"prepared_plan":{"path":str(plan_path.relative_to(ROOT)),"sha256":digest(plan_path)},
  "input":{"path":str(inp.relative_to(ROOT)),"sha256":digest(inp)},
  "prior_edit_manifest":{"path":str(edit_path.relative_to(ROOT)),"sha256":digest(edit_path),"snapshot":str(prior.relative_to(ROOT))},
  "annotation_output_time":{"start":start,"end":end},"rectangles":plan["rectangles"],"protected_geometry":PROTECTED,"disclosure":plan["disclosure"],
  "processing":{"width":1438,"height":1080,"scaling":False,"padding":False,"frame_interpolation":False,"native_dialogue_synthesized":False,"new_execution_result_synthesized":False},
  "ffmpeg_argv":command,"raw_source_modified":False,"ui_modified":False,"status":"ENCODING"}
 write_new(work/"annotation-packet-before.json",pending)
 subprocess.run(command,check=True)
 after=media(out,True);av=video(after)
 if (av["width"],av["height"])!=DIMENSIONS or av.get("nb_read_packets")!=v.get("nb_read_packets") or abs(float(after["format"]["duration"])-float(before["format"]["duration"]))>.075:raise ValueError("Annotated output changed dimensions, packet count or duration")
 report={**pending,"status":"ENCODED_REQUIRES_VISUAL_QA","completed_at":datetime.now(timezone.utc).isoformat(),
  "actual_initial_prompt":plan["actual_initial_prompt"],"output":{"path":str(out.relative_to(ROOT)),"sha256":digest(out),"duration":float(after["format"]["duration"]),"width":av["width"],"height":av["height"],"video_packet_count":av.get("nb_read_packets")},
  "before_video_packet_count":v.get("nb_read_packets"),"visual_qa_required":["task card legible and clearly editorial","camera/map cards unobscured","native connection footer retained","layer absent immediately after opening end"]}
 write_new(out.with_suffix(".annotation-manifest.json"),report)
 print(json.dumps(report["output"],ensure_ascii=False))
if __name__=="__main__":
 try:main()
 except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as e:print("Opening annotation refused: "+str(e),file=sys.stderr);sys.exit(1)
