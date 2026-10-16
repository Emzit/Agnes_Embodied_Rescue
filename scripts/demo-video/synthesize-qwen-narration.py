#!/usr/bin/env python3
"""Generate authorized, accepted Qwen Serena postproduction narration into a new directory."""
from pathlib import Path
import argparse,runpy,json,time,subprocess,datetime,re
ROOT=Path(__file__).resolve().parents[2]
support=runpy.run_path(str(ROOT/"scripts/demo-video/synthesize-qwen-narration-sample.py"),run_name="qwen_sample_support")
BASE=support["BASE"];torch=support["torch"];sf=support["sf"];Qwen3TTSModel=support["Qwen3TTSModel"];sha=support["sha"]
def duration(p):
 data,sr=sf.read(str(p),always_2d=False);return len(data)/sr
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--plan",default="artifacts/demo-video-20261013/assets/narration/narration-plan-v8-qwen-serena.json")
 ap.add_argument("--out",default="artifacts/demo-video-20261013/assets/narration/clips-v8-qwen-serena")
 ap.add_argument("--only",help="Comma-separated clip IDs, for a new retained retry output")
 args=ap.parse_args()
 planfile=(ROOT/args.plan).resolve();out=(ROOT/args.out).resolve()
 if ROOT not in planfile.parents or ROOT/"artifacts/demo-video-20261013/assets/narration" not in out.parents:raise ValueError("Paths must remain in narration workspace")
 if out.exists():raise ValueError("Refusing to overwrite old audio or attempt")
 plan=json.loads(planfile.read_text())
 auth=ROOT/plan["authorization_file"];accept=ROOT/plan["sample_acceptance_file"]
 a=json.loads(auth.read_text());accepted=json.loads(accept.read_text())
 samplefile=BASE/"output/sample-serena-v1/sample-provenance.json";sample=json.loads(samplefile.read_text())
 if a.get("authorized") is not True or accepted.get("accepted") is not True or accepted["sample_sha256"]!=sample["mp3"]["sha256"]:raise ValueError("Need scoped permission and acceptance bound to this Serena sample")
 if sha(ROOT/sample["mp3"]["path"])!=accepted["sample_sha256"]:raise ValueError("Accepted sample changed")
 modelprov=BASE/"model-download-provenance.json";m=json.loads(modelprov.read_text());modelpath=ROOT/m["model_path"]
 for f in m["files"]:
  if sha(modelpath/f["file"])!=f["sha256"]:raise ValueError("Model SHA changed")
 wanted=set(args.only.split(",")) if args.only else None
 segs=[s for s in plan["segments"] if wanted is None or s["id"] in wanted]
 if wanted and wanted!={s["id"] for s in segs}:raise ValueError("Unknown selected IDs")
 for s in segs:
  if re.search("[A-Za-z0-9<>]",s["speech_text"]):raise ValueError("Narration uses Chinese pronunciation names only")
 out.mkdir(parents=True)
 print("LOADING_MODEL",modelpath,flush=True)
 model=Qwen3TTSModel.from_pretrained(str(modelpath),device_map="cuda:0",dtype=torch.bfloat16,attn_implementation="eager",local_files_only=True)
 records=[];clips=[]
 for n,s in enumerate(segs):
  name=s["id"];attempt=out/"attempts"/name/"attempt-01";attempt.mkdir(parents=True)
  text=s["speech_text"];(attempt/"speech.txt").write_text(text)
  raw=attempt/"raw.wav";wav=attempt/"voice.wav";mp3=attempt/"preview.mp3"
  torch.manual_seed(20261014+n);start=time.time()
  print("GENERATING",name,len(text),flush=True)
  wavs,sr=model.generate_custom_voice(text=text,language="Chinese",speaker="Serena",max_new_tokens=1024)
  generation_seconds=time.time()-start;sf.write(str(raw),wavs[0],sr,subtype="PCM_16")
  ff=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg"
  subprocess.run([str(ff),"-nostdin","-hide_banner","-loglevel","error","-n","-i",str(raw),"-af","highpass=f=60,loudnorm=I=-18:TP=-2:LRA=7","-ar","48000","-ac","1","-c:a","pcm_s16le",str(wav)],check=True)
  subprocess.run([str(ff),"-nostdin","-hide_banner","-loglevel","error","-n","-i",str(wav),"-c:a","libmp3lame","-b:a","128k",str(mp3)],check=True)
  dur=duration(wav);rawdur=len(wavs[0])/sr;fits=dur<=s["end"]-s["start"]-.3
  rec={"id":name,"attempt":"attempt-01","text":s["text"],"speech_text":text,"speech_text_sha256":sha(attempt/"speech.txt"),"start":s["start"],"window_end":s["end"],"duration_seconds":dur,"raw_duration_seconds":rawdur,"generation_seconds":generation_seconds,"fits_window":fits,"spare_seconds":s["end"]-s["start"]-dur,"wav":{"path":str(wav.relative_to(ROOT)),"sha256":sha(wav),"bytes":wav.stat().st_size},"mp3":{"path":str(mp3.relative_to(ROOT)),"sha256":sha(mp3),"bytes":mp3.stat().st_size},"raw":{"path":str(raw.relative_to(ROOT)),"sha256":sha(raw),"bytes":raw.stat().st_size},"audio_timestretch":False,"strong_tail_cut":False,"processing":"60Hz highpass and -18LUFS/-2dBTP/7LRA loudness normalization;48kmono PCM16;no time/pitch change"}
  (attempt/"attempt-provenance.json").write_text(json.dumps(rec,ensure_ascii=False,indent=2)+"\n")
  records.append(rec)
  clips.append({"id":name,"start":s["start"],"file":rec["wav"]["path"],"sha256":rec["wav"]["sha256"],"gain_db":0,"text":s["text"],"source":{"kind":"local_neural_tts_postproduction","description":"User-approved Serena Mandarin preset from locally executed Qwen3-TTS0.6B CustomVoice, only for video narration. No reference voice/clone or remote synthesis API; explicit scoped exception to core Agnes-only rule.","provenance_file":str((out/"audio-provenance.json").relative_to(ROOT))}})
  print("COMPLETE",json.dumps({"id":name,"duration":round(dur,3),"window":round(s["end"]-s["start"],3),"fits":fits,"generation_seconds":round(generation_seconds,3)},ensure_ascii=False),flush=True)
 provenance={"version":1,"created_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"kind":"local_neural_tts_postproduction","model":"Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice","components":["0.6BCustomVoice","bundled12Hzspeech tokenizer/decoder"],"voice":"Serena","language":"Chinese","reference_voice":False,"voice_clone":False,"attention":"eager","dtype":"torch.bfloat16","physical_gpu":1,"model_provenance":{"file":str(modelprov.relative_to(ROOT)),"sha256":sha(modelprov)},"dependency_provenance":{"file":"artifacts/demo-video-20261013/assets/qwen3-tts/dependency-install-report.json","sha256":sha(BASE/"dependency-install-report.json")},"license_notice":{"file":"artifacts/demo-video-20261013/assets/qwen3-tts/source/LICENSE-Apache-2.0.txt","sha256":sha(BASE/"source/LICENSE-Apache-2.0.txt"),"license":"Apache-2.0 officialQwen code/weights"},"authorization":{"file":str(auth.relative_to(ROOT)),"sha256":sha(auth),"human_confirmation":a["human_confirmation"]},"sample_acceptance":{"file":str(accept.relative_to(ROOT)),"sha256":sha(accept),"human_confirmation":accepted["human_confirmation"],"accepted_sample_sha256":accepted["sample_sha256"]},"input_plan":{"file":str(planfile.relative_to(ROOT)),"sha256":sha(planfile)},"records":records,"all_fit":all(r["fits_window"] for r in records),"generate_custom_voice_calls":len(records),"cloud_text_upload":False,"remote_model_calls":0,"robot_runtime_changes":False,"audio_timestretch":False,"start_shift_seconds":0,"sample_human_listening_accepted":True,"full_movie_listening_review":"Pending root mixed-film listening review"}
 (out/"audio-provenance.json").write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+"\n")
 cues={"version":1,"clips":clips,"background":plan["background"]}
 (out/"narration-cues-qwen-300s.json").write_text(json.dumps(cues,ensure_ascii=False,indent=2)+"\n")
 print("FULL_RESULT",json.dumps({"out":str(out.relative_to(ROOT)),"clip_count":len(records),"all_fit":provenance["all_fit"],"cue_contract":str((out/"narration-cues-qwen-300s.json").relative_to(ROOT))},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
