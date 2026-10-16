#!/usr/bin/env python3
"""Bind an actually completed voice09/title-v4 silent render for the existing mixer."""
from pathlib import Path
import datetime,hashlib,json,subprocess,wave
ROOT=Path("/data-ssd/zhongchengkai/agnes")
D=ROOT/"artifacts/demo-project-film-20261014/revision-voice09-title-v4"
V3="29c59638c1c737f8f6e893b46549104e36e79ddba13750547266a73d9e10bda8"
TITLE="具身救援 · 从指令到行动"
def sha(p):
 with p.open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def bind(p):return {"path":str(p.relative_to(ROOT)),"sha256":sha(p),"bytes":p.stat().st_size}
def stime(t):
 ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
 return f"{h:02}:{m:02}:{s:02},{ms:03}"
def main():
 silent=D/"project-film-voice09-title-silent-v4.mp4";out=D/"silent-input-manifest.json"
 if out.exists():raise RuntimeError("Preserve existing silent manifest")
 timeline=D/"voice/narration-cues-voice09.json";td=json.loads(timeline.read_text())
 preservation=D/"render-preservation-report.json";pd=json.loads(preservation.read_text())
 audit=D/"preservation-audit.json";ad=json.loads(audit.read_text())
 ref=D/"input-active/project-film.mp4";previous=D/"input-active/project-film.edit-manifest.json";old=json.loads(previous.read_text())
 if sha(ref)!=V3 or ad.get("source_active_sha256")!=V3 or pd["output_silent"]["sha256"]!=sha(silent):raise RuntimeError("Actual completed silent and immutable source SHA bindings required")
 if ad.get("full_frame_count")!=3255 or ad.get("pip_frame_count")!=4770:raise RuntimeError("All recorded-input scopes required")
 if ad.get("full_ui_input_sha256")!=ad.get("full_ui_reference_sha256") or ad.get("pip_input_sha256")!=ad.get("pip_reference_sha256"):raise RuntimeError("Actual nativeUI/inset preencoding pixels must match")
 media=json.loads(subprocess.run([str(ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/ffprobe"),"-v","error","-show_streams","-show_format","-of","json",str(silent)],capture_output=True,text=True,check=True).stdout)
 videos=[s for s in media["streams"] if s["codec_type"]=="video"]
 if len(videos)!=1 or any(s["codec_type"]=="audio" for s in media["streams"]) or videos[0].get("nb_frames")!="9000" or videos[0].get("avg_frame_rate")!="30/1" or videos[0].get("width")!=1438 or videos[0].get("height")!=1080 or abs(float(media["format"]["duration"])-300)>.04:raise RuntimeError("Actual9000frame300s silent contract required")
 captions=[];voices=[]
 for c in td["clips"]:
  file=ROOT/c["file"]
  with wave.open(str(file)) as w:duration=w.getnframes()/w.getframerate()
  start=float(c.get("start",c.get("start_seconds")));speech=c["text"]
  if c.get("duration_seconds") is not None and abs(float(c["duration_seconds"])-duration)>1/48000:raise RuntimeError("Wrong source duration metadata")
  phrases=[];cur=""
  for char in speech:
   cur+=char
   if char in "。，；：？" or len(cur)>=25:phrases.append(cur);cur=""
  if cur:phrases.append(cur)
  total=sum(len(s) for s in phrases);p=start
  for phrase in phrases:
   end=p+duration*len(phrase)/total;captions.append({"start":p,"end":end,"text":phrase.rstrip("，。；：")});p=end
  pp=ROOT/c["source"]["provenance_file"]
  voices.append({"id":c["id"],"actual_source":bind(file),"actual_duration_seconds":duration,"start_seconds":start,"text":speech,"provenance":bind(pp)})
 if len(voices)!=9:raise RuntimeError("Exactly9real voice09clips required")
 srt=silent.with_suffix(".zh-CN.srt")
 expected="\n\n".join(f'{i+1}\n{stime(c["start"])} --> {stime(c["end"])}\n{c["text"]}' for i,c in enumerate(captions))+"\n"
 if srt.read_text()!=expected:raise RuntimeError("New actual voice09timeline must produce actual newSRT")
 schedule=D/"caption-schedule.json";sd=json.loads(schedule.read_text())
 if sd.get("cues")!=captions:raise RuntimeError("Renderer caption schedule differs from actual new09timeline")
 bg=td["background"];bfile=ROOT/bg["file"]
 if sha(bfile)!="bb8386120d08445ca1fc96d9be26f0cb45fd08fe6a0be21a5ecd4b311c76ed82" or bg.get("gain_db")!=-28:raise RuntimeError("Original ambient-28 required")
 animation=old["original_animation"].copy()
 animation.update({"renderer":bind(ROOT/"scripts/demo-video/render-project-film-voice09-title-v4.py"),"output_silent":bind(silent),"title":TITLE,"render_preservation":bind(preservation),"preencoding_audit":bind(audit),"full_UI_regions_exclusive_xyxy":[[0,0,1438,976],[0,1054,1438,1080]],"retimed_caption_band_exclusive_xyxy":[0,976,1438,1054]})
 for key in ["render_preservation","preencoding_audit"]:animation[key]=bind(preservation if key=="render_preservation" else audit)
 artifacts={k:v for k,v in old.get("artifacts",{}).items() if k not in ("caption_schedule","narration")}
 artifacts.update({"caption_schedule":bind(schedule),"narration":bind(timeline)})
 info={"version":4,"kind":"EDITORIAL_PROJECT_PRESENTATION_VOICE09_TITLE_REVISION_SILENT_INPUT","technical_validation_only":False,"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"title":TITLE,"duration_seconds":300,"composition":old["composition"],"source":old["source"],"original_recorded_demo_lineage":old["original_recorded_demo_lineage"],"supersedes":{"previous_movie":bind(ref),"previous_manifest":bind(previous),"previous_subtitles":bind(D/"input-active/project-film.zh-CN.srt"),"input_archive":bind(D/"input-archive.json")},"change_scope":{"title_updated":True,"narration_selected_voice":"09","narration_source_reference":"Model-generated generic adult female, no real-person reference","new_caption_timing_matches_actual_narration":True,"native_dialogue_camera_map_realUI_pixels_and_clock_unchanged_outside_editorial_caption_band":True,"robot_actions":False,"new_runtime_model_calls":False},"original_animation":animation,"artifacts":artifacts,"subtitle_files":[str(srt.relative_to(ROOT))],"subtitles":"Burned Chinese captions and newSRT generated from actual voice09paragraph lengths; clause durations proportional, not phoneme forced alignment.","subtitle_binding":bind(srt),"caption_schedule":bind(schedule),"narration":{"kind":"SELECTED_VOICE09_NEW_POSTPRODUCTION_TRACKS_PREPARED","selected_voice_id":"09","reference_sha256":"be883026d4670693b5e0a4d262af1ebedb9f5d8b26be874edc9a76adb425ac21","timeline":bind(timeline),"nine_actual_sources":voices,"background":bind(bfile),"background_gain_db":-28,"old_Serena_audio_not_copied":True,"scope":"Third-party model used only for approved video postproduction narration; robot core remainsAgnes"},"review":{"verified":False,"status":"Completed silent output and newcaption/voice source binding checked; actual final voiced picture/audio/visualQA pending","preencoding_recorded_pixel_input_exact":True,"new_actual_SRT_and_schedule_match_nine_voice09clip_durations":True},"output":{"path":str(silent.relative_to(ROOT)),"sha256":sha(silent),"bytes":silent.stat().st_size,"duration":300.0,"frames":9000,"width":1438,"height":1080,"fps":30,"streams":[{"type":"video","codec":"h264"}]}}
 with out.open("x") as f:json.dump(info,f,ensure_ascii=False,indent=2);f.write("\n")
 print(json.dumps({"manifest":str(out.relative_to(ROOT)),"manifest_sha256":sha(out),"actual_silent_sha256":sha(silent),"review":"FinalAVQA pending","caption_count":len(captions)}))
if __name__=="__main__":main()
