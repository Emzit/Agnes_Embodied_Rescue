#!/usr/bin/env python3
"""Offline recorded-unit Ekho9.0 narration, project-local files only."""
import argparse,datetime,hashlib,json,os,re,subprocess,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/"artifacts/demo-video-20261013/assets"
EKHO=ASSETS/"ekho-9.0";SRC=EKHO/"src/hgneng-ekho-796241e"
BIN=EKHO/"install/ekho-offline";PIX=ROOT/"runtime/ros2-jazzy/.pixi/envs/default"
SAMPLE=ASSETS/"narration/ekho9-voice-sample/sample-provenance.json"
def inside(value,exists=False):
 p=Path(value);p=(ROOT/p).resolve() if not p.is_absolute() else p.resolve()
 if p!=ROOT and ROOT not in p.parents:raise ValueError("Path outside authorized workspace")
 if exists and not p.is_file():raise ValueError("Missing file:"+str(p))
 return p
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def duration(p):
 with wave.open(str(p)) as f:return f.getnframes()/f.getframerate()
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument("--plan",required=True);ap.add_argument("--out",required=True)
 ap.add_argument("--speed-delta",type=int,default=0)
 ap.add_argument("--sample-approved",action="store_true",help="Require actual user feedback that this Ekho sample is clear and understandable")
 ap.add_argument("--check",action="store_true",help="Read-only validation; does not synthesize")
 args=ap.parse_args()
 if not -20<=args.speed_delta<=20:raise ValueError("Keep tempo close to sample; shorten wording before large speed changes")
 planfile=inside(args.plan,True);out=inside(args.out)
 if ASSETS/"narration" not in out.parents:raise ValueError("Output must be a new narration asset directory")
 if out.exists():raise ValueError("Refusing to overwrite or reuse output directory")
 plan=json.loads(planfile.read_text());segs=plan["segments"]
 build=json.loads(inside(EKHO/"build-provenance.json",True).read_text())
 sample=json.loads(inside(SAMPLE,True).read_text())
 if build.get("source_tag")!="v9.0" or build.get("source_commit")!="796241e" or build.get("offline_only_macro")!="EKHO_OFFLINE_RECORDINGS_ONLY=1":raise ValueError("Require audited offline-only pinned9.0 build")
 if sha(inside(BIN,True))!=build.get("binary_sha256"):raise ValueError("Binary changed since build audit")
 for x in sample["voice_source_files"]:
  if sha(inside(x["path"],True))!=x["sha256"]:raise ValueError("Voice data/license changed since sample")
 names=set();end=0
 for s in segs:
  text=s.get("speech_text",s["text"]);name=s["id"]
  if not re.fullmatch("[a-z][a-z0-9_]*",name) or name in names:raise ValueError("Invalid/duplicate clip ID")
  names.add(name)
  if not text.strip() or re.search("[A-Za-z0-9<>]",text):raise ValueError("Use Chinese names/numbers, no English fallback or SSML")
  if not 0<=s["start"]<s["end"]<=300 or s["start"]<end:raise ValueError("Invalid/overlapping window")
  end=s["end"]
 if args.check:
  print(json.dumps({"check":True,"segments":len(segs),"engine":"Ekho9.0 offline/Yali Mandarin recorded units","speed_delta":args.speed_delta,"synthesis":False,"sample_approved":args.sample_approved},ensure_ascii=False));return
 if not args.sample_approved:raise ValueError("Wait for explicit clear/understandable Ekho listening feedback; then pass --sample-approved")
 out.mkdir(parents=True)
 notices=[]
 for name,p in [("COPYING-ekho-engine-GPL2plus.txt",SRC/"COPYING"),("COPYING-mandarin-yali-GPL2.txt",SRC/"ekho-data/pinyin/COPYING-mandarin-yali")]:
  f=out/name;f.write_bytes(inside(p,True).read_bytes());notices.append({"path":str(f.relative_to(ROOT)),"sha256":sha(f)})
 env=dict(os.environ);env.update({"EKHO_DATA_PATH":str(SRC/"ekho-data"),"TMPDIR":str(EKHO/"tmp"),"TMP":str(EKHO/"tmp"),"TEMP":str(EKHO/"tmp"),"LD_LIBRARY_PATH":str(PIX/"lib")+":"+str(ASSETS/"espeak-ng/install/usr/lib/x86_64-linux-gnu")})
 records=[];clips=[]
 for s in segs:
  name=s["id"];text=s.get("speech_text",s["text"])
  txt=out/(name+".txt");raw=out/(name+"-raw.wav");wav=out/(name+".wav");txt.write_text(text)
  cmd=[str(BIN),"-v","Mandarin","-s",str(args.speed_delta),"-p","0","-a","0","-f",str(txt),"-o",str(raw),"-t","wav"]
  process=subprocess.run(cmd,env=env,cwd=SRC,capture_output=True,text=True,check=True,timeout=120)
  (out/(name+"-run.log")).write_text(process.stdout+"\n"+process.stderr)
  subprocess.run([str(PIX/"bin/ffmpeg"),"-nostdin","-hide_banner","-loglevel","error","-n","-i",str(raw),"-af","highpass=f=60,loudnorm=I=-18:TP=-2:LRA=7","-ar","48000","-ac","1","-c:a","pcm_s16le",str(wav)],capture_output=True,text=True,check=True)
  dur=duration(wav);fits=dur<=s["end"]-s["start"]-.3
  r={"id":name,"path":str(wav.relative_to(ROOT)),"sha256":sha(wav),"duration_seconds":dur,"text":s["text"],"speech_text":text,"speech_text_sha256":sha(txt),"raw_file":str(raw.relative_to(ROOT)),"raw_sha256":sha(raw),"raw_duration_seconds":duration(raw),"start":s["start"],"window_end":s["end"],"fits_window":fits,"command":cmd,"processing":"60Hz highpass/loudnorm-18LUFS/-2dBTP/7LRA;48k monoPCM16; no pitch change or external audio timestretch"}
  records.append(r)
  clips.append({"id":name,"start":s["start"],"file":r["path"],"sha256":r["sha256"],"gain_db":0,"text":s["text"],"source":{"kind":"offline_recorded_unit_concatenation","description":"Original Chinese project narration from Yali Cheng Mandarin recorded phonetic units through pinned offline-only Ekho9.0. No neural model or cloud/server call. GPL voice/engine notices retained.","provenance_file":str((out/"audio-provenance.json").relative_to(ROOT))}})
  print(json.dumps({"id":name,"duration_seconds":round(dur,3),"window_seconds":s["end"]-s["start"],"fits":fits},ensure_ascii=False),flush=True)
 provenance={"version":1,"created_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"kind":"offline_recorded_unit_concatenation","engine":"Ekho9.0","source_tag":"v9.0","source_commit":"796241e","voice":"Mandarin/Yali Cheng recorded phonetic units","voice_license":"GPLv2;COPYING-mandarin-yali retained and credited","engine_license":"GPLv2-or-later; offline modified source and original archive retained","source_provenance_file":str((EKHO/"official-source-provenance.json").relative_to(ROOT)),"build_provenance_file":str((EKHO/"build-provenance.json").relative_to(ROOT)),"sample_provenance_file":str(SAMPLE.relative_to(ROOT)),"input_plan":str(planfile.relative_to(ROOT)),"input_plan_sha256":sha(planfile),"sample_listening_accepted_flag":True,"model_calls":0,"cloud_calls":0,"server_mode":False,"english_synthesizers":False,"speed_delta_percent":args.speed_delta,"pitch_delta_percent":0,"volume_delta_percent":0,"license_notices":notices,"records":records,"fits_all_windows":all(x["fits_window"] for x in records),"quality_review":"Sample acceptance asserted by caller. Full mixed film still needs listening review; PCM/hash/codec checks do not prove intelligibility."}
 (out/"audio-provenance.json").write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+"\n")
 cues={"version":1,"clips":clips}
 if plan.get("background"):cues["background"]=plan["background"]
 (out/"narration-cues-ekho-300s.json").write_text(json.dumps(cues,ensure_ascii=False,indent=2)+"\n")
 print("CUE_CONTRACT "+str(out/"narration-cues-ekho-300s.json"))
 if not provenance["fits_all_windows"]:raise SystemExit("Shorten wording/new output before mixing: one or more clips exceed window")
if __name__=="__main__":main()
