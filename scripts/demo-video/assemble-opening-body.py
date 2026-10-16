#!/usr/bin/env python3
"""Join a later real UI opener take to the reviewed earlier body, with explicit separate-take provenance."""
import argparse, copy, hashlib, json, math, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BIN=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin"
BODY="artifacts/demo-video-20261013/final/demo-body-clean-subtitles-v3.mp4"
BODY_SHA="4c34fb62fe6637be7bd433ab9ff8cf2adc8333ff58afbf9758bc97a42a15155f"
GOAL="请找到待救援人员。"
DURATION=18.0
UUID=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
def inside(v, exists=False):
 p=Path(v);p=(ROOT/p).resolve() if not p.is_absolute() else p.resolve()
 if ROOT not in p.parents:raise ValueError("Path must stay inside the project workspace")
 if exists and not p.is_file():raise ValueError("Missing input: "+str(p))
 return p
def rel(p):return str(p.relative_to(ROOT))
def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def load(p):return json.loads(p.read_text(encoding="utf-8"))
def bind(p):return {"path":rel(p),"sha256":digest(p)}
def lines(p):return [json.loads(s) for s in p.read_text().splitlines() if s.strip()]
def epoch(v):return datetime.fromisoformat(v.replace("Z","+00:00")).timestamp()
def probe(p):
 return json.loads(subprocess.check_output([str(BIN/"ffprobe"),"-v","error","-show_format","-show_streams","-of","json",str(p)],text=True))
def video(pr):
 vs=[s for s in pr["streams"] if s["codec_type"]=="video"]
 if len(vs)!=1:raise ValueError("Exactly one video stream is required")
 return vs[0]
def media_seconds(pr):
 v=video(pr);value=v.get("duration") or pr["format"].get("duration")
 if not value or value=="N/A":raise ValueError("A finite encoded-video duration is required")
 d=float(value)
 if not math.isfinite(d) or d<=0:raise ValueError("Invalid encoded duration")
 return d
def verify_bound_files(obj):
 for item in obj:
  if not isinstance(item,dict) or not item.get("path") or not item.get("sha256"):raise ValueError("Unbound evidence")
  if digest(inside(item["path"],True))!=item["sha256"]:raise ValueError("Evidence changed: "+item["path"])
def text(e):
 return "\n".join(b["text"] for b in e.get("data",{}).get("content",[]) if b.get("type")=="text")
def shift_srt(raw,offset):
 pattern=re.compile(r"(?m)^(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})([^\n]*)$")
 def parse(t):
  a,b,c=t.split(":");s,ms=c.split(",");return int(a)*3600000+int(b)*60000+int(s)*1000+int(ms)
 def fmt(v):
  h,v=divmod(v,3600000);m,v=divmod(v,60000);s,ms=divmod(v,1000)
  return f"{h:02}:{m:02}:{s:02},{ms:03}"
 count=0
 def replace(m):
  nonlocal count
  count+=1
  return fmt(parse(m[1])+int(offset*1000))+" --> "+fmt(parse(m[2])+int(offset*1000))+m[3]
 out=pattern.sub(replace,raw)
 if count<1:raise ValueError("Body SRT has no valid cue timestamps")
 return out,count
