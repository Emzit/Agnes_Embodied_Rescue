from pathlib import Path
import json,hashlib,subprocess,importlib.util
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/narration-and-ending-v13';V9=R/'artifacts/demo-project-film-20261014/revision-agh-narration-v9';V=V9/'voice';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';SR=48000;N=round(215.5*SR)
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def trim(name,margin=.05):
 file=V/name/'raw.wav';w,sr=sf.read(file,dtype='float32');assert sr==24000
 f=round(sr*.01);rms=np.array([np.sqrt(np.mean(w[j:j+f]**2))for j in range(0,len(w),f)]);active=np.flatnonzero(rms>.001);assert len(active)
 lo=max(0,int(active[0]*f)-round(sr*margin));hi=min(len(w),int((active[-1]+1)*f)+round(sr*margin));a=w[lo:hi].copy()
 n=round(sr*.004);a[:n]*=np.linspace(0,1,n);a[-n:]*=np.linspace(1,0,n)
 return a,{'source':str(file.relative_to(R)),'source_sha256':sha(file),'leading_padding_removed':lo/sr,'trailing_padding_removed':(len(w)-hi)/sr,'duration_seconds':len(a)/sr,'preserved_margin_seconds':margin,'old_speech_onset_seconds':float(active[0]*.01),'old_speech_offset_seconds':float((active[-1]+1)*.01)}
