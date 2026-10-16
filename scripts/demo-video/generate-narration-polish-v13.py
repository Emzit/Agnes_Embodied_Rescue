from pathlib import Path
import runpy,json,time,hashlib,subprocess
import numpy as np
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/narration-and-ending-v13';V=R/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/voice'
F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
def main():
 assert Path.cwd()==R
 support=runpy.run_path(str(R/'scripts/demo-video/synthesize-qwen-narration-sample.py'),run_name='tts_support');torch=support['torch'];sf=support['sf'];Q=support['Qwen3TTSModel'];sha=support['sha']
 plan=json.loads((V/'narration-plan-AGH-v9.json').read_text());auth=json.loads((R/plan['authorization_file']).read_text());assert auth['authorized'] and auth['scope']=='Video post-production narration only'
 assert sha(R/plan['voice_reference_file'])==plan['voice_reference_sha256'] and sha(R/plan['saved_voice_prompt'])==plan['saved_voice_prompt_sha256']
 provenance=json.loads((R/plan['source_model_provenance_file']).read_text());modelpath=R/provenance['model_path']
 for rec in provenance['files']:assert sha(modelpath/rec['file'])==rec['sha256']
 print('LOADING_SAME_APPROVED_VOICE09_LOCAL_MODEL',flush=True)
 model=Q.from_pretrained(str(modelpath),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True)
 prompt=torch.load(R/plan['saved_voice_prompt'],map_location='cpu',weights_only=False)
 pieces=[('vision-a','中的视觉子会话。模型分析画面中的人员和房门，返回图像里的目标位置与置信度，',6.15),('vision-b','再把这些线索交给任务会话。视觉回答的是看到了什么；地图上的精确位置来自激光定位、里程计和坐标变换。',8.40),('vision-c','把语义理解与可测量的位置结合，才能决定下一步到哪里观察。',4.65)]
 assert ''.join(x[1]for x in pieces)==next(c['suffix']for c in plan['segments']if c['id']=='vision')
 records=[]
 for i,(name,text,target)in enumerate(pieces):
  folder=O/'voice'/name;folder.mkdir(parents=True,exist_ok=False);(folder/'text.txt').write_text(text)
  torch.manual_seed(202610150130+i);start=time.monotonic();print('SYNTHESIZING',name,flush=True)
  audio,sr=model.generate_voice_clone(text=text,language='Chinese',voice_clone_prompt=prompt,non_streaming_mode=True,max_new_tokens=1536)
  w=np.asarray(audio[0]);assert np.isfinite(w).all();sf.write(folder/'raw.wav',w,sr,subtype='PCM_16')
  frame=round(sr*.01);rms=np.array([np.sqrt(np.mean(w[j:j+frame]**2))for j in range(0,len(w),frame)]);active=np.flatnonzero(rms>.001);assert len(active)>0
  lo=max(0,active[0]*frame-round(sr*.06));hi=min(len(w),(active[-1]+1)*frame+round(sr*.06));trim=w[lo:hi];sf.write(folder/'trimmed.wav',trim,sr,subtype='PCM_16')
  tempo=(len(trim)/sr)/target;assert .65<tempo<1.7
  subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(folder/'trimmed.wav'),'-af',f'atempo={tempo:.12f}','-ar','24000','-ac','1',str(folder/'paced.wav')],check=True)
  out,rr=sf.read(folder/'paced.wav');duration=len(out)/rr
  record={'name':name,'text':text,'seed':202610150130+i,'raw_duration':len(w)/sr,'trimmed_duration':len(trim)/sr,'target_duration':target,'actual_duration':duration,'atempo':tempo,'pitch_preserved':True,'sample_rate':rr,'leading_padding_removed':lo/sr,'trailing_padding_removed':(len(w)-hi)/sr,'protect_margin_seconds':.06,'generation_seconds':time.monotonic()-start,'raw_sha256':sha(folder/'raw.wav'),'paced_sha256':sha(folder/'paced.wav')};records.append(record);print('COMPLETE',json.dumps(record,ensure_ascii=False),flush=True)
 result={'selected_voice_id':'09','model':plan['model'],'reference_sha256':plan['voice_reference_sha256'],'saved_prompt_sha256':plan['saved_voice_prompt_sha256'],'authorization_file':plan['authorization_file'],'pieces':records,'content_unchanged':True,'scope':'Video postproduction narration only','cloud_calls':0,'robot_model_calls':0,'planned_sentence_gap_before_vision_c_seconds':.45,'planned_B_duration_seconds':8.4,'old_B_caption_based_duration_seconds':7.63798245614036}
 (O/'voice-generation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('GENERATION_COMPLETE',flush=True)
if __name__=='__main__':main()