def selected_idle_audit(ros_path,cuts,capture_start):
 rows=lines(ros_path); summaries=[]
 for cut in cuts:
  a,b=capture_start+cut["start"],capture_start+cut["end"]
  near=[r for r in rows if isinstance(r.get("state",{}).get("updated_at"),(int,float)) and a-.75<=r["state"]["updated_at"]<=b+.75]
  near.sort(key=lambda r:r["state"]["updated_at"])
  times=[r["state"]["updated_at"] for r in near]
  if len(near)<2 or times[0]>a+.75 or times[-1]<b-.75 or max((y-x for x,y in zip(times,times[1:])),default=0)>1.5:raise ValueError("Insufficient fresh ROS coverage for cut "+cut["id"])
  for row in near:
   r=row["state"];v=r.get("velocity",{});n=r.get("navigation",{})
   age=epoch(row["observed_at"])-r["updated_at"]
   if not -2<=age<=5 or n.get("status")!="IDLE" or n.get("motion_lease",{}).get("held") is not False or n.get("active_goals",[]) or any(not isinstance(v.get(k),(int,float)) or abs(v[k])>=.001 for k in ["linear_x","linear_y","angular_z"]):raise ValueError("Selected cut contains unverified or actual motion: "+cut["id"])
  summaries.append({"id":cut["id"],"raw_start":cut["start"],"raw_end":cut["end"],"wall_start_epoch":a,"wall_end_epoch":b,"ros_samples":len(near),"first_ros_epoch":times[0],"last_ros_epoch":times[-1],"maximum_gap_seconds":max((y-x for x,y in zip(times,times[1:])),default=0),"velocity_zero":True,"navigation_idle":True,"motion_lease_free":True})
 return {"source":bind(ros_path),"selected_cuts":summaries,"basis":"Actual fresh project ROS observer samples covering only the retained intervals; no change to the collector's later failure."}
def native_result(e):
 d=e.get("data",{})
 if isinstance(d.get("structured"),dict):return d["structured"]
 for b in d.get("content",[]):
  if b.get("type")=="text":
   try:
    v=json.loads(b["text"])
    if isinstance(v,dict):return v
   except (ValueError,KeyError):pass
 return {}
