"""Replace only three requested voice passages and build piece-aware captions."""
from pathlib import Path
import json,hashlib,subprocess,importlib.util
import numpy as np,soundfile as sf
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9';FF=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';RATE=48000;N=round(215.5*RATE)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(args):subprocess.run([str(x)for x in args],check=True)
def phrases(text):
 result=[];part=''
 for char in text:
  part+=char
  if char in '。，；：？' or len(part)>=25:result.append(part);part=''
 if part:result.append(part)
 return result
if __name__=='__main__':
 assert Path.cwd()==ROOT
 changes=json.loads((OUT/'voice/changed-clips-v9.json').read_text());assert len(changes)==3 and all(c['fits_window']for c in changes)
 old=json.loads((ROOT/'artifacts/demo-project-film-20261014/revision-voice09-title-v4/voice/narration-cues-voice09.json').read_text())
 manifest=json.loads((OUT/'input-active/project-film.edit-manifest.json').read_text());coverage={c['id']:c for c in manifest['narration']['output_coverage']}
 timeline=[]
 for original in old['clips']:
  c=original.copy();c['start']=coverage[c['id']]['output_start'];c['duration_seconds']=original['duration_seconds'];c['end']=c['start']+c['duration_seconds']
  replacement=next((a for a in changes if a['id']==c['id']),None)
  if replacement:
   c.update(file=replacement['file'],sha256=replacement['sha256'],text=replacement['text'],display_text=replacement['text'],duration_seconds=replacement['duration_seconds'],end=c['start']+replacement['duration_seconds'],speech_text=replacement['speech_text'],source={'kind':'selected_voice09_AGH_english_letter_names_postproduction','provenance_file':str((OUT/'voice/audio-provenance-v9.json').relative_to(ROOT))})
  timeline.append(c)
 assert all('艾格尼斯'not in c['display_text']for c in timeline)
 (OUT/'narration-timeline-v9.json').write_text(json.dumps({'version':9,'clips':timeline,'selected_voice_id':'09'},ensure_ascii=False,indent=2)+'\n')
 (OUT/'script-AGH-v9.txt').write_text('\n\n'.join(c['display_text']for c in timeline)+'\n')
 # Keep all unchanged caption timing/content from the accepted short film.
 spec=importlib.util.spec_from_file_location('timing6',ROOT/'scripts/demo-video/render-reference-flow-v6.py');T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T)
 caps=[c for c in T.output_caps()if not any(a['start']-1e-6<=c['start']<a['start']+next(o['duration_seconds']for o in old['clips']if o['id']==a['id'])-1e-6 for a in changes)]
 def add_words(text,start,duration,clip_id):
  chunks=phrases(text);total=sum(len(s)for s in chunks);at=start
  for text in chunks:
   end=at+duration*len(text)/total;caps.append({'start':at,'end':end,'text':text.rstrip('，。；：'),'clip_id':clip_id});at=end
 for c in changes:
  before=json.loads((OUT/'voice'/(c['id']+'-prefix')/'generation.json').read_text());after=json.loads((OUT/'voice'/(c['id']+'-suffix')/'generation.json').read_text());spell=json.loads((OUT/'voice/english-letter-names/generation.json').read_text())
  add_words(c['prefix'],c['start'],before['used_duration'],c['id'])
  letter_start=c['start']+before['used_duration'];letter_end=letter_start+spell['used_duration']+.05
  caps.append({'start':letter_start,'end':letter_end,'text':'AGH','clip_id':c['id'],'basis':'Known inserted English A,G,H waveform; includes 25ms code-switch margins.'})
  add_words(c['suffix'],letter_end,after['used_duration'],c['id'])
 caps.sort(key=lambda x:x['start']);assert not any('艾格尼斯'in c['text']for c in caps)
 (OUT/'caption-schedule-v9.json').write_text(json.dumps({'cues':caps,'kind':'Existing unchanged cues plus known prefix/acronym/suffix boundaries and proportional Chinese-clause timing'},ensure_ascii=False,indent=2)+'\n')
 def st(t):
  ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
 (OUT/'project-film-AGH-v9.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{st(c["start"])} --> {st(c["end"])}\n{c["text"]}'for i,c in enumerate(caps))+'\n')
 # Source master is decoded without added gain, EQ, or resampling changes.
 sourcewav=OUT/'voice/source-v8-audio.wav';bedwav=OUT/'voice/original-ambient-48k-stereo.wav'
 run([FF,'-nostdin','-v','error','-n','-i',OUT/'input-active/project-film.mp4','-map','0:a:0','-t','215.5','-ar','48000','-ac','2','-c:a','pcm_f32le',sourcewav])
 bg=old['background'];assert sha(ROOT/bg['file'])==bg['sha256']
 run([FF,'-nostdin','-v','error','-n','-i',ROOT/bg['file'],'-ar','48000','-ac','2','-c:a','pcm_f32le',bedwav])
 source,sr=sf.read(sourcewav,dtype='float32',always_2d=True);background,br=sf.read(bedwav,dtype='float32',always_2d=True);assert sr==br==RATE and len(source)==N
 bed=np.concatenate([background[round(a*RATE):round(b*RATE)]for a,b,_ in T.SECTIONS]);assert len(bed)==N;bed*=np.float32(10**(bg['gain_db']/20))
 output=source.copy();changed_mask=np.zeros(N,dtype=bool);regions=[]
 for c in changes:
  lo=max(0,round((c['start']-.06)*RATE));hi=min(N,round(c['end']*RATE));changed_mask[lo:hi]=True
  t=np.arange(lo,hi,dtype=np.float64)/RATE
  envelope=np.minimum(np.clip((t-(c['start']-.06))/.06,0,1),np.clip((c['end']-t)/.06,0,1)).astype(np.float32)
  voice,vr=sf.read(ROOT/c['file'],dtype='float32');assert vr==RATE
  replacement=bed[lo:hi].copy();start=round(c['start']*RATE)-lo;stop=start+len(voice);assert stop<=len(replacement)
  replacement[start:stop]+=voice[:,None]
  output[lo:hi]=source[lo:hi]*(1-envelope[:,None])+replacement*envelope[:,None]
  regions.append({'id':c['id'],'start':lo/RATE,'end':hi/RATE,'new_speech_end':c['start']+len(voice)/RATE,'background_gain_db':bg['gain_db']})
 refhash=hashlib.sha256(source[~changed_mask].tobytes()).hexdigest();newhash=hashlib.sha256(output[~changed_mask].tobytes()).hexdigest();assert refhash==newhash
 assert np.isfinite(output).all()and np.max(np.abs(output))<.99
 master=OUT/'voice/master-AGH-v9.wav';sf.write(master,output,RATE,subtype='FLOAT')
 report={'original_master_sha256':sha(sourcewav),'output_master_sha256':sha(master),'changed_regions':regions,'unchanged_pcm_reference_sha256':refhash,'unchanged_pcm_output_sha256':newhash,'unchanged_pcm_exact_before_encoding':True,'unchanged_frame_samples':int(np.count_nonzero(~changed_mask)),'total_samples':N,'peak':float(np.max(np.abs(output))),'time_stretch':False,'pitch_shift':False,'all3_new_voice_segments_complete':True,'six_other_narration_passages_preserved':True,'spoken_acronym_language':'English','spoken_acronym_text':'A, G, H.'}
 (OUT/'audio-mix-report-v9.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'new_speech_ends':[r['new_speech_end']for r in regions],'all_new_clips_fit':True,'unchanged_audio_pcm_exact':True}))
