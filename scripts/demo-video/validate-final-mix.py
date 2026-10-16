#!/usr/bin/env python3
"""Read and objectively validate an actual final narrated video; never synthesize or mix."""
import argparse,hashlib,json,math,re,subprocess,sys,struct
from datetime import datetime,timezone
from fractions import Fraction
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BIN=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin"
SILENT="artifacts/demo-video-20261013/final/demo-real-opening-silent-v4-portable.mp4"
SILENT_SHA="24d818ac1cd7c58555330cfe8654d06dcd5789f6316f7d1ac8b7521b69d9c0cd"
def inside(v,exists=False):
 p=Path(v);p=(ROOT/p).resolve() if not p.is_absolute() else p.resolve()
 if ROOT not in p.parents:raise ValueError("Path must stay inside the project")
 if exists and not p.is_file():raise ValueError("Actual required file does not exist: "+str(p))
 return p
def rel(p):return str(p.relative_to(ROOT))
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1048576),b""):h.update(b)
 return h.hexdigest()
def bind(p):return {"path":rel(p),"sha256":sha(p)}
def call(cmd):
 r=subprocess.run([str(c) for c in cmd],capture_output=True,text=True)
 return r
def probe(p):
 r=call([BIN/"ffprobe","-v","error","-show_format","-show_streams","-show_data_hash","sha256","-of","json",p])
 if r.returncode:raise ValueError("FFPROBE_FAILED:"+r.stderr)
 return json.loads(r.stdout)
def packets(p,selector):
 command=[BIN/"ffprobe","-v","error","-select_streams",selector,"-show_packets","-show_entries","packet=pts,dts,duration,pts_time,dts_time,duration_time,size,flags,data_hash","-show_data_hash","sha256","-of","json",p]
 r=call(command)
 if r.returncode:raise ValueError("PACKET_PROBE_FAILED:"+r.stderr)
 ps=json.loads(r.stdout).get("packets",[])
 if not ps or any("data_hash" not in q for q in ps):raise ValueError("Missing actual packet payload hash")
 return ps
def compare_packet_content(before,after,input_tb,output_tb,subtitle=False):
 a=[{"size":p.get("size"),"data_hash":p["data_hash"]} for p in before]
 b=[{"size":p.get("size"),"data_hash":p["data_hash"]} for p in after]
 changed=[i for i,(x,y) in enumerate(zip(a,b)) if x!=y]
 tb_a,tb_b=Fraction(input_tb),Fraction(output_tb);tolerance=max(tb_a,tb_b)
 def tick(p,field,tb):
  return Fraction(int(p[field]))*tb if field in p else None
 timeline=[]
 for field in ["pts","dts","duration"]:
  drift=[abs(tick(x,field,tb_a)-tick(y,field,tb_b)) for x,y in zip(before,after) if field in x and field in y]
  timeline.append({"field":field,"maximum_absolute_difference_seconds":float(max(drift,default=0))})
 canonical=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 result={"input_packet_count":len(a),"output_packet_count":len(b),"payloads_identical":a==b,"changed_payload_packet_indices":changed[:20],"input_payload_sequence_sha256":canonical(a),"output_payload_sequence_sha256":canonical(b),"timestamps":timeline,"timebase_tolerance_seconds":float(tolerance),"timestamps_preserved":all(Fraction(str(x["maximum_absolute_difference_seconds"]))<=tolerance for x in timeline),"semantic_cues_preserved":False}
 if subtitle:
  empty_hash="SHA256:"+hashlib.sha256(b"\x00\x00").hexdigest()
  is_empty=lambda p:p.get("size")=="2" and p.get("data_hash")==empty_hash
  def cues(ps,tb):
   out=[]
   for i,p in enumerate(ps):
    if is_empty(p):continue
    begin=tick(p,"pts",tb);duration=tick(p,"duration",tb)
    if begin is None or duration is None:raise ValueError("Subtitle cue lacks precise timestamp/duration")
    end=begin+duration
    if i+1<len(ps) and tick(ps[i+1],"pts",tb) is not None:end=min(end,tick(ps[i+1],"pts",tb))
    out.append((p.get("size"),p["data_hash"],begin,end))
   return out
  ca,cb=cues(before,tb_a),cues(after,tb_b)
  clear_a=[tick(p,"pts",tb_a) for p in before if is_empty(p)]
  clear_b=[tick(p,"pts",tb_b) for p in after if is_empty(p)]
  nonempty_ok=len(ca)==len(cb) and all(x[:2]==y[:2] and abs(x[2]-y[2])<=tolerance and abs(x[3]-y[3])<=tolerance for x,y in zip(ca,cb))
  last_clear_ok=bool(clear_a and clear_b and abs(clear_a[-1]-clear_b[-1])<=tolerance)
  result["semantic_cues_preserved"]=nonempty_ok and last_clear_ok
  result["clear_packets"]={"known_empty_payload_sha256":empty_hash,"input_count":len(clear_a),"output_count":len(clear_b),"input_pts_seconds":[float(t) for t in clear_a],"output_pts_seconds":[float(t) for t in clear_b],"last_clear_time_preserved":last_clear_ok,"input_nonempty_cue_count":len(ca),"output_nonempty_cue_count":len(cb),"nonempty_payload_and_display_start_end_preserved":nonempty_ok,"normal_remux_clear_packet_only_difference":a!=b and nonempty_ok and last_clear_ok}
  result["content_and_display_preserved"]=result["semantic_cues_preserved"]
 else:result["content_and_display_preserved"]=result["payloads_identical"] and result["timestamps_preserved"]
 return result