def run(cmd,log):
 with log.open("a",encoding="utf-8") as out:
  out.write(json.dumps([str(c) for c in cmd],ensure_ascii=False)+"\n");out.flush()
  subprocess.run([str(c) for c in cmd],check=True,stdout=out,stderr=out)
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument("--recording-id")
 ap.add_argument("--opening-sha256")
 ap.add_argument("--opener-take",help="Project-relative actual native-opener directory")
 ap.add_argument("--start",type=float,default=0.0,help="Reviewed opener raw start; exactly 18 seconds retained")
 ap.add_argument("--review",help="Actual opening visual QA JSON; required for encode")
 ap.add_argument("--cuts",help="Reviewed real source intervals: input/send, optionally dual; exactly 18 seconds total at 1x")
 ap.add_argument("--body",default=BODY)
 ap.add_argument("--output",default="artifacts/demo-video-20261013/final/demo-real-opening-silent-v4.mp4")
 ap.add_argument("--check",action="store_true",help="Read-only validation; no encode or output files")
 args=ap.parse_args()
 body=inside(args.body,True);bm=inside(body.with_suffix(".edit-manifest.json"),True)
 prior=load(bm);bsha=digest(body)
 if bsha!=BODY_SHA or prior.get("output",{}).get("sha256")!=bsha:raise ValueError("Exact reviewed v3 body SHA256 is required")
 if prior.get("review",{}).get("verified") is not True or prior.get("technical_validation_only") is not False:raise ValueError("Actual reviewed body is required")
 bp=probe(body);bv=video(bp);bd=media_seconds(bp)
 if bv.get("codec_name")!="h264" or (bv.get("width"),bv.get("height"),bv.get("pix_fmt"),bv.get("avg_frame_rate"))!=(1438,1080,"yuv420p","30/1"):raise ValueError("Expected 1438x1080/30fps H264 body")
 if any(s["codec_type"]=="audio" for s in bp["streams"]):raise ValueError("Use the reviewed silent body")
 if abs(bd-282.766667)>.04:raise ValueError("Reviewed body duration changed")
 if prior.get("processing",{}).get("chronological") is not True:raise ValueError("Original body chronology proof is required")
 srt=inside(body.with_suffix(".zh-CN.srt"),True);shifted,cues=shift_srt(srt.read_text(),DURATION)
 shifted_sha=hashlib.sha256(shifted.encode()).hexdigest()
 output=inside(args.output)
 if output.suffix!=".mp4" or output==body:raise ValueError("Choose a new MP4 output")
 if args.check and not args.recording_id:
  print(json.dumps({"ok":True,"status":"PENDING_ACTUAL_OPENER_INPUTS","body":bind(body),"body_manifest":bind(bm),"body_duration":bd,"opening_seconds":DURATION,"expected_output_seconds":bd+DURATION,"output":rel(output),"body_reencoded":False,"subtitle_cues_shifted_seconds":DURATION,"subtitle_cues":cues,"captureChronology":False,"bodyCaptureChronology":True,"needed":["--recording-id <actual COMPLETE UUID>","--opening-sha256 <actual source.webm hash>","--opener-take <actual native-opener directory>","--start <reviewed continuous raw start> or --cuts <reviewed input/send cut JSON>","--review <actual visual QA JSON>"]},ensure_ascii=False));return
 if not args.recording_id or not UUID.fullmatch(args.recording_id):raise ValueError("Actual recording UUID is required")
 if not args.opening_sha256 or not re.fullmatch(r"[a-f0-9]{64}",args.opening_sha256):raise ValueError("Exact raw opening SHA256 is required")
 if not math.isfinite(args.start) or args.start<0:raise ValueError("Finite nonnegative raw start required")
 rd=ROOT/"artifacts/demo-video-20261013/recordings"/args.recording_id
 raw=inside(rd/"source.webm",True);meta_path=inside(rd/"metadata.json",True);meta=load(meta_path)
 raw_sha=digest(raw)
 if meta.get("id")!=args.recording_id or meta.get("status")!="COMPLETE" or meta.get("source")!="user_selected_browser_display_capture" or meta.get("raw_recording_retained") is not True:raise ValueError("Actual COMPLETE user-selected raw recording is required")
 if raw_sha!=args.opening_sha256 or meta.get("sha256")!=raw_sha:raise ValueError("Opening source/metadata SHA256 mismatch")
 duration=meta.get("probe",{}).get("duration_seconds")
 if not isinstance(duration,(int,float)) or not math.isfinite(duration) or (not args.cuts and args.start+DURATION>duration+.025):raise ValueError("Reviewed 18-second opening interval is outside the actual source")
 rp=probe(raw);rv=video(rp)
 source_dimensions=(rv.get("width"),rv.get("height"))
 if not all(isinstance(v,int) and v>0 for v in source_dimensions) or abs((source_dimensions[0]/source_dimensions[1])/(1438/1080)-1)>.005:raise ValueError("Raw opening must be near the target 4:3 ratio for full-page resampling without crop or padding")
 cuts_path=inside(args.cuts,True) if args.cuts else None
 if cuts_path:
  cuts_document=load(cuts_path)
  if cuts_document.get("version")!=1 or cuts_document.get("recording_id")!=args.recording_id or cuts_document.get("source_sha256")!=raw_sha:raise ValueError("Cuts must bind this exact actual raw recording")
  cuts=cuts_document.get("segments")
  if not isinstance(cuts,list) or [c.get("id") for c in cuts] not in (["input","send"],["input","send","dual"]):raise ValueError("Reviewed input/send intervals are required; an actual third dual interval is optional")
  previous_end=-1
  for c in cuts:
   if set(c)-{"id","start","end","notes"}:raise ValueError("Cuts support no speed, loops, freeze or other processing fields")
   if any(isinstance(c.get(k),bool) or not isinstance(c.get(k),(int,float)) or not math.isfinite(c[k]) for k in ["start","end"]) or c["start"]<0 or c["end"]<=c["start"] or c["start"]<previous_end or c["end"]>duration+.025:raise ValueError("Real source cuts must progress monotonically inside the retained raw source")
   frames=round((c["end"]-c["start"])*30)
   if abs((c["end"]-c["start"])*30-frames)>.001:raise ValueError("Choose frame-aligned cut lengths at 30fps; this avoids added ending frames")
   c["frame_count"]=frames;previous_end=c["end"]
  if abs(sum(c["end"]-c["start"] for c in cuts)-18)>.00001 or sum(c["frame_count"] for c in cuts)!=540:raise ValueError("The true retained intervals must total exactly 18 seconds / 540 output frames")
 else:
  cuts=[{"id":"continuous","start":args.start,"end":args.start+18,"frame_count":540}]

 take=inside(args.opener_take or "")
 if not take.is_dir() or not re.fullmatch(r"native-opener-\d+",take.name) or take.parent!=ROOT/"artifacts/demo-video-20261013/openers":raise ValueError("Actual native-opener take directory is required")
 plan_path=inside(take/"plan.json",True);plan=load(plan_path);state_path=inside(take/"state.json",True);state=load(state_path)
 if plan.get("take_id")!=take.name or plan.get("preset")!="standard" or plan.get("provider")!="agnes-ai" or plan.get("model")!="agnes-3.0-flash" or plan.get("sdk_prompt") is not False or plan.get("sdk_steer") is not False:raise ValueError("Unmodified independent native UI opener plan required")
 if state.get("session_id")!=plan.get("session_id"):raise ValueError("Actual opener session state identity mismatch")
 successful_collector=state.get("status")=="OPENER_COLLECTION_ENDED" and state.get("native_session_canceled") is True and state.get("robot_idle") is True
 restricted_failed_collector=bool(cuts_path and args.recording_id=="bc0ad5be-56c8-4f12-a77b-87f2ef29a637" and take.name=="native-opener-1791919168976" and state.get("status")=="FAILED" and state.get("reason")=="UNEXPECTED_ROBOT_MOTION")
 if not successful_collector and not restricted_failed_collector:raise ValueError("Only successful actual idle collection or the explicitly bounded reviewed take failure may be used")
 if cuts_path and (cuts_document.get("take_id")!=take.name or cuts_document.get("session_id")!=plan["session_id"]):raise ValueError("Cut document must bind the actual native take and session")

 native_path=inside(take/"native-events.jsonl",True);input_path=inside(take/"ui-user-input.jsonl",True)
 native=lines(native_path);submitted=[e for e in native if e.get("type")=="user/message" and e.get("origin")=="principal" and e.get("data",{}).get("kind")=="prompt"]
 if len(submitted)!=1 or text(submitted[0])!=GOAL:raise ValueError("Exactly one actual operator goal prompt is required, with no hidden steer or extra operator instructions")
 if any(e.get("type")=="user/message" and e.get("data",{}).get("kind")=="steer" for e in native):raise ValueError("No steer may be inserted into this real-input opener")
 goal=submitted[0];ui=lines(input_path)
 if not any(e.get("seq")==goal.get("seq") and e.get("text")==GOAL and e.get("matches_expected_goal") is True for e in ui):raise ValueError("UI input collector must corroborate the actual native goal event")
 capture_start=epoch(meta["started_at"]);goal_offset=epoch(goal["ts"])-capture_start
 if not any(c["start"]<=goal_offset<c["end"] for c in cuts):raise ValueError("Actual native Send timestamp must occur inside a retained real source cut")
 if cuts_path and not cuts[1]["start"]<=goal_offset<cuts[1]["end"]:raise ValueError("The send cut must contain the actual native goal submission")
 body_capture_end=max(s["capture_end_epoch"] for s in prior["sources"].values())
 if capture_start<=body_capture_end:raise ValueError("This helper requires a later independent opener retake and records it as such")
 review_path=inside(args.review or "",True);review=load(review_path)
 required_checks=["actual_input_visible","actual_send_visible","exact_goal_visible","no_task_card_or_synthetic_chat","camera_and_map_unobscured"]
 if not cuts_path or len(cuts)==3:required_checks.append("final_dual_view_visible")
 else:required_checks.append("transition_to_body_dual_verified")
 if review.get("verified") is not True or not review.get("reviewer") or not review.get("reviewed_at") or review.get("recording_id")!=args.recording_id or review.get("source_sha256")!=raw_sha or review.get("session_id")!=plan["session_id"] or review.get("take_id")!=take.name or review.get("duration")!=DURATION or any(review.get("checks",{}).get(k) is not True for k in required_checks):raise ValueError("Visual QA must bind actual recording/session and verify visible real input/send and final dual view")
 if cuts_path:
  if review.get("cuts_sha256")!=digest(cuts_path) or review.get("checks",{}).get("cuts_chronological_without_speed_loop_or_freeze") is not True:raise ValueError("Actual cut-by-cut visual QA must bind the immutable cuts document")
  if len(cuts)==2:
   dual_ref=review.get("body_first_frame_review",{});verify_bound_files([dual_ref])
   dual=load(inside(dual_ref["path"],True))
   if dual.get("verified") is not True or not dual.get("reviewer") or not dual.get("reviewed_at") or dual.get("body_sha256")!=bsha or dual.get("frame_seconds")!=0 or dual.get("checks",{}).get("actual_dual_view_visible") is not True or dual.get("checks",{}).get("camera_and_map_unobscured") is not True:raise ValueError("The reviewed original body's actual first frame must verify the transition to dual view")
   verify_bound_files([dual.get("frame_image",{})])
 elif review.get("start")!=args.start:raise ValueError("Continuous trim review start mismatch")
 selected_audit=None;failure_evidence=None
 if restricted_failed_collector:
  ros_path=inside(take/"ros-observer.jsonl",True)
  accepted=next((e for e in native if e.get("seq")==115),None)
  call=next((e for e in native if e.get("seq")==109),None)
  actual=native_result(accepted or {})
  if not accepted or accepted.get("type")!="tool/result" or accepted.get("ts")!="2026-10-13T19:22:03.052Z" or not call or call.get("data",{}).get("name")!="mcp_robot_mcp_1685c66d_inspect_room" or call.get("data",{}).get("args")!={"location":"Entry_Hall"} or accepted.get("data",{}).get("toolUseId")!=call.get("data",{}).get("toolUseId") or actual.get("accepted") is not True or actual.get("inspection_id")!="inspect-30af7456a2ec49f683dd72d3e53fb6d5":raise ValueError("This single later failure exception requires its exact actual native motion acceptance")
  acceptance_offset=epoch(accepted["ts"])-capture_start
  if any(c["end"]>=acceptance_offset for c in cuts):raise ValueError("Every retained cut must finish strictly before the later native motion acceptance")
  motion_call_names={e.get("data",{}).get("toolUseId"):e.get("data",{}).get("name","") for e in native if e.get("type")=="tool/call"}
  for e in native:
   if e.get("type")=="tool/result" and any(k in motion_call_names.get(e.get("data",{}).get("toolUseId"),"") for k in ["navigate_to","inspect_room","inspect_object","open_door"]):
    r=native_result(e)
    if (r.get("accepted") is True or r.get("status")=="SUCCEEDED") and epoch(e["ts"])-capture_start<=max(c["end"] for c in cuts):raise ValueError("Selected window contains or follows an earlier accepted motion")
  selected_audit=selected_idle_audit(ros_path,cuts,capture_start)
  selected_audit.update({"native_events":bind(native_path),"cuts":bind(cuts_path),"actual_later_motion":{"seq":accepted["seq"],"ts":accepted["ts"],"raw_offset_seconds":acceptance_offset,"inspection_id":actual["inspection_id"]},"all_cut_ends_strictly_before_native_motion_acceptance":True,"native_goal_exact_unique":True,"steer_absent":True})
  post_path=inside(take/"post-cancel-actual-idle-review.json",True);post=load(post_path);post_ros=post.get("final_actual_ros",{})
  n=post_ros.get("navigation",{});v=post_ros.get("velocity",{})
  if post.get("take_id")!=take.name or post.get("session_id")!=plan["session_id"] or post.get("collector_original_state_sha256")!=digest(state_path) or post.get("native_events_sha256")!=digest(native_path) or n.get("motion_lease",{}).get("held") is not False or n.get("status")!="IDLE" or any(not isinstance(v.get(k),(int,float)) or abs(v[k])>=.001 for k in ["linear_x","linear_y","angular_z"]):raise ValueError("Separate real post-cancel idle evidence must bind the unchanged FAILED state and native events")
  failure_evidence={"original_collector_failure":copy.deepcopy(state),"original_failure_state":bind(state_path),"post_cancel_actual_idle_observation":bind(post_path),"failure_preserved":True,"scope":"This exact failed take may contribute only the separately reviewed stationary selected cuts before its later motion acceptance; it is not relabeled successful."}

 verify_bound_files(prior.get("ending",{}).get("evidence_files",[]))
 for source in prior["sources"].values():
  if digest(inside(source["source"],True))!=source["source_sha256"]:raise ValueError("Original raw body source changed")
  verify_bound_files([source["recording_metadata"]])
 for seg in prior["segments"]:verify_bound_files(seg.get("evidence_files",[]))
 provenance={"kind":"LATER_INDEPENDENT_REAL_UI_OPENER_RETAKE","disclosure":"Opening was recorded later in a separate native session and is editorially joined to the earlier real guided route body. It is not the same turn or a continuous single take. Background route instructions and actual results remain in the original body AGH records.","take_id":take.name,"session_id":plan["session_id"],"recording_id":args.recording_id,"source":bind(raw),"recording_metadata":bind(meta_path),"visual_review":bind(review_path),"native_plan":bind(plan_path),"native_state":bind(state_path),"native_events":bind(native_path),"ui_user_input":bind(input_path),"actual_goal":{"text":GOAL,"native_seq":goal["seq"],"native_event_id":goal.get("id"),"native_ts":goal["ts"],"offset_in_raw":goal_offset},"raw_start":cuts[0]["start"],"raw_end":cuts[-1]["end"],"selected_cuts":copy.deepcopy(cuts),"retained_raw_seconds":DURATION,"source_dimensions":{"width":source_dimensions[0],"height":source_dimensions[1]},"normalization":{"width":1438,"height":1080,"method":"Full-page resampling; no crop or padding","aspect_ratio_relative_change":(1438/1080)/(source_dimensions[0]/source_dimensions[1])-1},"speed":1.0,"capture_start_epoch":capture_start,"captureChronology":False,"bodyCaptureChronology":True,"same_model_turn":False,"continuous_take":False,"task_card":False,"chat_reconstruction":False,"synthetic_actions":False}
 provenance["cuts_document"]=bind(cuts_path) if cuts_path else None
 provenance["dual_transition"]={"retake_contains_dual":len(cuts)==3 or not cuts_path,"body_first_frame_review":review.get("body_first_frame_review") if cuts_path and len(cuts)==2 else None,"description":"After the actual input/send retake, the edit cuts to the separately recorded reviewed body, whose first frame is already a real camera/map dual layout." if cuts_path and len(cuts)==2 else "The actual reviewed opener contains its own dual-view transition."}
 provenance["selected_window_audit"]=selected_audit
 provenance["later_collector_failure_preserved"]=failure_evidence
 checked={"ok":True,"opening":provenance,"body":bind(body),"body_manifest":bind(bm),"body_duration":bd,"opening_seconds":DURATION,"expected_output_seconds":bd+DURATION,"output":rel(output),"subtitle_srt_input":bind(srt),"shifted_srt_sha256":shifted_sha,"body_reencoded":False,"encoding": "Encode only the 540 retained actual opening frames at 1x to H264; normalize the complete page without crop/padding; remux body video; concat stream copy; shift original SRT by 18 seconds and encode mov_text."}
 if args.check:print(json.dumps(checked,ensure_ascii=False));return
 work=output.with_suffix(".assembly-work");manifest=output.with_suffix(".edit-manifest.json");final_srt=output.with_suffix(".zh-CN.srt")
 for p in [output,work,manifest,final_srt]:
  if p.exists():raise ValueError("Never overwrite an existing output: "+str(p))
 output.parent.mkdir(parents=True,exist_ok=True);work.mkdir()
 (work/"assembly-plan.json").write_text(json.dumps(checked,ensure_ascii=False,indent=2)+"\n")
 (work/"prior-body.edit-manifest.json").write_bytes(bm.read_bytes())
 final_srt.write_text(shifted,encoding="utf-8")
 opener=work/"opening.mp4";body_video=work/"body-video.mp4";concat=work/"concat.txt";log=work/"encoding.log"
 opening_commands=[];opening_parts=[]
 for i,c in enumerate(cuts):
  part=work/f"opening-part-{i:02}.mp4"
  enc=[BIN/"ffmpeg","-nostdin","-hide_banner","-loglevel","warning","-n","-i",raw,"-ss",f"{c['start']:.6f}","-t",f"{c['end']-c['start']:.6f}","-map","0:v:0","-vf","setpts=PTS-STARTPTS,scale=1438:1080,setsar=1,fps=30,format=yuv420p","-frames:v",str(c["frame_count"]),"-c:v","libx264","-profile:v","high","-level:v","4.0","-crf","20","-preset","fast","-threads","4","-video_track_timescale","15360","-an","-sn","-map_metadata","-1","-movflags","+faststart",part]
  run(enc,log);opening_commands.append(enc);opening_parts.append(part)
 opening_concat=work/"opening-concat.txt";opening_concat.write_text("".join("file '"+x.name+"'\n" for x in opening_parts))
 enc=[BIN/"ffmpeg","-nostdin","-hide_banner","-loglevel","warning","-n","-f","concat","-safe","1","-i",opening_concat,"-map","0:v:0","-c:v","copy","-an","-sn","-movflags","+faststart",opener]
 run(enc,log);opening_commands.append(enc)
 op=probe(opener)
 if video(op).get("nb_frames")!="540" or abs(media_seconds(op)-DURATION)>.02:raise ValueError("Opening encode must contain exactly 540 real frames / 18 seconds")
 remux=[BIN/"ffmpeg","-nostdin","-hide_banner","-loglevel","warning","-n","-i",body,"-map","0:v:0","-c:v","copy","-an","-sn","-map_metadata","-1","-movflags","+faststart",body_video]
 run(remux,log)
 concat.write_text("file 'opening.mp4'\nfile 'body-video.mp4'\n",encoding="utf-8")
 cmd=[BIN/"ffmpeg","-nostdin","-hide_banner","-loglevel","warning","-n","-f","concat","-safe","1","-i",concat,"-i",final_srt,"-map","0:v:0","-map","1:s:0","-c:v","copy","-c:s","mov_text","-disposition:s:0","default","-metadata:s:s:0","language=zho","-metadata:s:s:0","title=中文说明 · 搜寻演示","-metadata","title=Agnes 室内火灾人员搜寻演示","-metadata","comment=Later independent real UI opener retake joined to earlier reviewed route body; separate native sessions, not a continuous take; exact provenance and AGH evidence retained.","-movflags","+faststart",output]
 run(cmd,log)
 fp=probe(output);fv=video(fp);fd=media_seconds(fp)
 if abs(fd-(DURATION+bd))>.04 or fv.get("nb_frames")!=str(int(bv["nb_frames"])+540) or (fv.get("width"),fv.get("height"))!=(1438,1080) or any(s["codec_type"]=="audio" for s in fp["streams"]):raise ValueError("Final dimensions/frame count/duration/silent-stream validation failed")
 result=copy.deepcopy(prior)
 result["generated_at"]=datetime.now(timezone.utc).isoformat()
 result["body_original_manifest"]=bind(bm)
 result["body_original_output"]=copy.deepcopy(prior["output"])
 result["opening_provenance"]=provenance
 result["assembly_plan"]=bind(work/"assembly-plan.json")
 result["assembly_segments"]=[{"id":"real_ui_opening_retake","output_start":0,"output_end":18,"source":rel(raw),"selected_cuts":copy.deepcopy(cuts),"speed":1.0,"retained_seconds":18},{"id":"previously_reviewed_body","output_start":18,"output_end":fd,"source":rel(body),"source_start":0,"source_end":bd,"video_stream_copy":True,"original_manifest":bind(bm)}]
 for seg in result["segments"]:
  for key in ["planned_output_start","planned_output_end","output_start","output_end"]:
   if key in seg:seg[key]+=DURATION
  seg["body_original_output_offset_seconds"]=DURATION
 result["sources"]["opening_retake"]={"source":rel(raw),"source_sha256":raw_sha,"source_duration":duration,"review":review,"capture_start_epoch":capture_start,"capture_end_epoch":capture_start+duration,"recording_metadata":bind(meta_path),"native_session_id":plan["session_id"]}
 result["source_order"]=["opening_retake",*prior["source_order"]]
 result["captureChronology"]=False;result["bodyCaptureChronology"]=True
 result["source_transitions"].insert(0,{"from_source_id":"opening_retake","to_source_id":prior["source_order"][0],"reason":provenance["disclosure"],"capture_chronology":False,"native_sessions_distinct":True,"body_sequence_preserved":True,"evidence_files":[bind(native_path),bind(input_path),bind(bm),bind(review_path)]})
 result["timeline_body_original"]=copy.deepcopy(prior.get("timeline"))
 result["timeline"]=rel(work/"assembly-plan.json");result["timeline_sha256"]=digest(work/"assembly-plan.json")
 result["timeline_expected_duration_before_frame_rounding"]=DURATION+prior["expected_duration"]
 result["expected_duration"]=DURATION+bd
 result["processing"].update({"chronological":False,"body_chronological":True,"opening_speed":1.0,"opening_cuts_chronological":True,"opening_loops_or_freeze":False,"opening_full_page_resampling_no_crop_or_padding":True,"opening_reencoded":True,"body_reencoded":False,"video_join":"concat stream copy","subtitle_delivery":"Existing body burned captions unchanged; original natural Chinese SRT shifted by 18 seconds and remuxed as default mov_text; no opening graphic or task-card overlay","opening_has_visual_overlay":False})
 result["review"]={"verified":False,"body_review_inherited":copy.deepcopy(prior["review"]),"opening_visual_review":copy.deepcopy(review),"status":"Final assembly awaits visual QA; actual inputs are individually reviewed."}
 result["output"]={"path":rel(output),"sha256":digest(output),"duration":fd,"streams":[{"type":s["codec_type"],"codec":s["codec_name"]} for s in fp["streams"]],"frames":int(fv["nb_frames"])}
 result["subtitle_files"]=[rel(final_srt)]
 result["subtitle_shift"]={"input":bind(srt),"output":bind(final_srt),"offset_seconds":18,"cue_count":cues,"body_burned_subtitles_changed":False}
 result["assembly_commands"]=[[str(v) for v in c] for c in [*opening_commands,remux,cmd]]
 manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"output":result["output"],"manifest":rel(manifest),"captureChronology":False,"bodyCaptureChronology":True,"final_visual_qa_required":True},ensure_ascii=False))
if __name__=="__main__":
 try:main()
 except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError,json.JSONDecodeError) as e:
  print("Assembly failed: "+str(e),file=sys.stderr);sys.exit(1)
