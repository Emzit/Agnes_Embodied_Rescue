"""Reuse approved synthetic voice09. English letters are generated in English.
Only the three requested narration passages change; no robot model is called.
"""
from pathlib import Path
import runpy,json,time,subprocess,hashlib,datetime
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-autonomous-v12/voice'
assert Path.cwd()==ROOT
support=runpy.run_path(str(ROOT/'scripts/demo-video/synthesize-qwen-narration-sample.py'),run_name='tts_support')
torch=support['torch'];sf=support['sf'];Qwen3TTSModel=support['Qwen3TTSModel'];sha=support['sha']
import numpy as np
plan=json.loads((ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/voice/narration-plan-AGH-v9.json').read_text());auth=json.loads((ROOT/plan['authorization_file']).read_text());assert auth['authorized'] and auth['scope']=='Video post-production narration only'
assert sha(ROOT/plan['voice_reference_file'])==plan['voice_reference_sha256'];assert sha(ROOT/plan['saved_voice_prompt'])==plan['saved_voice_prompt_sha256']
prov=json.loads((ROOT/plan['source_model_provenance_file']).read_text());modelpath=ROOT/prov['model_path']
for f in prov['files']:assert sha(modelpath/f['file'])==f['sha256'],'MODEL_CHANGED'
print('LOADING_APPROVED_VOICE09_BASE',flush=True)
model=Qwen3TTSModel.from_pretrained(str(modelpath),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True)
prompt=torch.load(ROOT/plan['saved_voice_prompt'],map_location='cpu',weights_only=False)
ff=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
records=[]
def generate(name,text,language,seed):
 folder=OUT/name;assert not folder.exists();folder.mkdir();(folder/'text.txt').write_text(text)
 torch.manual_seed(seed);start=time.monotonic();print('GENERATING',name,language,flush=True)
 audio,sr=model.generate_voice_clone(text=text,language=language,voice_clone_prompt=prompt,non_streaming_mode=True,max_new_tokens=1536)
 wave=np.asarray(audio[0]);assert np.isfinite(wave).all();sf.write(folder/'raw.wav',wave,sr,subtype='PCM_16')
 # Remove digital/very-low-level padding only, with 80ms protected margins.
 frame=max(1,round(sr*.01));levels=np.array([np.max(np.abs(wave[i:i+frame]))for i in range(0,len(wave),frame)])
 active=np.flatnonzero(levels>0.0005);assert len(active)>0
 lo=max(0,int(active[0]*frame)-round(sr*.08));hi=min(len(wave),int((active[-1]+1)*frame)+round(sr*.08))
 result=wave[lo:hi]
 rec={'name':name,'text':text,'language':language,'seed':seed,'sample_rate':sr,'raw_duration':len(wave)/sr,'used_duration':len(result)/sr,'leading_padding_removed':lo/sr,'trailing_padding_removed':(len(wave)-hi)/sr,'protected_margin_seconds':.08,'generation_seconds':time.monotonic()-start,'raw_file':str((folder/'raw.wav').relative_to(ROOT)),'raw_sha256':sha(folder/'raw.wav')}
 (folder/'generation.json').write_text(json.dumps(rec,ensure_ascii=False,indent=2)+'\n');records.append(rec);print('COMPLETE',name,round(len(result)/sr,3),flush=True);return result,sr

text='机器人从起点读取状态与相机，结合地图信息，自行选择下一处搜寻位置。移动和开门通过实际工具执行，新的观测持续更新任务状态。'
wave,sr=generate('autonomous_search',text,'Chinese',202610141201)
wav=OUT/'autonomous_search/voice.wav';sf.write(wav,wave,sr,subtype='PCM_16')
report={'id':'start_scan','text':text,'file':str(wav.relative_to(ROOT)),'duration_seconds':len(wave)/sr,'selected_voice_id':'09','postproduction_only':True,'cloud_text_upload':False,'sha256':sha(wav),'reference_sha256':plan['voice_reference_sha256'],'authorization_file':plan['authorization_file'],'model':plan['model'],'generation':records}
(OUT/'autonomous-search-voice.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['id','duration_seconds','selected_voice_id']},ensure_ascii=False),flush=True)