def subtitle_extradata(path):
 r=call([BIN/"ffprobe","-v","error","-select_streams","s:0","-show_streams","-show_data","-show_entries","stream=extradata,extradata_size","-of","json",path])
 if r.returncode:raise ValueError("SUBTITLE_EXTRADATA_PROBE_FAILED:"+r.stderr)
 values=json.loads(r.stdout).get("streams",[])
 if len(values)!=1:raise ValueError("Exactly one actual subtitle stream required")
 raw=values[0].get("extradata","");parts=[]
 for line in raw.splitlines():
  if re.match(r"^[0-9a-f]{8}:",line):
   part=line.split(":",1)[1].strip().split("  ",1)[0]
   if not re.fullmatch(r"[0-9a-f ]+",part):raise ValueError("Invalid subtitle extradata hex")
   parts.append(bytes.fromhex(part))
 data=b"".join(parts)
 if len(data)!=values[0].get("extradata_size"):raise ValueError("Subtitle extradata byte count mismatch")
 return data
def compare_mov_text_headers(before,after):
 def boxes(data):
  # ISO tx3g fixed display/style record is exactly 30 bytes; all its bytes remain strict.
  if len(data)<30:raise ValueError("Truncated mov_text display/style record")
  out=[];pos=30
  while pos<len(data):
   if pos+8>len(data):raise ValueError("Truncated mov_text extension box")
   length=struct.unpack(">I",data[pos:pos+4])[0];kind=data[pos+4:pos+8].decode("ascii")
   if length<8 or pos+length>len(data):raise ValueError("Invalid mov_text extension box")
   out.append({"offset":pos,"length":length,"type":kind,"sha256":hashlib.sha256(data[pos:pos+length]).hexdigest()});pos+=length
  return out
 a,b=boxes(before),boxes(after)
 same=before==after;duplicate=False;added=None
 if not same and a and a[-1]["type"]=="btrt" and a[-1]["length"]==20:
  old=a[-1];tail=before[old["offset"]:old["offset"]+old["length"]]
  duplicate=after==before+tail
  if duplicate:added={"offset":len(before),"length":20,"type":"btrt","identical_original_offset":old["offset"],"sha256":hashlib.sha256(tail).hexdigest(),"hex":tail.hex(),"buffer_size_db":struct.unpack(">I",tail[8:12])[0],"max_bitrate":struct.unpack(">I",tail[12:16])[0],"average_bitrate":struct.unpack(">I",tail[16:20])[0]}
 return {"input_size":len(before),"output_size":len(after),"input_hex":before.hex(),"output_hex":after.hex(),"input_boxes":a,"output_boxes":b,"raw_extradata_identical":same,"display_style_record_unchanged":before[:30]==after[:30],"all_original_bytes_and_box_offsets_unchanged":after[:len(before)]==before,"only_exact_identical_duplicate_non_display_bitrate_box_appended":duplicate,"added_box":added,"display_compatible":same or duplicate,"rule":"Strict complete equality, or exact unchanged original byte prefix plus one identical 20-byte btrt box already present at the end. No font/style/coordinate/other box changes are accepted."}
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument("--video",required=True,help="Actual new voiced MP4")
 ap.add_argument("--silent",default=SILENT)
 ap.add_argument("--manifest",help="Actual voiced edit manifest; defaults to video.edit-manifest.json")
 ap.add_argument("--report",required=True,help="New objective JSON report, never overwrites")
 args=ap.parse_args()
 v=inside(args.video,True);silent=inside(args.silent,True);mp=inside(args.manifest or v.with_suffix(".edit-manifest.json"),True);report_path=inside(args.report)
 if v==silent or report_path.exists():raise ValueError("Use a distinct actual voiced video and a new report path")
 if sha(silent)!=SILENT_SHA:raise ValueError("Exact approved portable silent source required")
 manifest=json.loads(mp.read_text());vsha=sha(v)
 if manifest.get("output",{}).get("sha256")!=vsha:raise ValueError("Actual voiced manifest SHA256 mismatch")
 mix=manifest.get("narration_mix",{})
 if mix.get("input_video",{}).get("sha256")!=SILENT_SHA:raise ValueError("Narration provenance must bind the approved actual silent source")
 clips=mix.get("clips",[])
 if len(clips)!=8:raise ValueError("This final narration requires its eight actual clips")
 clip_sources=[]
 for c in clips:
  p=inside(c["file"],True)
  if sha(p)!=c["sha256"]:raise ValueError("Narration clip changed:"+c["file"])
  source=c.get("source",{})
  if not source.get("kind") or not source.get("description"):raise ValueError("Actual narration source provenance required")
  if source.get("provenance_file"):
   pp=inside(source["provenance_file"],True)
   if source.get("provenance_sha256")!=sha(pp):raise ValueError("Narration provenance file changed")
  clip_sources.append({"id":c["id"],"file":c["file"],"sha256":c["sha256"],"start_seconds":c["start_seconds"],"duration_seconds":c["duration_seconds"],"gain_db":c["gain_db"],"source_kind":source["kind"]})
 pr=probe(v);streams=pr["streams"]
 by={t:[s for s in streams if s.get("codec_type")==t] for t in ["video","subtitle","audio"]}
 spec={"video":len(by["video"])==1 and by["video"][0].get("codec_name")=="h264" and by["video"][0].get("width")==1438 and by["video"][0].get("height")==1080 and Fraction(by["video"][0].get("avg_frame_rate","0/1"))==30 and by["video"][0].get("nb_frames")=="9023","subtitle":len(by["subtitle"])==1 and by["subtitle"][0].get("codec_name")=="mov_text","audio":len(by["audio"])==1 and by["audio"][0].get("codec_name")=="aac" and by["audio"][0].get("sample_rate")=="48000" and by["audio"][0].get("channels")==2}
 vd=float(by["video"][0].get("duration",pr["format"]["duration"])) if by["video"] else 0
 fd=float(pr["format"]["duration"])
 spec["duration"]=abs(vd-300.766667)<.04 and abs(fd-300.766667)<.08
 source_pr=probe(silent)
 source_video=next(s for s in source_pr["streams"] if s["codec_type"]=="video");source_subtitle=next(s for s in source_pr["streams"] if s["codec_type"]=="subtitle")
 vp=compare_packet_content(packets(silent,"v:0"),packets(v,"v:0"),source_video["time_base"],by["video"][0]["time_base"])
 sp=compare_packet_content(packets(silent,"s:0"),packets(v,"s:0"),source_subtitle["time_base"],by["subtitle"][0]["time_base"],True)
 vp["codec_extradata_identical"]=bool(source_video.get("extradata_hash") and source_video.get("extradata_hash")==by["video"][0].get("extradata_hash"))
 sp["codec_extradata_identical"]=source_subtitle.get("extradata_hash")==by["subtitle"][0].get("extradata_hash")
 sp["codec_header_comparison"]=compare_mov_text_headers(subtitle_extradata(silent),subtitle_extradata(v))
 sp["codec_display_header_compatible"]=sp["codec_header_comparison"]["display_compatible"]
 report_path.parent.mkdir(parents=True,exist_ok=True)
 logs=report_path.with_suffix(".logs")
 if logs.exists():raise ValueError("Objective QA log directory already exists")
 logs.mkdir()
 command=[BIN/"ffmpeg","-nostdin","-hide_banner","-v","warning","-i",v,"-map","0:v:0","-map","0:a:0","-sn","-f","null","-"]
 decoded=call(command);decode_log=logs/"complete-av-decode.log";decode_log.write_text(decoded.stdout+decoded.stderr)
 audio_command=[BIN/"ffmpeg","-nostdin","-hide_banner","-v","info","-i",v,"-map","0:a:0","-vn","-sn","-af","astats=metadata=0:reset=0","-f","null","-"]
 audio=call(audio_command);audio_log=logs/"audio-astats.log";audio_log.write_text(audio.stdout+audio.stderr)
 overall=audio.stderr.rsplit("Overall",1)[-1]
 def stat(name):
  found=re.search(re.escape(name)+r":\s*([^\r\n]+)",overall)
  if not found:return None
  raw=found[1].strip()
  try:return float(raw)
  except ValueError:return raw
 metrics={n:stat(n) for n in ["Peak level dB","RMS level dB","RMS peak dB","RMS trough dB","Peak count","Number of samples","Number of NaNs","Number of Infs"]}
 rms=metrics["RMS level dB"];peak=metrics["Peak level dB"]
 non_silent=audio.returncode==0 and isinstance(rms,(int,float)) and math.isfinite(rms) and rms> -60 and isinstance(peak,(int,float)) and math.isfinite(peak)
 audio_metrics={"ffmpeg_exit_code":audio.returncode,"overall":{k:v if not isinstance(v,float) or math.isfinite(v) else str(v) for k,v in metrics.items()},"non_silent":non_silent,"non_silent_rule":"Actual overall audio RMS is finite and above -60dBFS; this objective metric does not establish spoken intelligibility.","peak_above_digital_full_scale":isinstance(peak,(int,float)) and peak>0,"log":bind(audio_log)}
 passed=all(spec.values()) and vp["content_and_display_preserved"] and vp["codec_extradata_identical"] and sp["content_and_display_preserved"] and sp["codec_display_header_compatible"] and decoded.returncode==0 and not decoded.stderr and non_silent
 result={"generated_at":datetime.now(timezone.utc).isoformat(),"kind":"ACTUAL_FINAL_NARRATED_VIDEO_OBJECTIVE_QA","passed":passed,"video":bind(v),"silent_reference":bind(silent),"actual_edit_manifest":bind(mp),"actual_narration_clips":clip_sources,"specification":spec,"actual_video_duration":vd,"actual_format_duration":fd,"streams":[{k:s.get(k) for k in ["codec_type","codec_name","width","height","avg_frame_rate","nb_frames","sample_rate","channels","channel_layout","duration"]} for s in streams],"video_packets":vp,"subtitle_packets":sp,"complete_av_decode":{"exit_code":decoded.returncode,"warning_line_count":len(decoded.stderr.splitlines()),"warning_lines":decoded.stderr.splitlines(),"command":[str(c) for c in command],"log":bind(decode_log)},"audio":audio_metrics,"scope":"Only actual encoded-file, packet and audio metrics. No placeholder PASS, audio synthesis, mixing, frame/subtitle modifications or publication. Intelligibility approval remains a separate listening judgement."}
 with report_path.open("x") as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"passed":passed,"report":rel(report_path),"report_sha256":sha(report_path),"video_sha256":vsha,"specification":spec,"video_packets_preserved":vp["payloads_identical"],"subtitle_content_and_display_preserved":sp["content_and_display_preserved"],"complete_av_decode_warnings":len(decoded.stderr.splitlines()),"audio":audio_metrics},ensure_ascii=False))
 if not passed:sys.exit(1)
if __name__=="__main__":
 try:main()
 except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError,json.JSONDecodeError) as e:
  print("Final mix QA failed:"+str(e),file=sys.stderr);sys.exit(1)
