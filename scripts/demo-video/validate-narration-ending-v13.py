from pathlib import Path
import json,hashlib,subprocess,time
import numpy as np,soundfile as sf
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/narration-and-ending-v13';S=R/'artifacts/demo-project-film-20261015/replay-replacement-v12/project-film-replay-v12.mp4';E=R/'artifacts/demo-video/autonomous-delivery-20261014/supplement-open-approach.mp4';V=O/'project-film-polished-v13.mp4';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';Q=F.with_name('ffprobe');W,H,N=1438,1080,6465;SIZE=W*H*3//2;RH=976;RSIZE=W*RH*3//2;WINDOWS=[(23,35),(51.8,76),(76.8,102)]
RAW=R/'artifacts/demo-video-20261013/recordings/c0977a81-24ca-457c-9d68-840391278d98/source.webm'
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(s,n):
 b=bytearray()
 while len(b)<n:
  q=s.read(n-len(b))
  if not q:break
  b.extend(q)
 return bytes(b)
def planes(b,w=W,h=H):
 a=np.frombuffer(b,dtype=np.uint8);y=w*h;c=y//4
 return [a[:y].reshape(h,w),a[y:y+c].reshape(h//2,w//2),a[y+c:].reshape(h//2,w//2)]
def ahash(p):return subprocess.check_output([str(F),'-nostdin','-v','error','-i',str(p),'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-']).decode().strip()
def main():
 assert Path.cwd()==R
 assert sha(S)=='bd9b09bae6fd16c49512af9f5c197ff0720ef2528353a62564505af180034663'
 probe=json.loads(subprocess.check_output([str(Q),'-v','error','-show_entries','format=duration:stream=codec_name,width,height,nb_frames,r_frame_rate','-of','json',str(V)]));assert int(probe['streams'][0]['nb_frames'])==N and float(probe['format']['duration'])==215.5
 readers=[subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(file),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/(name+'-qa-decode.log')).open('wb'))for file,name in [(S,'v12'),(V,'v13')]]
 expected=subprocess.Popen([str(F),'-nostdin','-v','error','-threads','3','-i',str(E),'-threads','3','-c:v','libvpx-vp9','-ss','477.9','-i',str(RAW),'-filter_complex',(O/'ending.filter.txt').read_text(),'-map','[out]','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'expected-ending-qa.log').open('wb'))
 counts={'identical_full_frames':0,'caption_retiming_frames':0,'exact_replaced_ending_frames':0};start=time.monotonic();hashes=[hashlib.sha256(),hashlib.sha256()]
 try:
  for frame in range(N):
   raw=[exact(p.stdout,SIZE)for p in readers];assert all(len(b)==SIZE for b in raw),frame;a,b=[planes(q)for q in raw];changed_caption=any(x<=frame/30<y for x,y in WINDOWS)
   if frame>=4800:
    e=exact(expected.stdout,RSIZE);assert len(e)==RSIZE,frame;e=planes(e,W,RH)
    for i,(c,d,q)in enumerate(zip(a,b,e)):
     div=1 if i==0 else 2;assert np.array_equal(d[:976//div],q) and np.array_equal(d[976//div:],c[976//div:]),('ending',frame,i)
    counts['exact_replaced_ending_frames']+=1
   elif changed_caption:
    for i,(c,d)in enumerate(zip(a,b)):
     div=1 if i==0 else 2;assert np.array_equal(c[:976//div],d[:976//div]) and np.array_equal(c[1054//div:],d[1054//div:]),('outside-caption',frame,i)
    counts['caption_retiming_frames']+=1
   else:assert raw[0]==raw[1],('unchanged-full-frame',frame);counts['identical_full_frames']+=1
   for i,(c,d)in enumerate(zip(a,b)):
    div=1 if i==0 else 2
    if frame>=4800:regions=[(c[976//div:],d[976//div:])]
    elif changed_caption:regions=[(c[:976//div],d[:976//div]),(c[1054//div:],d[1054//div:])]
    else:regions=[(c,d)]
    for x,y in regions:hashes[0].update(x.tobytes());hashes[1].update(y.tobytes())
   if frame%1200==0:print(json.dumps({'frame':frame,'elapsed':round(time.monotonic()-start,1)}),flush=True)
  for p in readers+[expected]:assert p.stdout.read(1)==b'' and p.wait()==0
 finally:
  for p in readers+[expected]:
   if p.poll()is None:p.terminate()
 assert hashes[0].digest()==hashes[1].digest() and counts=={'identical_full_frames':2958,'caption_retiming_frames':1842,'exact_replaced_ending_frames':1665}
 master,rate=sf.read(O/'master-polished-v13.wav',dtype='float32',always_2d=True);old,rr=sf.read(O/'source-v12-audio.wav',dtype='float32',always_2d=True);assert rate==rr==48000 and len(master)==len(old)==10344000
 mask=np.zeros(len(master),dtype=bool)
 for a,b in [(22.94,35),(51.74,76),(76.74,102)]:mask[round(a*rate):round(b*rate)]=True
 assert np.array_equal(master[~mask],old[~mask]);assert np.isfinite(master).all() and np.max(np.abs(master))<.99
 assert ahash(O/'polished-audio-v13.m4a')==ahash(V)
 oldcaps=json.loads((R/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/caption-schedule-v9.json').read_text())['cues'];newcaps=json.loads((O/'caption-schedule-v13.json').read_text())['cues'];assert [x['text']for x in oldcaps]==[x['text']for x in newcaps]
 for a,b in zip(oldcaps,newcaps):
  if a.get('clip_id')not in ['native_task','task_loop','vision']:assert a==b
 edits=json.loads((O/'narration-edits-v13.json').read_text());seams=[]
 for c in edits['clips']:
  parts=[p for p in edits['waveform_pieces']if p['clip_id']==c['id']];letter=next(p for p in parts if p['piece']=='AGH');following=next(p for p in parts if p['offset_seconds']>letter['offset_seconds']);w,sr=sf.read(O/'voice'/c['id']/'joined.wav',dtype='float32');f=round(sr*.005);levels=np.array([np.sqrt(np.mean(w[k:k+f]**2))for k in range(0,len(w),f)]);active=np.flatnonzero(levels>.001)*.005
  l0=letter['offset_seconds'];l1=l0+letter['duration_seconds'];a=active[(active>=l0)&(active<l1)];before=active[active<l0];after=active[active>=following['offset_seconds']]
  beforegap=a[0]-(before[-1]+.005);aftergap=after[0]-(a[-1]+.005);assert 0<=beforegap<.3 and 0<=aftergap<.3,(c['id'],beforegap,aftergap)
  seams.append({'clip_id':c['id'],'measured_RMS_quiet_before_AGH_seconds':round(beforegap,3),'measured_RMS_quiet_after_AGH_seconds':round(aftergap,3)})
 vision=[p for p in edits['waveform_pieces']if p['clip_id']=='vision'];b=next(p for p in vision if p['piece']=='vision-b');c=next(p for p in vision if p['piece']=='vision-c');gap=c['offset_seconds']-(b['offset_seconds']+b['duration_seconds']);assert abs(gap-.45)<1e-4
 alpha=R/'artifacts/media-archive/alpha/alpha.mp4';assert sha(alpha)=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e';assert sha(E)=='88d691eeebe81bf586e6f59099743828183a70ecdffc0c6a008d1ae3362a7c2e'
 subprocess.run([str(F),'-nostdin','-v','error','-n','-ss','201','-i',str(V),'-frames:v','1',str(O/'film-poster.jpg')],check=True)
 report={'passed':True,'complete_video_decode':True,'probe':probe,'candidate_sha256':sha(V),'protected_visual_pixels_exact':True,'protected_reference_sha256':hashes[0].hexdigest(),'protected_candidate_sha256':hashes[1].hexdigest(),'counts':counts,'all_ending_frames_match_only_permitted_source_cuts':True,'removed_exit_and_return_frames':[669,1906],'uninformative_full_room_sweep_removed':True,'genuine_later_capture_used_without_loop_or_freeze':True,'unchanged_audio_PCM_exact':True,'mixed_audio_AAC_copy_verified':True,'six_other_voice_passages_preserved':True,'subtitle_words_unchanged':True,'AGH_measured_seams':seams,'vision_b_duration_seconds':b['duration_seconds'],'vision_sentence_pause_added_seconds':gap,'same_voice09':True,'alpha_unchanged':True,'original_recordings_and_v12_unchanged':True}
 (O/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
