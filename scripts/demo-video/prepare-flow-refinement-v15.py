from pathlib import Path
import json,hashlib,copy,re,math,subprocess
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');P=R/'artifacts/demo-project-film-20261015/uniform-narration-v14';O=R/'artifacts/demo-project-film-20261015/flow-refinement-v15';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';RATE=48000;CUT_LO=5790;CUT_HI=6055
SHA14='c87c66a3efe576f7f1f383f6786b50d60e55515916dedeb5cf85f143f728d348'
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def units(t):return len(re.findall(r'[\u4e00-\u9fffA-Za-z0-9]',t))
def main():
 assert Path.cwd()==R and sha(P/'project-film-uniform-v14.mp4')==SHA14
 old=json.loads((P/'pacing-plan-v14.json').read_text());oldcaps=json.loads((P/'caption-schedule-v14.json').read_text())['cues'];clips=copy.deepcopy(old['clips']);cut=(CUT_HI-CUT_LO)/30;cutstart=CUT_LO/30;cutend=CUT_HI/30
 assert all(c['speech_end']<=cutstart or c['start']>=cutend for c in clips),'cut intersects speech'
 vision=next(c for c in clips if c['id']=='vision');vp=copy.deepcopy(vision['new_pieces']);wave={n:sf.read(P/'voice/vision'/n/'paced.wav',dtype='float32')[0]for n in ['prefix','AGH','vision-a','vision-b','vision-c']}
 # Only remove low-energy boundary padding. Keep 10+ ms around detected H tail and Mandarin consonant onset.
 h=wave['AGH'][:round(.8*RATE)].copy();a=wave['vision-a'][round(.04*RATE):].copy();cross=round(.008*RATE);fade=np.linspace(0,1,cross,dtype='float32')
 join=np.concatenate([h[:-cross],h[-cross:]*(1-fade)+a[:cross]*fade,a[cross:]])
 localA=len(wave['prefix'])/RATE+.015+len(h)/RATE-cross/RATE;shift=localA-.04-vp[2]['offset_seconds'];assert abs(shift+.090520833333333)<1e-6
 result=np.concatenate([wave['prefix'],np.zeros(round(.015*RATE),dtype='float32'),join,np.zeros(round(.12*RATE),dtype='float32'),wave['vision-b'],np.zeros(round(.45*RATE),dtype='float32'),wave['vision-c']])
 folder=O/'voice/vision';folder.mkdir(parents=True,exist_ok=False);sf.write(folder/'voice.wav',result,RATE,subtype='FLOAT')
 def active(w):
  step=240;rms=np.array([np.sqrt(np.mean(w[j:j+step]**2))for j in range(0,len(w),step)]);nz=np.flatnonzero(rms>.001);return nz[0]*.005,(nz[-1]+1)*.005
 hstart,hend=active(wave['AGH']);astart,aend=active(wave['vision-a']);oldgap=vp[2]['offset_seconds']+astart-vp[1]['offset_seconds']-hend;newgap=oldgap+shift
 assert .01<=newgap<.04 and newgap<oldgap*.4
 seam={'old_RMS_boundary_gap_seconds':oldgap,'new_RMS_boundary_gap_seconds':newgap,'threshold_RMS':.001,'block_seconds':.005,'AGH_end_trim_seconds':len(wave['AGH'])/RATE-.8,'Mandarin_leading_trim_seconds':.04,'quiet_crossfade_seconds':.008,'added_silence_at_join':0,'all_active_letter_and_consonant_samples_kept':True,'captions_merge_AGH_and_first_Mandarin_clause':True,'timeline_shift_after_AGH':shift}
 vision.update(file=str((folder/'voice.wav').relative_to(R)),sha256=sha(folder/'voice.wav'),duration_seconds=len(result)/RATE,speech_end=vision['start']+len(result)/RATE,units_per_second=vision['spoken_units']/(len(result)/RATE),new_pieces=vp)
 vp[1]['duration_seconds']=.8
 for i in [2,3,4]:vp[i]['offset_seconds']+=shift
 vp[2]['trimmed_leading_padding_seconds']=.04;vp[2]['duration_seconds']-=.04;vp[2]['offset_seconds']+=.04
 vp[2]['overlap_with_AGH_seconds']=.008
 scan=next(c for c in clips if c['id']=='start_scan');generated=json.loads((O/'voice-generation-v15.json').read_text());scan.update(text=generated['text'],spoken_units=generated['units'],file=str((O/'voice/start_scan/voice.wav').relative_to(R)),sha256=generated['voice_sha256'],duration_seconds=generated['actual_duration'],speech_end=scan['start']+generated['actual_duration'],units_per_second=generated['units_per_second'])
 cues=[]
 for i,c in enumerate(oldcaps):
  if c['clip_id']=='start_scan':continue
  q=copy.deepcopy(c);q['source_cue_index']=i
  if q['clip_id']=='vision':
   if q['text']=='AGH':continue
   if q['text']=='中的视觉子会话':q.update(text='AGH中的视觉子会话',start=vision['start']+vp[1]['offset_seconds'],end=q['end']+shift,render_new=True)
   elif q['start']>=vision['start']+old['clips'][4]['new_pieces'][2]['offset_seconds']-1e-5:q.update(start=q['start']+shift,end=q['end']+shift)
  assert q['end']<=cutstart or q['start']>=cutend
  if q['start']>=cutend:q.update(start=q['start']-cut,end=q['end']-cut)
  cues.append(q)
 texts=['机器人先在起点观察周围','发现不确定的人形线索','就换角度再次核查','本次演示重点验证','从真实观测到动作反馈的闭环'];total=sum(units(t)for t in texts);t=scan['start'];oldscan=[(i,c)for i,c in enumerate(oldcaps)if c['clip_id']=='start_scan']
 for i,text in enumerate(texts):
  end=t+scan['duration_seconds']*units(text)/total;q={'clip_id':'start_scan','start':t,'end':end,'text':text,'render_new':i>=3}
  if i<3:q['source_cue_index']=oldscan[i][0]
  cues.append(q);t=end
 cues.sort(key=lambda c:c['start'])
 for c,d in zip(cues,cues[1:]):assert c['end']<=d['start']+1e-5,(c,d)
 for c in clips:
  if c['start']>=cutend:c['start']-=cut;c['speech_end']-=cut
  if c['window_end']>=cutend:c['window_end']-=cut
  assert c['speech_end']<=c['window_end']-.8
 n=(old['total_frames']-(CUT_HI-CUT_LO))*1600;bed,br=sf.read(R/old['background_file'],dtype='float32',always_2d=True);assert br==RATE
 bed=np.tile(bed,(math.ceil(old['total_frames']*1600/len(bed)),1))[:old['total_frames']*1600];bed*=np.float32(10**(-28/20));j=CUT_LO*1600;k=CUT_HI*1600
 master=np.concatenate([bed[:j],bed[k:]]);crossbed=round(.04*RATE);ramp=np.linspace(0,1,crossbed,dtype='float32')[:,None];master[j:j+crossbed]=bed[j:j+crossbed]*(1-ramp)+bed[k:k+crossbed]*ramp
 assert len(master)==n
 for c in clips:
  w,sr=sf.read(R/c['file'],dtype='float32');assert sr==RATE and np.isfinite(w).all();s=round(c['start']*RATE);master[s:s+len(w)]+=w[:,None]
 assert np.isfinite(master).all() and np.max(np.abs(master))<.99
 sf.write(O/'master-flow-v15.wav',master,RATE,subtype='FLOAT');subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(O/'master-flow-v15.wav'),'-c:a','aac','-b:a','192k',str(O/'flow-audio-v15.m4a')],check=True)
 plan={'version':15,'selected_voice_id':'09','title':'具身救援 · 从指令到行动','source_movie':str((P/'project-film-uniform-v14.mp4').relative_to(R)),'source_movie_sha256':SHA14,'total_frames':n//1600,'duration_seconds':n/RATE,'dimensions':[1438,1080],'clips':clips,'source_sections':old['sections'],'cut':{'source_frame_start':CUT_LO,'source_frame_end':CUT_HI,'source_start_seconds':cutstart,'source_end_seconds':cutend,'removed_seconds':cut,'speech_intersection':False,'reason':'Shorten repeated confirmed-person waiting shot before the closing narration'},'vision_join':seam,'caption_patch_windows':[[scan['start'],scan['window_end']],[vision['start'],vision['window_end']]],'background_file':old['background_file'],'background_gain_db':-28,'background_splice_crossfade_seconds':.04,'master_sha256':sha(O/'master-flow-v15.wav'),'peak':float(np.max(np.abs(master))),'revised_script':{'old':'本次演示按给定房间顺序执行，重点验证从真实观测到动作反馈的闭环','new':'本次演示重点验证从真实观测到动作反馈的闭环'},'narration_changed_clips':['start_scan','vision'],'same_uniform_pace_retained':True,'new_robot_calls':0,'new_cloud_calls':0,'postproduction_voice_generation_calls':1}
 (O/'flow-plan-v15.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n');(O/'caption-schedule-v15.json').write_text(json.dumps({'cues':cues,'method':'Existing cue timing reused; regenerated scan clauses use proportional text length; AGH and Mandarin clause shown as a single continuous caption.'},ensure_ascii=False,indent=2)+'\n')
 def st(t):
  ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
 (O/'project-film-flow-v15.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{st(c["start"])} --> {st(c["end"])}\n{c["text"]}'for i,c in enumerate(cues))+'\n')
 (O/'narration-script-v15.txt').write_text('\n\n'.join(c['text']for c in clips)+'\n');print(json.dumps({'prepared':True,'duration_seconds':plan['duration_seconds'],'pause_removed_seconds':cut,'vision_seam':seam,'scan_rate':scan['units_per_second']},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
