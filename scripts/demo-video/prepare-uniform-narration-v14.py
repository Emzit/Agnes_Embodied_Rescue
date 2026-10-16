from pathlib import Path
import json,re,math,hashlib,subprocess
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/uniform-narration-v14';P=R/'artifacts/demo-project-film-20261015/narration-and-ending-v13';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';RATE=48000;TARGET=4.4
IDS=['use_case','native_task','start_scan','task_loop','vision','embodied','skeleton','entry','finish'];OLD_SECTIONS=[(0,22.5),(22.5,35),(35,51),(51,76),(76,102),(102,130),(130,160),(160,191),(191,215.5)]
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def units(text):return len(re.findall(r'[\u4e00-\u9fffA-Za-z0-9]',text))
def pace(data,rate,target_seconds,folder):
 folder.mkdir(parents=True,exist_ok=False);inp=folder/'source.wav';out=folder/'paced.wav';sf.write(inp,data,rate,subtype='FLOAT');ratio=(len(data)/rate)/target_seconds;assert .65<=ratio<=1.001,(folder,ratio)
 subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(inp),'-af',f'atempo={ratio:.14f}','-ar',str(RATE),'-ac','1','-c:a','pcm_f32le',str(out)],check=True)
 wave,sr=sf.read(out,dtype='float32');assert sr==RATE and np.isfinite(wave).all();return wave,{'source_duration_seconds':len(data)/rate,'target_duration_seconds':target_seconds,'output_duration_seconds':len(wave)/RATE,'atempo':ratio,'pitch_changed':False,'input_sha256':sha(inp),'output_sha256':sha(out)}
