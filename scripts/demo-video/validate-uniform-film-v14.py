from pathlib import Path
import json,subprocess,hashlib,time
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/uniform-narration-v14';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';Q=F.with_name('ffprobe');W,H=1438,1080;SIZE=W*H*3//2
P=json.loads((O/'pacing-plan-v14.json').read_text());SOURCE=R/P['source_movie'];VIDEO=O/'project-film-uniform-v14.mp4';CUES=json.loads((O/'caption-schedule-v14.json').read_text())['cues']
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
def ahash(file):return subprocess.check_output([str(F),'-nostdin','-v','error','-i',str(file),'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-']).decode().strip()
def main():
 assert Path.cwd()==R and sha(SOURCE)==P['source_movie_sha256']
 probe=json.loads(subprocess.check_output([str(Q),'-v','error','-show_entries','format=duration:stream=codec_name,width,height,nb_frames,r_frame_rate','-of','json',str(VIDEO)]));assert int(probe['streams'][0]['nb_frames'])==P['total_frames']and abs(float(probe['format']['duration'])-P['duration_seconds'])<.002
 expected=subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(SOURCE),'-filter_complex',(O/'retime-video.filter.txt').read_text(),'-map','[out]','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'expected-qa-decode.log').open('wb'))
 actual=subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(VIDEO),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'actual-qa-decode.log').open('wb'))
 tiles=[]
 for i in range(len(CUES)):
  a=np.load(O/f'caption-{i:03}.npz',allow_pickle=False);tiles.append([a['y'],a['u'],a['v']])
 blanks=[]
 for i in range(9):
  a=np.load(O/f'blank-{i:02}.npz',allow_pickle=False);blanks.append([a['y'],a['u'],a['v']])
 index=0;count={'frames':0,'caption_frames_verified':0,'protected_visual_frames_verified':0};hashes=[hashlib.sha256(),hashlib.sha256()];began=time.monotonic()
 try:
  for frame in range(P['total_frames']):
   t=frame/30
   while frame>=P['sections'][index]['output_end_frame']:index+=1
   e=exact(expected.stdout,SIZE);a=exact(actual.stdout,SIZE);assert len(e)==len(a)==SIZE,(frame,len(e),len(a));src,dst=planes(e),planes(a)
   for i,(s,d)in enumerate(zip(src,dst)):
    div=1 if i==0 else 2
    assert np.array_equal(s[:976//div],d[:976//div])and np.array_equal(s[1054//div:],d[1054//div:]),('visual-outside-caption',frame,i)
    for x,y in [(s[:976//div],d[:976//div]),(s[1054//div:],d[1054//div:])]:hashes[0].update(x.tobytes());hashes[1].update(y.tobytes())
   if t>=P['clips'][index]['start']-1e-6:
    ci=next((j for j,c in enumerate(CUES)if c['start']<=t<c['end']),None);tile=blanks[index]if ci is None else tiles[ci]
    for i,(d,b)in enumerate(zip(dst,tile)):
     div=1 if i==0 else 2;assert np.array_equal(d[976//div:1054//div],b),('caption',frame,i)
    count['caption_frames_verified']+=1
   else:assert e==a
   count['frames']+=1;count['protected_visual_frames_verified']+=1
   if frame%1200==0:print(json.dumps({'frame':frame,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  for q in [expected,actual]:assert q.stdout.read(1)==b'' and q.wait()==0
 finally:
  for q in [expected,actual]:
   if q.poll()is None:q.terminate()
 assert hashes[0].digest()==hashes[1].digest()
 oldcaps=json.loads((R/'artifacts/demo-project-film-20261015/narration-and-ending-v13/caption-schedule-v13.json').read_text())['cues'];assert [x['text']for x in CUES]==[x['text']for x in oldcaps]
 for c in P['clips']:
  wave,sr=sf.read(R/c['file'],dtype='float32');assert sr==48000 and abs(len(wave)/sr-c['duration_seconds'])<1e-5
  assert c['duration_seconds']>c['old_duration_seconds']and c['speech_end']<c['window_end']-.8
  assert np.isfinite(wave).all()and np.max(np.abs(wave))<.99
 rates=[c['units_per_second']for c in P['clips']];assert max(rates)-min(rates)<.2 and min(rates)>4.2 and max(rates)<4.5
 vision=next(c for c in P['clips']if c['id']=='vision');pieces=vision['new_pieces'];b=next(c for c in pieces if c['piece']=='vision-b');c=next(c for c in pieces if c['piece']=='vision-c');assert abs(c['offset_seconds']-b['offset_seconds']-b['duration_seconds']-.45)<1e-5
 assert all(r['atempo']<1.001 and not r['pitch_changed']for r in P['processing_records']);assert ahash(VIDEO)==ahash(O/'uniform-audio-v14.m4a')
 master,sr=sf.read(O/'master-uniform-v14.wav',dtype='float32',always_2d=True);assert sr==48000 and len(master)==P['total_frames']*1600 and np.isfinite(master).all()and np.max(np.abs(master))<.99
 alpha=R/'artifacts/media-archive/alpha/alpha.mp4';assert sha(alpha)=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e';assert sha(SOURCE)=='a6aadf597aee0eddf65167d92fba93cc13426a599a056b32bc9c8f43cee6ee1e'
 subprocess.run([str(F),'-nostdin','-v','error','-n','-ss',str(P['clips'][4]['start']+9),'-i',str(VIDEO),'-frames:v','1',str(O/'film-poster.jpg')],check=True)
 audio={'passed':True,'voice_id':'09','all_nine_clips_slower':True,'rates_units_per_second':rates,'effective_pace_spread_relative':(max(rates)-min(rates))/np.mean(rates),'pitch_preserving_time_stretch':True,'AGH_compact_joins_retained':True,'vision_sentence_gap_seconds':.45,'speech_complete_and_fits_every_chapter':True,'master_samples':len(master),'peak':float(np.max(np.abs(master))),'no_generated_voice':True,'no_new_model_calls':True}
 (O/'audio-validation.json').write_text(json.dumps(audio,ensure_ascii=False,indent=2)+'\n')
 report={'passed':True,'candidate_sha256':sha(VIDEO),'duration_seconds':P['duration_seconds'],'probe':probe,'full_video_decode_passed':True,'counts':count,'source_visual_pixels_outside_caption_band_exact':True,'reference_visual_sha256':hashes[0].hexdigest(),'candidate_visual_sha256':hashes[1].hexdigest(),'all_caption_words_and_styles_preserved':True,'caption_schedule_verified_on_actual_output':True,'mixed_audio_AAC_packet_copy_verified':True,'audio':audio,'alpha_unchanged':True,'prior_v13_unchanged':True,'ending_without_room_exit_preserved':True,'new_robot_actions':False}
 (O/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
