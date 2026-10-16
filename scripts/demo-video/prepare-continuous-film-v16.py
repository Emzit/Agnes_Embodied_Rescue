from pathlib import Path
import copy,json,hashlib,re,subprocess,math
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');P=R/'artifacts/demo-project-film-20261015/flow-refinement-v15';V14=R/'artifacts/demo-project-film-20261015/uniform-narration-v14';O=R/'artifacts/demo-project-film-20261015/continuous-narration-v16';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';RATE=48000
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def units(t):return len(re.findall(r'[\u4e00-\u9fffA-Za-z0-9]',t))
def main():
 old=json.loads((P/'flow-plan-v15.json').read_text());caps=json.loads((P/'caption-schedule-v15.json').read_text())['cues'];clips=copy.deepcopy(old['clips']);gen=json.loads((O/'voice-generation-v16.json').read_text());g={p['name']:p for p in gen['pieces']}
 task=next(c for c in clips if c['id']=='task_loop');task.update(file=str((O/'voice/task_loop/voice.wav').relative_to(R)),sha256=g['task_loop']['voice_sha256'],duration_seconds=g['task_loop']['actual_duration'],speech_end=task['start']+g['task_loop']['actual_duration'],units_per_second=g['task_loop']['units_per_second'],new_pieces=[],continuous_sentence_synthesis=True)
 vision=next(c for c in clips if c['id']=='vision');head,sr=sf.read(O/'voice/vision-head/voice.wav',dtype='float32');b,sr=sf.read(V14/'voice/vision/vision-b/paced.wav',dtype='float32');c,sr=sf.read(V14/'voice/vision/vision-c/paced.wav',dtype='float32');wave=np.concatenate([head,np.zeros(round(.12*RATE),dtype='float32'),b,np.zeros(round(.45*RATE),dtype='float32'),c]);folder=O/'voice/vision';folder.mkdir();sf.write(folder/'voice.wav',wave,RATE,subtype='FLOAT')
 oldboffset=vision['new_pieces'][3]['offset_seconds'];boffset=len(head)/RATE+.12;shift=boffset-oldboffset;vision.update(file=str((folder/'voice.wav').relative_to(R)),sha256=sha(folder/'voice.wav'),duration_seconds=len(wave)/RATE,speech_end=vision['start']+len(wave)/RATE,units_per_second=vision['spoken_units']/(len(wave)/RATE),new_pieces=[{'piece':'continuous-head','offset_seconds':0,'duration_seconds':len(head)/RATE},{'piece':'vision-b','offset_seconds':boffset,'duration_seconds':len(b)/RATE},{'piece':'vision-c','offset_seconds':boffset+len(b)/RATE+.45,'duration_seconds':len(c)/RATE}],continuous_sentence_synthesis=True)
 cues=[]
 for i,c in enumerate(caps):
  if c['clip_id']=='task_loop' or(c['clip_id']=='vision' and c['start']<vision['start']+oldboffset-.001):continue
  q=copy.deepcopy(c);q['source_cue_index']=i;q['render_new']=False
  if q['clip_id']=='vision':q['start']+=shift;q['end']+=shift
  cues.append(q)
 groups=[(task,['大任务不能直接变成电机指令','AGH调用任务模型','结合已有观测和工具定义','组织查看环境、接近房门、识门、开门等步骤','框架负责检查参数与权限','再通过工具接口交给机器人系统','一个动作返回处理中时','系统继续等待同一操作的实际结果','只有反馈确认完成','才进入后续步骤'],task['duration_seconds']),(vision,['机器人看到的相机图像','会作为图片输入AGH中的视觉子会话','模型分析画面中的人员和房门','返回图像里的目标位置与置信度'],len(head)/RATE)]
 for clip,texts,duration in groups:
  total=sum(units(t)for t in texts);at=clip['start']
  for text in texts:
   end=at+duration*units(text)/total;cues.append({'clip_id':clip['id'],'start':at,'end':end,'text':text,'render_new':True});at=end
 cues.sort(key=lambda q:q['start']);norm=lambda cs:''.join(q['text']for q in cs).replace('，','').replace('。','').replace('；','').replace('：','');assert norm(cues)==norm(caps)
 for q,d in zip(cues,cues[1:]):assert q['end']<=d['start']+1e-5
 for c in clips:assert c['speech_end']<c['window_end']-.8
 master,sr=sf.read(P/'master-flow-v15.wav',dtype='float32',always_2d=True)
 for name in ['task_loop','vision']:
  oc=next(c for c in old['clips']if c['id']==name);nc=next(c for c in clips if c['id']==name);before,sr=sf.read(R/oc['file'],dtype='float32');after,sr=sf.read(R/nc['file'],dtype='float32');start=round(oc['start']*RATE);master[start:start+len(before)]-=before[:,None];master[start:start+len(after)]+=after[:,None]
 assert np.isfinite(master).all()and np.max(np.abs(master))<.99;sf.write(O/'master-continuous-v16.wav',master,RATE,subtype='FLOAT');subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(O/'master-continuous-v16.wav'),'-c:a','aac','-b:a','192k',str(O/'continuous-audio-v16.m4a')],check=True)
 plan={**old,'version':16,'source_movie':str((P/'project-film-flow-v15.mp4').relative_to(R)),'source_movie_sha256':sha(P/'project-film-flow-v15.mp4'),'clips':clips,'cut':{'source_frame_start':old['total_frames'],'source_frame_end':old['total_frames'],'removed_seconds':0},'caption_patch_windows':[[task['start'],task['window_end']],[vision['start'],vision['window_end']]],'master_sha256':sha(O/'master-continuous-v16.wav'),'peak':float(np.max(np.abs(master))),'narration_changed_clips':['task_loop','vision'],'postproduction_voice_generation_calls':2,'continuous_AGH_sentences':True,'vision_head_shift':shift,'inherited_wait_removal_seconds':8.833333333333334}
 (O/'continuous-plan-v16.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n');(O/'caption-schedule-v16.json').write_text(json.dumps({'cues':cues,'method':'Continuous-sentence synthesis; proportional clause timing over new utterances, unchanged tail timing shifted as a unit'},ensure_ascii=False,indent=2)+'\n')
 def st(t):
  ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
 (O/'project-film-continuous-v16.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{st(c["start"])} --> {st(c["end"])}\n{c["text"]}'for i,c in enumerate(cues))+'\n');(O/'narration-script-v16.txt').write_text('\n\n'.join(c['text']for c in clips)+'\n');print('Prepared V16',old['duration_seconds'],flush=True)
if __name__=='__main__':main()