def main():
 assert Path.cwd()==R
 original=json.loads((R/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/narration-timeline-v9.json').read_text())['clips'];edits=json.loads((P/'narration-edits-v13.json').read_text());updates={c['id']:c for c in edits['clips']};oldcaps=json.loads((P/'caption-schedule-v13.json').read_text())['cues']
 for caption in oldcaps:
  if caption.get('clip_id')not in IDS:
   matches=[c['id']for c in original if c['start']-1e-5<=caption['start']<c['start']+c['duration_seconds']+1e-5]
   assert len(matches)==1,(caption,matches);caption['clip_id']=matches[0]
 assert {c.get('clip_id')for c in oldcaps}==set(IDS)
 newclips=[];newwaves=[];capmeta=[];sections=[];offset=0;records=[]
 for old,(a,b)in zip(original,OLD_SECTIONS):
  name=old['id'];assert name==IDS[len(newclips)];current={**old,**updates.get(name,{})};w,sr=sf.read(R/current['file'],dtype='float32');assert w.ndim==1 and sr==RATE
  text=old['display_text'];u=units(text);caps=[c for c in oldcaps if c.get('clip_id')==name];newpieces=[]
  if name in updates:
   pieces=[p for p in edits['waveform_pieces']if p['clip_id']==name];parts=[];at=0
   for j,piece in enumerate(pieces):
    if j:
     previous=pieces[j-1];gap=piece['offset_seconds']-(previous['offset_seconds']+previous['duration_seconds']);assert gap>=-.00001
     gap=max(0,gap);parts.append(np.zeros(round(gap*RATE),dtype='float32'));at+=gap
    lo=round(piece['offset_seconds']*sr);hi=round((piece['offset_seconds']+piece['duration_seconds'])*sr);data=w[lo:hi];pu=sum(units(t)for t in piece['texts']);target=.84 if piece['piece']=='AGH'else pu/TARGET
    processed,record=pace(data,sr,target,O/'voice'/name/piece['piece']);parts.append(processed);duration=len(processed)/RATE
    newpieces.append({**piece,'old_offset_seconds':piece['offset_seconds'],'old_duration_seconds':piece['duration_seconds'],'offset_seconds':at,'duration_seconds':duration,'pace_record':record});records.append({'clip_id':name,'piece':piece['piece'],'spoken_units':pu,**record});at+=duration
   wave=np.concatenate(parts)
   localcaps=[]
   for piece in newpieces:
    oldstart=current['start']+piece['old_offset_seconds'];scale=piece['duration_seconds']/piece['old_duration_seconds']
    for caption in caps:
     if caption['text']in piece['texts']:
      localcaps.append({**caption,'local_start':piece['offset_seconds']+(caption['start']-oldstart)*scale,'local_end':piece['offset_seconds']+(caption['end']-oldstart)*scale,'source_start':caption['start'],'source_end':caption['end']})
   assert len(localcaps)==len(caps)
  else:
   wave,record=pace(w,sr,u/TARGET,O/'voice'/name/'whole');duration=len(wave)/RATE;scale=duration/(len(w)/sr)
   localcaps=[{**c,'local_start':(c['start']-current['start'])*scale,'local_end':(c['end']-current['start'])*scale,'source_start':c['start'],'source_end':c['end']}for c in caps];records.append({'clip_id':name,'piece':'whole','spoken_units':u,**record})
  duration=len(wave)/RATE;lead=old['start']-a;frames=math.ceil(max(b-a,lead+duration+.9)*30-1e-8);start=offset/30;end=(offset+frames)/30
  clip={'id':name,'text':text,'spoken_units':u,'source_file':current['file'],'source_sha256':sha(R/current['file']),'old_duration_seconds':len(w)/sr,'duration_seconds':duration,'units_per_second':u/duration,'start':start+lead,'speech_end':start+lead+duration,'window_end':end,'new_pieces':newpieces,'voice_id':'09'}
  outfile=O/'voice'/name/'voice.wav';sf.write(outfile,wave,RATE,subtype='FLOAT');clip.update(file=str(outfile.relative_to(R)),sha256=sha(outfile));newclips.append(clip);newwaves.append(wave)
  for c in localcaps:capmeta.append({**c,'start':clip['start']+c['local_start'],'end':clip['start']+c['local_end']})
  sections.append({'id':name,'source_start':a,'source_end':b,'output_start_frame':offset,'output_end_frame':offset+frames,'output_start':start,'output_end':end,'frames':frames,'source_frame_start':round(a*30),'source_frame_end':round(b*30),'video_timing_factor':(b-a)/(frames/30)});offset+=frames
  print(json.dumps({'clip_id':name,'old_rate':round(u/(len(w)/sr),3),'new_rate':round(u/duration,3),'seconds':round(duration,3),'chapter_end':end},ensure_ascii=False),flush=True)
 assert max(c['units_per_second']for c in newclips)-min(c['units_per_second']for c in newclips)<.2
 assert all(c['duration_seconds']>c['old_duration_seconds']for c in newclips)
 capmeta.sort(key=lambda c:c['start']);assert [c['text']for c in capmeta]==[c['text']for c in oldcaps]
 for c,d in zip(capmeta,capmeta[1:]):assert c['end']<=d['start']+1e-5,(c,d)
 n=offset*1600;master=np.zeros((n,2),dtype='float32');bedfile=R/'artifacts/demo-video-20261013/assets/narration/original-ambient-300.wav';bed,br=sf.read(bedfile,dtype='float32',always_2d=True);assert br==RATE and bed.shape[1]==2
 assert sha(bedfile)=='bb8386120d08445ca1fc96d9be26f0cb45fd08fe6a0be21a5ecd4b311c76ed82';master+=np.tile(bed,(math.ceil(n/len(bed)),1))[:n]*np.float32(10**(-28/20))
 for c,w in zip(newclips,newwaves):
  s=round(c['start']*RATE);e=s+len(w);assert e<=round(c['window_end']*RATE)-round(.8*RATE);master[s:e]+=w[:,None]
 assert np.isfinite(master).all() and np.max(np.abs(master))<.99
 sf.write(O/'master-uniform-v14.wav',master,RATE,subtype='FLOAT');subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(O/'master-uniform-v14.wav'),'-c:a','aac','-b:a','192k',str(O/'uniform-audio-v14.m4a')],check=True)
 plan={'version':14,'selected_voice_id':'09','method':'Pitch-preserving atempo on the existing approved voice. Chinese pace calibrated per known speech piece or paragraph; English AGH remains 0.84 seconds, with compact original joins. No re-synthesis, model calls or word changes.','target_Chinese_spoken_units_per_second':TARGET,'spoken_units_metric':'Chinese characters, English letter names and digits excluding punctuation; effective rate includes natural within-piece pauses. Not a phoneme-level alignment claim.','all_clips_slowed':True,'total_frames':offset,'duration_seconds':offset/30,'dimensions':[1438,1080],'clips':newclips,'sections':sections,'processing_records':records,'background_file':str(bedfile.relative_to(R)),'background_sha256':sha(bedfile),'background_gain_db':-28,'vision_sentence_gap_seconds':.45,'subtitle_words_unchanged':True,'new_robot_actions':False,'new_model_calls':False,'source_movie':str((P/'project-film-polished-v13.mp4').relative_to(R)),'source_movie_sha256':sha(P/'project-film-polished-v13.mp4'),'master_sha256':sha(O/'master-uniform-v14.wav'),'peak':float(np.max(np.abs(master)))}
 (O/'pacing-plan-v14.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n');(O/'caption-schedule-v14.json').write_text(json.dumps({'cues':capmeta,'words_unchanged':True,'basis':'Each existing cue follows its actual pitch-preserving waveform time scale and new chapter position.'},ensure_ascii=False,indent=2)+'\n')
 def st(t):
  ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
 (O/'project-film-uniform-v14.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{st(c["start"])} --> {st(c["end"])}\n{c["text"]}'for i,c in enumerate(capmeta))+'\n')
 print(json.dumps({'prepared':True,'duration_seconds':offset/30,'rates':[round(c['units_per_second'],3)for c in newclips],'all_slower':True}),flush=True)
if __name__=='__main__':main()
