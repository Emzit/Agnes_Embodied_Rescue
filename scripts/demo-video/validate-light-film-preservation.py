#!/usr/bin/env python3
"""Read-only media preservation QA for the bright animation revision."""
import argparse, datetime, hashlib, json, math, re, struct, subprocess, sys
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
   if selected=="recorded_inset":
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
 if kind=="full_recorded_view":
  common="select='between(n,915,2159)+between(n,6990,8999)',setpts=N/(30*TB),format=yuv444p"
 else:
  common="trim=start_frame=2190:end_frame=6960,setpts=N/(30*TB),format=rgb24,crop=422:221:950:213,format=yuv444p"
 stats=logdir/(kind+"-ssim-frames.txt")
 graph="[0:v]"+common+"[a];[1:v]"+common+"[b];[a][b]ssim=stats_file="+str(stats)+"[out]"
 r=call([BIN/"ffmpeg","-nostdin","-hide_banner","-v","info","-threads","4","-i",reference,"-threads","4","-i",candidate,"-filter_complex_threads","2","-filter_complex",graph,"-map","[out]","-an","-sn","-f","null","-"])
 (logdir/(kind+"-ssim.log")).write_text(r.stdout+r.stderr)
 matches=re.findall(r"SSIM[^\r\n]*All:([0-9.]+)",r.stderr)
 if not matches:raise RuntimeError("No complete SSIM result")
 value=float(matches[-1])
 return {"mean_YUV444_SSIM":value,"passed_codec_tolerance":value>=.98,"actual_per_frame_stats":str(stats.relative_to(ROOT)),"stats_sha256":sha(stats)}
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument("--reference",required=True);ap.add_argument("--candidate",required=True)
 ap.add_argument("--preencode-audit",required=True);ap.add_argument("--report",required=True)
 args=ap.parse_args()
 ref=inside(args.reference,True);new=inside(args.candidate,True);audit=inside(args.preencode_audit,True);report=inside(args.report)
 if ref==new or report.exists():raise ValueError("Distinct reference/candidate and new report required")
 ad=json.loads(audit.read_text());refsha=sha(ref)
 if ad.get("source_active_sha256")!=refsha:raise ValueError("Preencode audit must bind the exact active reference")
 expected_counts={"full_frame_count":3255,"pip_frame_count":4770}
 preencode=all(ad.get(k)==v for k,v in expected_counts.items())
 for name in ("full_frame","pip"):
  a=ad.get(name+"_input_sha256");b=ad.get(name+"_reference_sha256")
  preencode=preencode and bool(a and re.fullmatch("[a-f0-9]{64}",a) and a==b)
 rp,np=probe(ref),probe(new)
 spec=all(len([s for s in p["streams"] if s["codec_type"]=="video"])==1 and any(s.get("codec_type")=="video" and s.get("codec_name")=="h264" and s.get("width")==W and s.get("height")==H and s.get("nb_frames")=="9000" and s.get("avg_frame_rate")=="30/1" for s in p["streams"]) and abs(float(p["format"]["duration"])-300)<.08 for p in (rp,np))
 audio_ref=audio_signature(ref);audio_new=audio_signature(new)
 audio_exact=audio_ref==audio_new
 report.parent.mkdir(parents=True,exist_ok=True);logdir=report.with_suffix(".logs")
 if logdir.exists():raise ValueError("Use a new objective log directory")
 logdir.mkdir()
 pixels=compare_pixels(ref,new,logdir)
 independent_preencode_reference_match=ad.get("full_frame_reference_sha256")==pixels["full_recorded_view"]["reference_decoded_ordered_pixel_sha256"] and ad.get("pip_reference_sha256")==pixels["recorded_inset"]["reference_decoded_ordered_pixel_sha256"]
 preencode=preencode and independent_preencode_reference_match
 for key in pixels:pixels[key]["SSIM"]=ssim(ref,new,key,logdir)
 warning_logs=[logdir/"reference-decode.log",logdir/"candidate-decode.log"]
 no_decode_warnings=all(not p.read_text().strip() for p in warning_logs)
 passed=spec and audio_exact and preencode and no_decode_warnings and all(q["passed_codec_tolerance"] and q["SSIM"]["passed_codec_tolerance"] for q in pixels.values())
 result={"kind":"ACTUAL_BRIGHT_REVISION_RECORDED_MEDIA_PRESERVATION_QA","generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"passed":passed,"reference":bind(ref),"candidate":bind(new),"preencode_audit":bind(audit),"preencode_inputs_exact":preencode,"preencode_reference_independently_decoded_and_hash_verified":independent_preencode_reference_match,"geometry_fps_duration_verified":spec,"original_audio_entire_encoded_packet_and_clock_signature_exact":audio_exact,"audio_packets":len(audio_ref["packets"]),"pixel_comparisons":pixels,"decode_warning_free":no_decode_warnings,"scope":"Existing Agnes dialogue, recorded demonstration frames and chronological inset only. Animation rendering, source route, model actions and subjective narration quality are outside this read-only comparison.","codec_tolerances":{"mean_RGB_PSNR_dB_at_least":35,"every_frame_RGB_PSNR_dB_at_least":30,"mean_YUV444_SSIM_at_least":.98},"selected_ranges":{"full_recorded_view_frames":FULL_RANGES,"recorded_inset_frames":PIP_RANGE,"inset_rectangle_exclusive_xyxy":PIP}}
 report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"passed":passed,"report":str(report.relative_to(ROOT)),"report_sha256":sha(report),"audio_exact":audio_exact,"pixel_comparisons":pixels},ensure_ascii=False))
 if not passed:sys.exit(1)
if __name__=="__main__":main()
