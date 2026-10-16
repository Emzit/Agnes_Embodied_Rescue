#!/usr/bin/env python3
"""Independently validate an actual narrated 300-second project film; never render or publish."""
import argparse,datetime,hashlib,importlib.util,json,math,re,subprocess,sys
from pathlib import Path
from fractions import Fraction
ROOT=Path("/data-ssd/zhongchengkai/agnes")
spec=importlib.util.spec_from_file_location("actual_packet_qa",ROOT/"scripts/demo-video/validate-final-mix.py")
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
OLD_SHA="e2330d92055072b0cc0eb5c2bb8974112d83e50e89bbf2865dc59f06d1f873a2"
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument("--video",required=True)
 ap.add_argument("--silent",required=True)
 ap.add_argument("--manifest",help="Actual final edit manifest; defaults to video.edit-manifest.json")
 ap.add_argument("--srt",help="Actual final SRT companion; defaults to video.zh-CN.srt")
 ap.add_argument("--report",required=True)
 args=ap.parse_args()
 v=qa.inside(args.video,True);silent=qa.inside(args.silent,True)
 mp=qa.inside(args.manifest or v.with_suffix(".edit-manifest.json"),True)
 srt=qa.inside(args.srt or v.with_suffix(".zh-CN.srt"),True);report=qa.inside(args.report)
 if v==silent or report.exists():raise ValueError("Use the actual distinct voiced output and a new report")
 m=json.loads(mp.read_text());vsha=qa.sha(v);ssha=qa.sha(silent)
 if m.get("output",{}).get("sha256")!=vsha:raise ValueError("Actual final manifest SHA256 mismatch")
 mix=m.get("narration_mix",{})
 if mix.get("input_video",{}).get("sha256")!=ssha:raise ValueError("Mix must bind the exact actual approved silent project film")
 voices=mix.get("clips",[])
 if len(voices)!=9:raise ValueError("This new project film requires its nine actual narration sources")
 for c in voices:
  p=qa.inside(c["file"],True)
  if qa.sha(p)!=c["sha256"]:raise ValueError("Actual voice clip changed")
  source=c.get("source",{})
  if not source.get("kind") or not source.get("description"):raise ValueError("Actual audio source provenance required")
  if source.get("provenance_file"):
   p=qa.inside(source["provenance_file"],True)
   if source.get("provenance_sha256")!=qa.sha(p):raise ValueError("Actual audio provenance changed")
 vp,sp=qa.probe(v),qa.probe(silent)
 get=lambda p,t:[s for s in p["streams"] if s.get("codec_type")==t]
 vs,ss=get(vp,"video"),get(sp,"video");va=get(vp,"audio")
 if len(vs)!=1 or len(ss)!=1:raise ValueError("One actual source/final video stream required")
 video_spec=vs[0].get("codec_name")=="h264" and vs[0].get("nb_frames")=="9000" and Fraction(vs[0].get("avg_frame_rate","0/1"))==30 and abs(float(vs[0]["duration"])-300)<.04
 silent_spec=ss[0].get("codec_name")=="h264" and ss[0].get("nb_frames")=="9000" and Fraction(ss[0].get("avg_frame_rate","0/1"))==30 and abs(float(ss[0]["duration"])-300)<.04 and not get(sp,"audio")
 geometry=vs[0].get("width")==ss[0].get("width") and vs[0].get("height")==ss[0].get("height")
 audio_spec=len(va)==1 and va[0].get("codec_name")=="aac" and va[0].get("sample_rate")=="48000" and va[0].get("channels")==2 and abs(float(vp["format"]["duration"])-300)<.08
 packet=qa.compare_packet_content(qa.packets(silent,"v:0"),qa.packets(v,"v:0"),ss[0]["time_base"],vs[0]["time_base"])
 packet["codec_extradata_identical"]=bool(ss[0].get("extradata_hash") and ss[0]["extradata_hash"]==vs[0].get("extradata_hash"))
 # New project captions are burned by the reviewed renderer, so mov_text is not required.
 text=srt.read_text(encoding="utf-8")
 prohibited=re.findall(r"(?:\d+(?:\.\d+)?\s*[×xX倍]|创新点|设计路线)",text)
 stamps=re.findall(r"(?m)^(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})",text)
 def ms(t):
  h,n,s=t.split(":");s,k=s.split(",");return int(h)*3600000+int(n)*60000+int(s)*1000+int(k)
 intervals=[(ms(a),ms(b)) for a,b in stamps]
 ordered=bool(intervals) and all(0<=a<b<=300001 for a,b in intervals) and all(a[1]<=b[0] for a,b in zip(intervals,intervals[1:]))
 silent_srt=silent.with_suffix(".zh-CN.srt")
 srt_unchanged=silent_srt.is_file() and qa.sha(silent_srt)==qa.sha(srt)
 if not silent_srt.is_file():raise ValueError("Actual reviewed silent renderer SRT companion required")
 logdir=report.with_suffix(".logs")
 if logdir.exists():raise ValueError("Objective log directory already exists")
 report.parent.mkdir(parents=True,exist_ok=True);logdir.mkdir()
 command=[qa.BIN/"ffmpeg","-nostdin","-hide_banner","-v","warning","-i",v,"-map","0:v:0","-map","0:a:0","-sn","-f","null","-"]
 decode=qa.call(command);dl=logdir/"complete-av-decode.log";dl.write_text(decode.stdout+decode.stderr)
 cmd=[qa.BIN/"ffmpeg","-nostdin","-hide_banner","-v","info","-i",v,"-map","0:a:0","-vn","-sn","-af","astats=metadata=0:reset=0","-f","null","-"]
 ar=qa.call(cmd);al=logdir/"audio-astats.log";al.write_text(ar.stdout+ar.stderr)
 overall=ar.stderr.rsplit("Overall",1)[-1]
 def stat(k):
  match=re.search(re.escape(k)+r":\s*([^\r\n]+)",overall)
  if not match:return None
  try:return float(match[1].strip())
  except ValueError:return match[1].strip()
 rms,peak=stat("RMS level dB"),stat("Peak level dB")
 nan,inf=stat("Number of NaNs"),stat("Number of Infs")
 non_silent=isinstance(rms,(int,float)) and math.isfinite(rms) and rms> -60
 no_clip=isinstance(peak,(int,float)) and math.isfinite(peak) and peak<0 and nan==0 and inf==0
 old=ROOT/"artifacts/demo-video-20261013/final/demo.mp4";oldsha=qa.sha(old)
 passed=video_spec and silent_spec and geometry and audio_spec and packet["content_and_display_preserved"] and packet["codec_extradata_identical"] and not prohibited and ordered and srt_unchanged and decode.returncode==0 and not decode.stderr and ar.returncode==0 and non_silent and no_clip and oldsha==OLD_SHA
 result={"version":1,"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"kind":"ACTUAL_NEW_PROJECT_FILM_OBJECTIVE_QA","passed":passed,"video":qa.bind(v),"silent_reference":qa.bind(silent),"actual_final_manifest":qa.bind(mp),"specification":{"h264_9000frames_30fps_300seconds":video_spec,"source_silent_9000frames_30fps_300seconds":silent_spec,"geometry_preserved":geometry,"aac_48k_stereo_300seconds":audio_spec},"streams":[{k:s.get(k) for k in ["codec_type","codec_name","width","height","avg_frame_rate","nb_frames","duration","sample_rate","channels"]} for s in vp["streams"]],"video_packets":packet,"captions":{"delivery":"Burned into the reviewed silent renderer; mov_text not required.","actual_srt":qa.bind(srt),"silent_renderer_srt":qa.bind(silent_srt),"content_exactly_preserved":srt_unchanged,"prohibited_matches":prohibited,"cue_count":len(intervals),"cue_times_ordered_within_300seconds":ordered},"audio":{"RMS_dBFS":rms,"peak_dBFS":peak,"non_silent":non_silent,"below_digital_full_scale":no_clip,"NaNs":nan,"Infs":inf,"metric_scope":"Objective amplitude measures do not establish spoken intelligibility or content accuracy.","log":qa.bind(al),"nine_actual_clip_sources_verified":True},"complete_av_decode":{"exit_code":decode.returncode,"warnings":decode.stderr.splitlines(),"warning_count":len(decode.stderr.splitlines()),"log":qa.bind(dl)},"old_demo":{"path":qa.rel(old),"sha256":oldsha,"unchanged":oldsha==OLD_SHA},"scope":"Read-only final-media/source QA; no rendering, new robot operation, record-state mutation or publication."}
 report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"passed":passed,"report":qa.rel(report),"report_sha256":qa.sha(report),"video_sha256":vsha,"specification":result["specification"],"packet_payloads_preserved":packet["payloads_identical"],"decode_warnings":len(decode.stderr.splitlines()),"captions_prohibited_matches":prohibited,"RMS_dBFS":rms,"peak_dBFS":peak,"old_demo_unchanged":oldsha==OLD_SHA},ensure_ascii=False))
 if not passed:sys.exit(1)
if __name__=="__main__":
 try:main()
 except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError,json.JSONDecodeError) as e:
  print("Project film QA failed:"+str(e),file=sys.stderr);sys.exit(1)