def main():
 assert Path.cwd()==R and (O/'voice-generation.json').exists()
 oldcaps=json.loads((V9/'caption-schedule-v9.json').read_text())['cues'];oldplan=json.loads((V/'narration-plan-AGH-v9.json').read_text());pieces_report=json.loads((O/'voice-generation.json').read_text())
 letters,letterinfo=trim('english-letter-names',.035)
 clips=[];changedcaps=[];pieces_meta=[]
 for item in oldplan['segments']:
  name=item['id'];old=[c for c in oldcaps if c.get('clip_id')==name];letterindex=next(i for i,c in enumerate(old)if c['text']=='AGH');prefix,pi=trim(name+'-prefix')
  parts=[];cursor=0
  def add(w,cues,label):
   nonlocal cursor
   a=cursor;duration=len(w)/24000;total=sum(len(c['text'])for c in cues)
   at=item['start']+a
   for c in cues:
    end=at+duration*len(c['text'])/total;changedcaps.append({**c,'start':at,'end':end,'source_caption_start':c['start'],'source_caption_end':c['end'],'timing_basis':'Known edited waveform piece plus proportional clause length'});at=end
   parts.append(w);cursor+=duration;pieces_meta.append({'clip_id':name,'piece':label,'offset_seconds':a,'duration_seconds':duration,'texts':[c['text']for c in cues]})
  def gap(seconds):
   nonlocal cursor
   parts.append(np.zeros(round(24000*seconds),dtype='float32'));cursor+=seconds
  add(prefix,old[:letterindex],'prefix');gap(.045 if name=='task_loop' else .015);add(letters,[old[letterindex]],'AGH');gap(.015)
  if name!='vision':
   suffix,si=trim(name+'-suffix');add(suffix,old[letterindex+1:],'suffix')
  else:
   allsuffix=old[letterindex+1:]
   for key,cues,aftergap in [('vision-a',allsuffix[:3],.12),('vision-b',allsuffix[3:6],.45),('vision-c',allsuffix[6:],0)]:
    w,rate=sf.read(O/'voice'/key/'paced.wav',dtype='float32');assert rate==24000;add(w,cues,key)
    if aftergap:gap(aftergap)
   si={'new_pieces':pieces_report['pieces']}
  folder=O/'voice'/name;folder.mkdir(exist_ok=False);joined=np.concatenate(parts);sf.write(folder/'joined.wav',joined,24000,subtype='PCM_16')
  subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(folder/'joined.wav'),'-af','highpass=f=60,loudnorm=I=-18:TP=-2:LRA=7','-ar','48000','-ac','1','-c:a','pcm_s16le',str(folder/'voice.wav')],check=True)
  w,sr=sf.read(folder/'voice.wav',dtype='float32');duration=len(w)/sr;assert duration<item['end']-item['start']-.20
  clips.append({**item,'file':str((folder/'voice.wav').relative_to(R)),'duration_seconds':duration,'speech_end':item['start']+duration,'sha256':sha(folder/'voice.wav'),'prefix_trim':pi,'suffix_trim':si,'letters_trim':letterinfo,'code_switch_gap_seconds':.015,'same_selected_voice_id':'09'})
 # All words and all other caption timings remain identical; only three requested voice timelines are retimed.
 cues=[c for c in oldcaps if c.get('clip_id')not in ['native_task','task_loop','vision']]+changedcaps;cues.sort(key=lambda c:c['start'])
 assert [c['text']for c in cues]==[c['text']for c in oldcaps]
 for a,b in zip(cues,cues[1:]):assert a['end']<=b['start']+1e-5,(a,b)
 (O/'caption-schedule-v13.json').write_text(json.dumps({'cues':cues,'text_content_unchanged':True,'changed_clip_ids':['native_task','task_loop','vision']},ensure_ascii=False,indent=2)+'\n')
 def st(t):
  ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
 (O/'project-film-polished-v13.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{st(c["start"])} --> {st(c["end"])}\n{c["text"]}'for i,c in enumerate(cues))+'\n')
 sourcefile=R/'artifacts/demo-project-film-20261015/replay-replacement-v12/project-film-replay-v12.mp4';sourcewav=O/'source-v12-audio.wav'
 subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(sourcefile),'-map','0:a:0','-t','215.5','-ar','48000','-ac','2','-c:a','pcm_f32le',str(sourcewav)],check=True)
 source,rate=sf.read(sourcewav,dtype='float32',always_2d=True);assert rate==SR and len(source)==N
 ambient,ar=sf.read(V/'original-ambient-48k-stereo.wav',dtype='float32',always_2d=True);assert ar==SR
 spec=importlib.util.spec_from_file_location('timing6',R/'scripts/demo-video/render-reference-flow-v6.py');T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T)
 bed=np.concatenate([ambient[round(a*SR):round(b*SR)]for a,b,_ in T.SECTIONS]);assert len(bed)==N;bed*=np.float32(10**(-28/20))
 result=source.copy();mask=np.zeros(N,dtype=bool);regions=[]
 for c in clips:
  lo=round((c['start']-.06)*SR);hi=round(c['end']*SR);mask[lo:hi]=True
  voice,vr=sf.read(R/c['file'],dtype='float32');assert vr==SR
  replacement=bed[lo:hi].copy();start=round(c['start']*SR)-lo;replacement[start:start+len(voice)]+=voice[:,None]
  times=np.arange(lo,hi)/SR;envelope=np.minimum(np.clip((times-(c['start']-.06))/.06,0,1),np.clip((c['end']-times)/.06,0,1)).astype('float32')
  result[lo:hi]=source[lo:hi]*(1-envelope[:,None])+replacement*envelope[:,None]
  regions.append({'id':c['id'],'start':lo/SR,'end':hi/SR,'speech_end':c['speech_end']})
 ref=hashlib.sha256(source[~mask].tobytes()).hexdigest();out=hashlib.sha256(result[~mask].tobytes()).hexdigest();assert ref==out and np.isfinite(result).all() and np.max(np.abs(result))<.99
 master=O/'master-polished-v13.wav';sf.write(master,result,SR,subtype='FLOAT')
 subprocess.run([str(F),'-nostdin','-v','error','-n','-i',str(master),'-c:a','aac','-b:a','192k',str(O/'polished-audio-v13.m4a')],check=True)
 (O/'narration-edits-v13.json').write_text(json.dumps({'clips':clips,'waveform_pieces':pieces_meta,'old_voice_generation':str((V/'audio-provenance-v9.json').relative_to(R)),'new_vision_generation':str((O/'voice-generation.json').relative_to(R)),'selected_voice_id':'09','words_unchanged':True,'clear_pause_before_vision_c_seconds':.45,'AGH_seams_tightened':True,'original_script':str((V9/'script-AGH-v9.txt').relative_to(R))},ensure_ascii=False,indent=2)+'\n')
 report={'changed_regions':regions,'unchanged_PCM_reference_sha256':ref,'unchanged_PCM_output_sha256':out,'unchanged_PCM_exact':True,'six_other_narration_passages_preserved':True,'word_content_unchanged':True,'all_clips_fit':True,'peak':float(np.max(np.abs(result))),'samples':N,'sample_rate':SR,'master_sha256':sha(master),'background_unchanged':True}
 (O/'audio-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
