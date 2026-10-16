#!/usr/bin/env python3
"""Read-only voice09 revision QA; protect original UI/inset while permitting retimed editorial captions."""
import argparse, datetime, hashlib, importlib.util, json, math, re, struct, subprocess, sys, wave
from pathlib import Path
import numpy as np
ROOT=Path("/data-ssd/zhongchengkai/agnes")
BIN=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin"
W,H,FPS,N=1438,1080,30,9000
FULL_RANGES=((915,2160),(6990,9000))
PIP_RANGE=(2190,6960)
PIP=(950,213,1372,434)

def inside(value,exists=False):
 p=Path(value)
 if not p.is_absolute():p=ROOT/p
 p=p.resolve()
 if not p.is_relative_to(ROOT) or (exists and not p.is_file()):raise ValueError("Project-local existing file required: "+str(p))
 return p
def sha(p):
 with p.open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def bind(p):return {"path":str(p.relative_to(ROOT)),"sha256":sha(p),"bytes":p.stat().st_size}
def call(args):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr[-2500:])
 return r
def probe(p):
 return json.loads(call([BIN/"ffprobe","-v","error","-show_streams","-show_format","-of","json",p]).stdout)
def audio_signature(p):
 d=json.loads(call([BIN/"ffprobe","-v","error","-select_streams","a:0","-show_streams","-show_packets","-show_data_hash","sha256","-show_entries","stream=codec_name,profile,sample_fmt,sample_rate,channels,channel_layout,time_base,extradata_hash:packet=pts,dts,duration,size,data_hash","-of","json",p]).stdout)
 if len(d.get("streams",[]))!=1 or not d.get("packets"):raise ValueError("One complete real audio stream required")
 return d
def read_exact(pipe,n):
 parts=[];remaining=n
 while remaining:
  part=pipe.read(remaining)
  if not part:break
  parts.append(part);remaining-=len(part)
 return b"".join(parts)
