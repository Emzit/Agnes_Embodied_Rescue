#!/usr/bin/env python3
"""One authorized local Qwen3-TTS sample for postproduction only; no robot or cloud model calls."""
from pathlib import Path
import os,json,hashlib,time,subprocess
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/"artifacts/demo-video-20261013/assets/qwen3-tts"
for name in ["torch","numba","cuda","triton","gradio","matplotlib"]:
 (BASE/"hf-cache"/name).mkdir(parents=True,exist_ok=True)
os.environ.update({"HF_HOME":str(BASE/"hf-cache"),"HF_HUB_CACHE":str(BASE/"hf-cache/hub"),"TRANSFORMERS_CACHE":str(BASE/"hf-cache/transformers"),"TORCHINDUCTOR_CACHE_DIR":str(BASE/"hf-cache/torchinductor"),"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1","HF_HUB_DISABLE_TELEMETRY":"1","XDG_CACHE_HOME":str(BASE/"hf-cache"),"TORCH_HOME":str(BASE/"hf-cache/torch"),"NUMBA_CACHE_DIR":str(BASE/"hf-cache/numba"),"CUDA_CACHE_PATH":str(BASE/"hf-cache/cuda"),"TRITON_CACHE_DIR":str(BASE/"hf-cache/triton"),"GRADIO_TEMP_DIR":str(BASE/"hf-cache/gradio"),"MPLCONFIGDIR":str(BASE/"hf-cache/matplotlib"),"TMPDIR":str(BASE/"tmp"),"TMP":str(BASE/"tmp"),"TEMP":str(BASE/"tmp"),"CUDA_VISIBLE_DEVICES":"1","OMP_NUM_THREADS":"4","TOKENIZERS_PARALLELISM":"false","PYTHONDONTWRITEBYTECODE":"1"})
import torch,soundfile as sf
from qwen_tts import Qwen3TTSModel
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
def main():
 auth=ROOT/"artifacts/demo-video-20261013/revision-v3/neural-narration-authorization.json"
 allowed=json.loads(auth.read_text())
 if allowed.get("authorized") is not True or allowed.get("scope")!="Video post-production narration only":raise ValueError("Need explicit scoped narration authorization")
 provenance=BASE/"model-download-provenance.json";m=json.loads(provenance.read_text())
 modelpath=ROOT/m["model_path"]
 for f in m["files"]:
  if sha(modelpath/f["file"])!=f["sha256"]:raise ValueError("Model checksum changed:"+f["file"])
 out=BASE/"output/sample-serena-v1";out.mkdir(exist_ok=True)
 wav=out/"qwen3-serena-mandarin.wav";mp3=out/"qwen3-serena-mandarin.preview.mp3"
 if wav.exists() or mp3.exists():raise ValueError("Refusing to overwrite existing sample")
 text="这是一套室内火灾人员搜寻系统。我们向艾格尼斯发送任务，机器人随后观察环境、识别房门，并调用导航与开门工具。发现人员后，它会从不同视角再次核查，最后停止并报告目标位置。"
 (out/"speech.txt").write_text(text)
 torch.manual_seed(20261014);started=time.time()
 print("LOADING_LOCAL_MODEL",modelpath,flush=True)
 model=Qwen3TTSModel.from_pretrained(str(modelpath),device_map="cuda:0",dtype=torch.bfloat16,attn_implementation="eager",local_files_only=True)
 print("LOADED",round(time.time()-started,2),"CUDA",torch.version.cuda,"DEVICE",torch.cuda.get_device_name(0),flush=True)
 print("SPEAKERS",model.get_supported_speakers(),flush=True)
 generation_start=time.time()
 # 0.6B supports predefined voices but not instruction control; do not claim an ignored instruction worked.
 wavs,sr=model.generate_custom_voice(text=text,language="Chinese",speaker="Serena",max_new_tokens=1024)
 sf.write(str(wav),wavs[0],sr,subtype="PCM_16")
 elapsed=time.time()-generation_start;duration=len(wavs[0])/sr
 ffmpeg=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg"
 subprocess.run([str(ffmpeg),"-nostdin","-hide_banner","-loglevel","error","-n","-i",str(wav),"-c:a","libmp3lame","-b:a","128k",str(mp3)],check=True)
 report={"version":1,"kind":"local_neural_tts","purpose":"Video postproduction narration only","model":"Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice","model_components":["0.6B CustomVoice generator","bundled12Hz speech tokenizer/decoder"],"voice_preset":"Serena","language":"Chinese","requires_reference_audio":False,"voice_cloning":False,"text":text,"style_target":"标准普通话、字音清晰、自然技术讲解、适中语速、不夸张情绪","instruction_control":"0.6B does not support instructions. Target style is a listening acceptance goal; no instruction effect claimed.","attention":"eager","dtype":"torch.bfloat16","physical_gpu_index":1,"device":torch.cuda.get_device_name(0),"torch_version":torch.__version__,"cuda_version":torch.version.cuda,"generation_seconds":elapsed,"duration_seconds":duration,"sample_rate":sr,"wav":{"path":str(wav.relative_to(ROOT)),"sha256":sha(wav),"bytes":wav.stat().st_size},"mp3":{"path":str(mp3.relative_to(ROOT)),"sha256":sha(mp3),"bytes":mp3.stat().st_size},"authorization":{"file":str(auth.relative_to(ROOT)),"sha256":sha(auth),"human_confirmation":allowed["human_confirmation"]},"model_provenance":{"file":str(provenance.relative_to(ROOT)),"sha256":sha(provenance)},"dependency_provenance_file":"artifacts/demo-video-20261013/assets/qwen3-tts/dependency-install-report.json","license":"Apache-2.0 for official Qwen3-TTS code and weights; source license and modelcard preserved","generate_custom_voice_calls":1,"remote_model_calls":0,"cloud_text_upload":False,"robot_runtime_changes":False,"audio_timestretch":False,"full_narration_synthesized":False,"quality_status":"ACTUAL_USER_LISTENING_REQUIRED; successful generation/PCM checks do not prove naturalness or intelligibility"}
 (out/"sample-provenance.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
if __name__=="__main__":main()
