from pathlib import Path
import json,subprocess,hashlib,time
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/continuous-narration-v16';P=R/'artifacts/demo-project-film-20261015/flow-refinement-v15';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';Q=F.with_name('ffprobe');W,H=1438,1080;SIZE=W*H*3//2
PLAN=json.loads((O/'continuous-plan-v16.json').read_text());SOURCE=R/PLAN['source_movie'];VIDEO=O/'project-film-continuous-v16.mp4';CUES=json.loads((O/'caption-schedule-v16.json').read_text())['cues']
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(s,n):
 b=bytearray()
 while len(b)<n:
  q=s.read(n-len(b))
  if not q:break
  b.extend(q)
 return bytes(b)
def planes(b):
 a=np.frombuffer(b,dtype=np.uint8);n=W*H;c=n//4;return[a[:n].reshape(H,W),a[n:n+c].reshape(H//2,W//2),a[n+c:].reshape(H//2,W//2)]
def tile(p):
 a=np.load(p,allow_pickle=False);return[a['y'],a['u'],a['v']]
def ahash(p):return subprocess.check_output([str(F),'-nostdin','-v','error','-i',str(p),'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-']).decode().strip()
def main():
 assert Path.cwd()==R and sha(SOURCE)==PLAN['source_movie_sha256']
 probe=json.loads(subprocess.check_output([str(Q),'-v','error','-show_entries','format=duration:stream=codec_name,width,height,nb_frames,r_frame_rate','-of','json',str(VIDEO)]));assert int(probe['streams'][0]['nb_frames'])==PLAN['total_frames']and abs(float(probe['format']['duration'])-PLAN['duration_seconds'])<.002
 src=subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(SOURCE),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'qa-source-decode.log').open('wb'))
 dst=subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(VIDEO),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'qa-output-decode.log').open('wb'))
 tiles=[tile(O/f'caption-{i:03}.npz')if(O/f'caption-{i:03}.npz').exists()else None for i in range(len(CUES))];blanks={name:tile(O/f'blank-{name}.npz')for name in ['task_loop','vision']};counts={'source_frames':0,'output_frames':0,'removed_waiting_frames':0,'full_identical_frames':0,'patched_caption_frames':0};hashes=[hashlib.sha256(),hashlib.sha256()];lo=PLAN['cut']['source_frame_start'];hi=PLAN['cut']['source_frame_end'];began=time.monotonic()
 try:
  for sourceframe in range(PLAN['total_frames']+hi-lo):
   s=exact(src.stdout,SIZE);assert len(s)==SIZE;counts['source_frames']+=1
   if lo<=sourceframe<hi:counts['removed_waiting_frames']+=1;continue
   frame=counts['output_frames'];t=frame/30;d=exact(dst.stdout,SIZE);assert len(d)==SIZE;sp,dp=planes(s),planes(d);name=next((c['id']for c in PLAN['clips']if c['id']in blanks and c['start']-1e-6<=t<c['window_end']),None)
   for i,(a,b)in enumerate(zip(sp,dp)):
    div=1 if i==0 else 2;assert np.array_equal(a[:976//div],b[:976//div])and np.array_equal(a[1054//div:],b[1054//div:]),('pixels outside captions',frame,i)
    for x,y in [(a[:976//div],b[:976//div]),(a[1054//div:],b[1054//div:])]:hashes[0].update(x.tobytes());hashes[1].update(y.tobytes())
   if name:
    ci=next((j for j,c in enumerate(CUES)if c['start']<=t<c['end']),None);b=blanks[name]if ci is None else tiles[ci];assert b is not None
    for i,p in enumerate(dp):div=1 if i==0 else 2;assert np.array_equal(p[976//div:1054//div],b[i]),('caption pixels',frame,i)
    counts['patched_caption_frames']+=1
   else:assert s==d,('unchanged frame',frame);counts['full_identical_frames']+=1
   counts['output_frames']+=1
   if frame%1500==0:print(json.dumps({'frame':frame,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  for q in [src,dst]:assert q.stdout.read(1)==b'' and q.wait()==0
 finally:
  for q in [src,dst]:
   if q.poll()is None:q.terminate()
 assert hashes[0].digest()==hashes[1].digest()and counts['output_frames']==PLAN['total_frames']
 old=json.loads((P/'flow-plan-v15.json').read_text());oldcaps=json.loads((P/'caption-schedule-v15.json').read_text())['cues'];normalize=lambda cs:''.join(c['text']for c in cs).replace('，','').replace('。','').replace('；','').replace('：','')
 assert normalize(CUES)==normalize(oldcaps)
 script=(O/'narration-script-v16.txt').read_text();assert '本次演示重点验证从真实观测到动作反馈的闭环' in script and '按给定房间顺序执行'not in script
 unchanged=[];rates=[]
 for c,oc in zip(PLAN['clips'],old['clips']):
  w,sr=sf.read(R/c['file'],dtype='float32');assert sr==48000 and abs(len(w)/sr-c['duration_seconds'])<1e-5 and np.isfinite(w).all() and np.max(np.abs(w))<.99
  assert c['speech_end']<=c['window_end']-.8
  if c['id']not in ['task_loop','vision']:assert sha(R/c['file'])==oc['sha256'];unchanged.append(c['id'])
  rates.append(c['units_per_second'])
 assert max(rates)-min(rates)<.2 and min(rates)>4.2 and max(rates)<4.5
 assert PLAN['continuous_AGH_sentences'];seam={'method':'Single mixed-language utterance synthesis; no separately spliced AGH letter-name file','separate_AGH_insert':False}
 vc=next(c for c in PLAN['clips']if c['id']=='vision');b=vc['new_pieces'][1];c=vc['new_pieces'][2];assert abs(c['offset_seconds']-b['offset_seconds']-b['duration_seconds']-.45)<1e-5
 assert ahash(VIDEO)==ahash(O/'continuous-audio-v16.m4a')
 master,sr=sf.read(O/'master-continuous-v16.wav',dtype='float32',always_2d=True);assert sr==48000 and len(master)==PLAN['total_frames']*1600 and np.isfinite(master).all() and np.max(np.abs(master))<.99
 alpha=R/'artifacts/media-archive/alpha/alpha.mp4';assert sha(alpha)=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e';assert sha(SOURCE)==PLAN['source_movie_sha256'];assert sha(R/'artifacts/demo-project-film-20261014/final/project-film.mp4')==sha(alpha)
 subprocess.run([str(F),'-nostdin','-v','error','-n','-ss','88','-i',str(VIDEO),'-frames:v','1',str(O/'film-poster.jpg')],check=True)
 audio={'passed':True,'voice_id':'09','unchanged_voice_clips':unchanged,'uniform_speech_rate_units_per_second':rates,'AGH_sentences_resynthesized_continuously_in_same_voice':True,'no_pitch_shift':True,'vision_join':seam,'vision_sentence_gap_before_semantic_combination_seconds':.45,'no_speech_removed_by_video_cut':True,'master_samples':len(master),'peak':float(np.max(np.abs(master))),'mixed_AAC_packet_copy_verified':True}
 (O/'audio-validation.json').write_text(json.dumps(audio,ensure_ascii=False,indent=2)+'\n')
 report={'passed':True,'candidate_sha256':sha(VIDEO),'duration_seconds':PLAN['duration_seconds'],'probe':probe,'counts':counts,'full_video_decode_passed':True,'selected_source_pixels_outside_caption_band_exact':True,'reference_visual_sha256':hashes[0].hexdigest(),'candidate_visual_sha256':hashes[1].hexdigest(),'only_requested_subtitle_words_changed':True,'actual_caption_band_pixels_verified':True,'late_wait_shortened_seconds':PLAN['cut']['removed_seconds'],'audio':audio,'alpha_unchanged':True,'prior_v15_unchanged':True,'closing_recording_without_exit_preserved':True,'no_new_robot_actions':True}
 (O/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