def decoder(p,log):
 return subprocess.Popen([str(BIN/"ffmpeg"),"-nostdin","-v","warning","-threads","4","-i",str(p),"-map","0:v:0","-an","-sn","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE,stderr=log)
def psnr(mse):return math.inf if mse==0 else 10*math.log10(255**2/mse)
def compare_pixels(reference,candidate,logdir):
 groups={k:{"frames":0,"sse":0.0,"samples":0,"worst_frame_mse":0.0,"worst_frame_index":None,"max_abs_channel_difference":0} for k in ("full_recorded_view","recorded_inset")}
 refhash={k:hashlib.sha256() for k in groups};outref={k:hashlib.sha256() for k in groups}
 lr=(logdir/"reference-decode.log").open("wb");lc=(logdir/"candidate-decode.log").open("wb")
 a=decoder(reference,lr);b=decoder(candidate,lc)
 try:
  for i in range(N):
   x=read_exact(a.stdout,W*H*3);y=read_exact(b.stdout,W*H*3)
   if len(x)!=W*H*3 or len(y)!=W*H*3:raise ValueError("Actual video ended before frame "+str(i))
   selected="full_recorded_view" if any(lo<=i<hi for lo,hi in FULL_RANGES) else "recorded_inset" if PIP_RANGE[0]<=i<PIP_RANGE[1] else None
   if not selected:continue
   rx=np.frombuffer(x,dtype=np.uint8).reshape(H,W,3);cy=np.frombuffer(y,dtype=np.uint8).reshape(H,W,3)
   if selected=="full_recorded_view":
    rx=np.concatenate((rx[:976,:,:],rx[1054:,:,:]),axis=0);cy=np.concatenate((cy[:976,:,:],cy[1054:,:,:]),axis=0)
   elif selected=="recorded_inset":
    x0,y0,x1,y1=PIP;rx=rx[y0:y1,x0:x1,:];cy=cy[y0:y1,x0:x1,:]
   # Bind frame indices to the original display order for a reproducible decoded reference.
   prefix=struct.pack(">I",i);refhash[selected].update(prefix);refhash[selected].update(rx.tobytes())
   outref[selected].update(prefix);outref[selected].update(cy.tobytes())
   diff=rx.astype(np.float32)-cy.astype(np.float32);sse=float(np.sum(diff*diff,dtype=np.float64));mse=sse/diff.size
   q=groups[selected];q["frames"]+=1;q["samples"]+=diff.size;q["sse"]+=sse
   q["max_abs_channel_difference"]=max(q["max_abs_channel_difference"],int(np.max(np.abs(diff))))
   if mse>q["worst_frame_mse"]:q["worst_frame_mse"]=mse;q["worst_frame_index"]=i
   if i%900==0:print(json.dumps({"pixel_qa_frame":i}),flush=True)
  if a.stdout.read(1)!=b"" or b.stdout.read(1)!=b"":raise ValueError("Actual video has extra frames after 9000")
  if a.wait()!=0 or b.wait()!=0:raise RuntimeError("Actual video decode failed")
 finally:
  for p in (a,b):
   if p.poll() is None:p.kill();p.wait()
  lr.close();lc.close()
 for key,q in groups.items():
  q["mean_RGB_PSNR_dB"]=psnr(q.pop("sse")/q.pop("samples"))
  q["minimum_frame_RGB_PSNR_dB"]=psnr(q.pop("worst_frame_mse"))
  q["reference_decoded_ordered_pixel_sha256"]=refhash[key].hexdigest()
  q["candidate_decoded_ordered_pixel_sha256"]=outref[key].hexdigest()
  q["passed_codec_tolerance"]=q["mean_RGB_PSNR_dB"]>=35 and q["minimum_frame_RGB_PSNR_dB"]>=30
 return groups
def ssim(reference,candidate,kind,logdir):
 stats=logdir/(kind+"-ssim-frames.txt")
 if kind=="full_recorded_view":
  def region(source,prefix,out):
   return "["+source+"]select='between(n,915,2159)+between(n,6990,8999)',setpts=N/(30*TB),format=rgb24,split=2["+prefix+"t]["+prefix+"b];["+prefix+"t]crop=1438:976:0:0["+prefix+"top];["+prefix+"b]crop=1438:26:0:1054["+prefix+"bottom];["+prefix+"top]["+prefix+"bottom]vstack=inputs=2,format=yuv444p["+out+"];"
  graph=region("0:v","r","a")+region("1:v","n","b")
 else:
  common="trim=start_frame=2190:end_frame=6960,setpts=N/(30*TB),format=rgb24,crop=422:221:950:213,format=yuv444p"
  graph="[0:v]"+common+"[a];[1:v]"+common+"[b];"
 graph+="[a][b]ssim=stats_file="+str(stats)+"[out]"
 r=call([BIN/"ffmpeg","-nostdin","-hide_banner","-v","info","-threads","4","-i",reference,"-threads","4","-i",candidate,"-filter_complex_threads","2","-filter_complex",graph,"-map","[out]","-an","-sn","-f","null","-"])
 (logdir/(kind+"-ssim.log")).write_text(r.stdout+r.stderr)
 matches=re.findall(r"SSIM[^\r\n]*All:([0-9.]+)",r.stderr)
 if not matches:raise RuntimeError("No complete SSIM result")
 value=float(matches[-1])
 return {"mean_YUV444_SSIM":value,"passed_codec_tolerance":value>=.98,"actual_per_frame_stats":str(stats.relative_to(ROOT)),"stats_sha256":sha(stats)}

V3_SHA="29c59638c1c737f8f6e893b46549104e36e79ddba13750547266a73d9e10bda8"
REF09_SHA="be883026d4670693b5e0a4d262af1ebedb9f5d8b26be874edc9a76adb425ac21"
EXPECTED_IDS=("use_case","native_task","start_scan","task_loop","vision","embodied","skeleton","entry","finish")
EXPECTED_STARTS=(.8,30.5,48.5,72.8,112.8,152.8,192.8,233,267)
def values(obj,key):
 if isinstance(obj,dict):
  for k,v in obj.items():
   if k==key:yield v
   yield from values(v,key)
 elif isinstance(obj,list):
  for v in obj:yield from values(v,key)
def verify_timeline(path):
 data=json.loads(path.read_text());rows=data.get("clips",[])
 if tuple(c.get("id") for c in rows)!=EXPECTED_IDS:raise ValueError("Nine expected real narration sources required")
 checked=[];provenances={}
 for i,c in enumerate(rows):
  p=inside(c["file"],True);digest=sha(p)
  if c.get("sha256") and c["sha256"]!=digest:raise ValueError("Narration source SHA changed")
  with wave.open(str(p)) as w:
   rate=w.getframerate();channels=w.getnchannels();width=w.getsampwidth();duration=w.getnframes()/rate;raw=w.readframes(w.getnframes())
  if channels!=1 or rate!=48000 or width!=2 or not raw:raise ValueError("Actual48kmono PCM16 voice clip required")
  pcm=np.frombuffer(raw,dtype="<i2")
  if not np.any(pcm):raise ValueError("Silent narration source")
  start=float(c.get("start_seconds",c.get("start")))
  end_limit=EXPECTED_STARTS[i+1] if i+1<len(EXPECTED_STARTS) else 299
  if abs(start-EXPECTED_STARTS[i])>.001 or duration<=0 or start+duration>end_limit+.001:raise ValueError("Actual voice clip outside approved chronological scene window")
  if c.get("duration_seconds") is not None and abs(float(c["duration_seconds"])-duration)>1/rate:raise ValueError("Wrong actual source duration metadata")
  source=c.get("source",{})
  pp=inside(source["provenance_file"],True);pd=json.loads(pp.read_text())
  if source.get("provenance_sha256") and source["provenance_sha256"]!=sha(pp):raise ValueError("Voice provenance SHA changed")
  if "09" not in [str(v) for v in values(pd,"selected_voice_id")] or REF09_SHA not in list(values(pd,"reference_sha256")):raise ValueError("All clips must bind selected09synthetic reference provenance")
  provenances[str(pp)]=bind(pp)
  checked.append({"id":c["id"],"source":bind(p),"actual_start_seconds":start,"actual_duration_seconds":duration,"actual_end_seconds":start+duration,"scene_limit_seconds":end_limit,"provenance":bind(pp)})
 bg=data.get("background",{});bp=inside(bg["file"],True)
 if sha(bp)!="bb8386120d08445ca1fc96d9be26f0cb45fd08fe6a0be21a5ecd4b311c76ed82" or float(bg.get("gain_db",0))!=-28:raise ValueError("Preserve actual original ambient background at-28dB")
 return {"nine_sources":checked,"common_selected_voice":"09","synthetic_reference_sha256":REF09_SHA,"provenances":list(provenances.values()),"background":bind(bp),"background_gain_db":-28}
def check_srt(srt):
 text=srt.read_text()
 forbidden=re.findall(r"(?:\d+(?:\.\d+)?\s*[×xX倍]|创新点|设计路线|焰境智巡|EmberScout)",text)
 stamps=re.findall(r"(?m)^(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})",text)
 def ms(t):
  h,m,s=t.split(":");s,k=s.split(",");return int(h)*3600000+int(m)*60000+int(s)*1000+int(k)
 ranges=[(ms(a),ms(b)) for a,b in stamps]
 passed=bool(ranges) and not forbidden and all(0<=a<b<=300001 for a,b in ranges) and all(a[1]<=b[0] for a,b in zip(ranges,ranges[1:]))
 return {"source":bind(srt),"cue_count":len(ranges),"prohibited_matches":forbidden,"ordered_and_nonoverlapping":passed,"scope":"Caption times/text checked; actual rendered clause timing must be verified against the same new timeline/render provenance."}
def audio_and_mix_qa(new,silent,logdir):
 mod=importlib.util.spec_from_file_location("actual_voice09_packet_qa",ROOT/"scripts/demo-video/validate-final-mix.py")
 qa=importlib.util.module_from_spec(mod);mod.loader.exec_module(qa)
 np_,sp=qa.probe(new),qa.probe(silent)
 nv=[s for s in np_["streams"] if s.get("codec_type")=="video"][0];sv=[s for s in sp["streams"] if s.get("codec_type")=="video"][0]
 packet=qa.compare_packet_content(qa.packets(silent,"v:0"),qa.packets(new,"v:0"),sv["time_base"],nv["time_base"])
 packet["extradata_exact"]=bool(sv.get("extradata_hash") and sv.get("extradata_hash")==nv.get("extradata_hash"))
 audio=[s for s in np_["streams"] if s.get("codec_type")=="audio"]
 spec=len(audio)==1 and audio[0].get("codec_name")=="aac" and audio[0].get("sample_rate")=="48000" and audio[0].get("channels")==2 and abs(float(np_["format"]["duration"])-300)<.08
 decode=call([BIN/"ffmpeg","-nostdin","-hide_banner","-v","warning","-threads","4","-i",new,"-map","0:v:0","-map","0:a:0","-sn","-f","null","-"])
 dl=logdir/"complete-new-av-decode.log";dl.write_text(decode.stdout+decode.stderr)
 ar=call([BIN/"ffmpeg","-nostdin","-hide_banner","-v","info","-i",new,"-map","0:a:0","-vn","-sn","-af","astats=metadata=0:reset=0","-f","null","-"])
 al=logdir/"new-audio-astats.log";al.write_text(ar.stdout+ar.stderr);overall=ar.stderr.rsplit("Overall",1)[-1]
 def stat(k):
  match=re.search(re.escape(k)+r":\s*([^\r\n]+)",overall)
  if not match:return None
  try:return float(match[1].strip())
  except ValueError:return None
 rms,peak=stat("RMS level dB"),stat("Peak level dB");nan,inf=stat("Number of NaNs"),stat("Number of Infs")
 amplitude=all(isinstance(v,(int,float)) and math.isfinite(v) for v in [rms,peak,nan,inf]) and rms>-60 and peak<0 and nan==inf==0
 return {"silent_source":bind(silent),"video_packet_copy":packet,"AAC48k_stereo300s":spec,"complete_AV_decode_warning_free":not decode.stderr.strip(),"decode_log":bind(dl),"audio_RMS_dBFS":rms,"audio_peak_dBFS":peak,"audio_finite_non_silent_below_fullscale":amplitude,"audio_log":bind(al),"passed":spec and packet["content_and_display_preserved"] and packet["extradata_exact"] and not decode.stderr.strip() and amplitude}
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 for name in ("reference","candidate","silent","preencode-audit","timeline","report"):ap.add_argument("--"+name,required=True)
 args=ap.parse_args()
 ref=inside(args.reference,True);new=inside(args.candidate,True);silent=inside(args.silent,True);audit=inside(args.preencode_audit,True);timeline=inside(args.timeline,True);report=inside(args.report)
 if ref==new or new==silent or report.exists():raise ValueError("Distinct real source/candidate/silent and new report required")
 if sha(ref)!=V3_SHA:raise ValueError("Use exact immutable approved v3 source")
 ad=json.loads(audit.read_text())
 if ad.get("source_active_sha256")!=V3_SHA:raise ValueError("Preencode source binding wrong")
 preencode=ad.get("full_frame_count")==3255 and ad.get("pip_frame_count")==4770 and ad.get("full_ui_rois")==[[0,0,W,976],[0,1054,W,26]]
 for name in ("full_ui","pip"):
  a=ad.get(name+"_input_sha256");b=ad.get(name+"_reference_sha256");preencode=preencode and bool(a and re.fullmatch("[a-f0-9]{64}",a) and a==b)
 rp,np_=probe(ref),probe(new)
 spec=all(len([s for s in p["streams"] if s["codec_type"]=="video"])==1 and any(s.get("codec_type")=="video" and s.get("codec_name")=="h264" and s.get("width")==W and s.get("height")==H and s.get("nb_frames")=="9000" and s.get("avg_frame_rate")=="30/1" for s in p["streams"]) and abs(float(p["format"]["duration"])-300)<.08 for p in (rp,np_))
 audio_changed=audio_signature(ref)!=audio_signature(new)
 narration=verify_timeline(timeline)
 srt=new.with_suffix(".zh-CN.srt");captions=check_srt(srt)
 report.parent.mkdir(parents=True,exist_ok=True);logdir=report.with_suffix(".logs")
 if logdir.exists():raise ValueError("New objective log directory required")
 logdir.mkdir()
 pixels=compare_pixels(ref,new,logdir)
 independent=ad.get("full_ui_reference_sha256")==pixels["full_recorded_view"]["reference_decoded_ordered_pixel_sha256"] and ad.get("pip_reference_sha256")==pixels["recorded_inset"]["reference_decoded_ordered_pixel_sha256"]
 preencode=preencode and independent
 for key in pixels:pixels[key]["SSIM"]=ssim(ref,new,key,logdir)
 no_warnings=all(not (logdir/n).read_text().strip() for n in ("reference-decode.log","candidate-decode.log"))
 mix=audio_and_mix_qa(new,silent,logdir)
 passed=spec and audio_changed and preencode and no_warnings and captions["ordered_and_nonoverlapping"] and mix["passed"] and all(q["passed_codec_tolerance"] and q["SSIM"]["passed_codec_tolerance"] for q in pixels.values())
 result={"kind":"ACTUAL_VOICE09_TITLE_V4_MEDIA_SOURCE_PRESERVATION_AND_AUDIO_QA","generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"passed":passed,"reference":bind(ref),"candidate":bind(new),"preencode_audit":bind(audit),"preencode_inputs_exact":preencode,"preencode_reference_independently_decoded_and_hash_verified":independent,"geometry_fps_duration_verified":spec,"source_voice09_timeline":bind(timeline),"narration":narration,"new_audio_differs_from_previous_Serena":audio_changed,"silent_to_final_picture_and_new_audio":mix,"captions":captions,"pixel_comparisons":pixels,"picture_decode_warning_free":no_warnings,"allowed_postproduction_subtitle_band_exclusive_xyxy":[0,976,W,1054],"protected_full_UI_pixel_regions_exclusive_xyxy":[[0,0,W,976],[0,1054,W,H]],"selected_ranges":{"full_recorded_view_frames":FULL_RANGES,"recorded_inset_frames":PIP_RANGE,"inset_rectangle_exclusive_xyxy":PIP},"scope":"Read-only actual picture/source and audio/timeline verification. Human actual-frame and subjective speaker/intelligibility review remain independent; no robot commands or publication."}
 report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"passed":passed,"report":str(report.relative_to(ROOT)),"report_sha256":sha(report),"preencode_inputs_exact":preencode,"audio_new":audio_changed,"mix_passed":mix["passed"],"pixel_comparisons":pixels},ensure_ascii=False))
 if not passed:sys.exit(1)
if __name__=="__main__":main()
