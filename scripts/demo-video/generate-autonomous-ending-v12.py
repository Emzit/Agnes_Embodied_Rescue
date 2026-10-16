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


clips=[]
for i,(name,text) in enumerate([
 ('target_entry','回到实际画面，机器人在右前方区域观察到人员线索，并调整视角进行复核。判断依据继续来自新的相机图像和实际工具反馈。'),
 ('ending','到这里，一句远程指令已经串起环境观察、房间检查、导航和人员定位。模型调用、工具执行与视觉证据，都可以回看。')]):
 wave,sr=generate(name,text,'Chinese',202610141210+i);wav=OUT/name/'voice.wav';sf.write(wav,wave,sr,subtype='PCM_16');clips.append({'id':name,'text':text,'file':str(wav.relative_to(ROOT)),'sha256':sha(wav),'duration_seconds':len(wave)/sr})
(OUT/'autonomous-ending-voice.json').write_text(json.dumps({'clips':clips,'selected_voice_id':'09','postproduction_only':True,'authorization_file':plan['authorization_file'],'voice_reference_sha256':plan['voice_reference_sha256'],'records':records},ensure_ascii=False,indent=2)+'\n');print(json.dumps(clips,ensure_ascii=False),flush=True)
