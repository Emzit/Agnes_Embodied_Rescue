from pathlib import Path
import runpy,json,time,hashlib,subprocess,re
import numpy as np
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/flow-refinement-v15';V=R/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/voice';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
def main():
 assert Path.cwd()==R
 support=runpy.run_path(str(R/'scripts/demo-video/synthesize-qwen-narration-sample.py'),run_name='tts_support');torch=support['torch'];sf=support['sf'];Q=support['Qwen3TTSModel'];sha=support['sha']
 plan=json.loads((V/'narration-plan-AGH-v9.json').read_text());auth=json.loads((R/plan['authorization_file']).read_text());assert auth['authorized'] and auth['scope']=='Video post-production narration only'
 assert sha(R/plan['voice_reference_file'])==plan['voice_reference_sha256'] and sha(R/plan['saved_voice_prompt'])==plan['saved_voice_prompt_sha256']
 provenance=json.loads((R/plan['source_model_provenance_file']).read_text());modelpath=R/provenance['model_path']
 for rec in provenance['files']:assert sha(modelpath/rec['file'])==rec['sha256']
 print('LOADING_APPROVED_VOICE09',flush=True)
 model=Q.from_pretrained(str(modelpath),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True);prompt=torch.load(R/plan['saved_voice_prompt'],map_location='cpu',weights_only=False)
 text='机器人先在起点观察周围。发现不确定的人形线索，就换角度再次核查。本次演示重点验证从真实观测到动作反馈的闭环。'
 folder=O/'voice/start_scan';folder.mkdir(parents=True,exist_ok=False);(folder/'text.txt').write_text(text)
 torch.manual_seed(202610151515);start=time.monotonic();print('SYNTHESIZING_NEW_SCAN_PARAGRAPH',flush=True)
 audio,sr=model.generate_voice_clone(text=text,language='Chinese',voice_clone_prompt=prompt,non_streaming_mode=True,max_new_tokens=1536)
 w=np.asarray(audio[0]);assert np.isfinite(w).all();sf.write(folder/'raw.wav',w,sr,subtype='PCM_16')
 step=round(sr*.01);rms=np.array([np.sqrt(np.mean(w[j:j+step]**2))for j in range(0,len(w),step)]);active=np.flatnonzero(rms>.001);assert len(active)>0
 lo=max(0,active[0]*step-round(sr*.06));hi=min(len(w),(active[-1]+1)*step+round(sr*.06));trim=w[lo:hi];sf.write(folder/'trimmed.wav',trim,sr,subtype='PCM_16')
 u=len(re.findall(r'[\u4e00-\u9fffA-Za-z0-9]',text));target=u/4.4;tempo=len(trim)/sr/target;assert .6<tempo<1.7
 subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(folder/'trimmed.wav'),'-af',f'atempo={tempo:.14f},highpass=f=60,loudnorm=I=-18:TP=-2:LRA=7','-ar','48000','-ac','1','-c:a','pcm_f32le',str(folder/'voice.wav')],check=True)
 out,rr=sf.read(folder/'voice.wav');assert rr==48000 and np.isfinite(out).all() and np.max(np.abs(out))<.99
 report={'voice_id':'09','model':plan['model'],'reference_sha256':plan['voice_reference_sha256'],'prompt_sha256':plan['saved_voice_prompt_sha256'],'authorization_file':plan['authorization_file'],'scope':'Video post-production narration only','text':text,'seed':202610151515,'raw_duration':len(w)/sr,'trimmed_duration':len(trim)/sr,'target_duration':target,'actual_duration':len(out)/rr,'atempo':tempo,'pitch_preserving':True,'units':u,'units_per_second':u/(len(out)/rr),'generation_seconds':time.monotonic()-start,'voice_sha256':sha(folder/'voice.wav'),'model_calls':1,'robot_calls':0,'cloud_calls':0}
 (O/'voice-generation-v15.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
