"""Reuse approved synthetic voice09. English letters are generated in English.
Only the three requested narration passages change; no robot model is called.
"""
from pathlib import Path
import runpy,json,time,subprocess,hashlib,datetime
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/voice'
assert Path.cwd()==ROOT
support=runpy.run_path(str(ROOT/'scripts/demo-video/synthesize-qwen-narration-sample.py'),run_name='tts_support')
torch=support['torch'];sf=support['sf'];Qwen3TTSModel=support['Qwen3TTSModel'];sha=support['sha']
import numpy as np
plan=json.loads((OUT/'narration-plan-AGH-v9.json').read_text());auth=json.loads((ROOT/plan['authorization_file']).read_text());assert auth['authorized'] and auth['scope']=='Video post-production narration only'
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
letters,sr=generate('english-letter-names','A, G, H.','English',202610140901)
sf.write(OUT/'AGH-letter-names.wav',letters,sr,subtype='PCM_16')
clips=[]
for index,c in enumerate(plan['segments']):
 before,rate=generate(c['id']+'-prefix',c['prefix'],'Chinese',202610140910+index*2)
 after,rate2=generate(c['id']+'-suffix',c['suffix'],'Chinese',202610140911+index*2);assert rate==rate2==sr
 # A short code-switch pause is natural around three separately read letter names.
 gap=np.zeros(round(sr*.025));joined=np.concatenate([before,gap,letters,gap,after]);folder=OUT/c['id'];folder.mkdir();sf.write(folder/'joined-raw.wav',joined,sr,subtype='PCM_16')
 wav=folder/'voice.wav';mp3=folder/'preview.mp3'
 subprocess.run([str(ff),'-nostdin','-v','error','-n','-i',str(folder/'joined-raw.wav'),'-af','highpass=f=60,loudnorm=I=-18:TP=-2:LRA=7','-ar','48000','-ac','1','-c:a','pcm_s16le',str(wav)],check=True)
 subprocess.run([str(ff),'-nostdin','-v','error','-n','-i',str(wav),'-c:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
 data,rate=sf.read(wav);duration=len(data)/rate
 clip={**c,'file':str(wav.relative_to(ROOT)),'sha256':sha(wav),'duration_seconds':duration,'fits_window':duration<=c['end']-c['start']-.15,'spoken_english_letters_file':str((OUT/'AGH-letter-names.wav').relative_to(ROOT)),'voice_reference_sha256':plan['voice_reference_sha256'],'audio_timestretch':False,'pitch_shift':False,'waveform_finite':bool(np.isfinite(data).all()),'waveform_peak':float(np.max(np.abs(data)))}
 (folder/'clip.json').write_text(json.dumps(clip,ensure_ascii=False,indent=2)+'\n');clips.append(clip);(OUT/'changed-clips-v9.json').write_text(json.dumps(clips,ensure_ascii=False,indent=2)+'\n');print('CLIP',json.dumps({k:clip[k]for k in ['id','duration_seconds','fits_window']},ensure_ascii=False),flush=True)
full={'version':9,'selected_voice_id':'09','generic_synthetic_reference':True,'real_human_voice_reference':False,'synthetic_reference_sha256':plan['voice_reference_sha256'],'saved_prompt_sha256':plan['saved_voice_prompt_sha256'],'model':plan['model'],'authorization_file':plan['authorization_file'],'method':'Same approved voice09 prompt. A, G, H letter names generated in English once, inserted between Chinese prefix and suffix from the same prompt. Very-low-level padding trimmed with protected margins; no speed or pitch change.','english_spell_file':str((OUT/'AGH-letter-names.wav').relative_to(ROOT)),'english_spell_sha256':sha(OUT/'AGH-letter-names.wav'),'records':records,'changed_clips':clips,'all_fit':all(c['fits_window']for c in clips),'cloud_text_upload':False,'robot_model_calls':0,'synthesis_calls':len(records),'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(OUT/'audio-provenance-v9.json').write_text(json.dumps(full,ensure_ascii=False,indent=2)+'\n');print('ALL_COMPLETE',full['all_fit'],flush=True)
