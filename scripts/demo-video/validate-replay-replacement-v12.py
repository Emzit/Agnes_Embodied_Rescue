from pathlib import Path
import json,hashlib,subprocess,time
import numpy as np
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/replay-replacement-v12';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';Q=F.with_name('ffprobe')
A=R/'artifacts/media-archive/alpha/alpha.mp4';V=O/'project-film-replay-v12.mp4';W,H,N=1438,1080,6465;SIZE=W*H*3//2;PIP=(1040,22,1372,198)
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(s,n):
 b=bytearray()
 while len(b)<n:
  c=s.read(n-len(b))
  if not c:break
  b.extend(c)
 return bytes(b)
def planes(b):
 a=np.frombuffer(b,dtype=np.uint8);y=W*H;c=y//4
 return [a[:y].reshape(H,W),a[y:y+c].reshape(H//2,W//2),a[y+c:].reshape(H//2,W//2)]
def audiohash(p):
 return subprocess.check_output([str(F),'-nostdin','-v','error','-i',str(p),'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-']).decode().strip()
def main():
 assert Path.cwd()==R
 assert sha(A)=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'
 meta=json.loads(subprocess.check_output([str(Q),'-v','error','-show_entries','format=duration:stream=codec_name,width,height,nb_frames,r_frame_rate','-of','json',str(V)]));assert int(meta['streams'][0]['nb_frames'])==N and float(meta['format']['duration'])==215.5
 readers=[subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(f),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/('qa-'+name+'-decode.log')).open('wb'))for f,name in [(A,'alpha'),(V,'candidate')]]
 count={'identical_intro_full_frames':0,'identical_technical_frames_outside_recorded_inset':0,'identical_caption_band_frames':0};changes=0;hashes=[hashlib.sha256(),hashlib.sha256()];started=time.monotonic()
 try:
  for frame in range(N):
   x=exact(readers[0].stdout,SIZE);y=exact(readers[1].stdout,SIZE);assert len(x)==SIZE and len(y)==SIZE,frame
   a,b=planes(x),planes(y)
   if x!=y:changes+=1
   for i,(s,d)in enumerate(zip(a,b)):
    div=1 if i==0 else 2;band=s[976//div:];other=d[976//div:];assert np.array_equal(band,other),('caption-band',frame,i)
    if frame<675:
     assert np.array_equal(s,d),('intro',frame,i);pieces=[(s,d)]
    elif 1540<=frame<4800:
     x0,y0,x1,y1=[v//div for v in PIP];pieces=[(s[:y0],d[:y0]),(s[y1:],d[y1:]),(s[y0:y1,:x0],d[y0:y1,:x0]),(s[y0:y1,x1:],d[y0:y1,x1:])]
     assert all(np.array_equal(c,e)for c,e in pieces),('technical-outside-pip',frame,i)
    else:pieces=[(band,other)]
    for c,e in pieces:hashes[0].update(c.tobytes());hashes[1].update(e.tobytes())
   count['identical_caption_band_frames']+=1
   if frame<675:count['identical_intro_full_frames']+=1
   elif 1540<=frame<4800:count['identical_technical_frames_outside_recorded_inset']+=1
   if frame%900==0:print(json.dumps({'validated_frame':frame,'elapsed':round(time.monotonic()-started,1)}),flush=True)
  for p in readers:assert p.stdout.read(1)==b'' and p.wait()==0
 finally:
  for p in readers:
   if p.poll()is None:p.terminate()
 assert hashes[0].digest()==hashes[1].digest()
 ah,bh=audiohash(A),audiohash(V);assert ah==bh,(ah,bh)
 assert sha(O/'project-film-replay-v12.zh-CN.srt')==sha(A.with_name('alpha.zh-CN.srt'))
 assert count=={'identical_intro_full_frames':675,'identical_technical_frames_outside_recorded_inset':3260,'identical_caption_band_frames':6465};assert changes>5000,changes
 initial=R/'artifacts/demo-video/autonomous-delivery-20261014/initial-search.mp4';supplement=initial.with_name('supplement-open-approach.mp4')
 assert sha(initial)=='711e03d49a3177142e8b748b3f96047a736f3e262c40c5decce8896d4642ceb5' and sha(supplement)=='88d691eeebe81bf586e6f59099743828183a70ecdffc0c6a008d1ae3362a7c2e'
 assert sha(A)=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'
 for file,sec,name in [(V,24,'film-poster.jpg'),(O/'merged-robot-actions.mp4',0,'merged-poster.jpg')]:
  subprocess.run([str(F),'-nostdin','-v','error','-n','-ss',str(sec),'-i',str(file),'-frames:v','1',str(O/name)],check=True)
 report={'passed':True,'video_complete_decode':True,'candidate_sha256':sha(V),'candidate_bytes':V.stat().st_size,'probe':meta,'decoded_YUV_pixel_preservation':{'counts':count,'protected_regions_reference_sha256':hashes[0].hexdigest(),'protected_regions_candidate_sha256':hashes[1].hexdigest(),'exact':True},'audio_AAC_payload_sha256':ah,'audio_packet_copy_verified':True,'srt_byte_identical':True,'alpha_unchanged':True,'alpha_sha256':sha(A),'original_two_recordings_unchanged':True,'modified_video_frames':changes,'transition_scope':'Only source footage under the existing 0.5-second opening dissolve and 10-frame first diagram reveal is replaced; the same accepted graphic and easing functions are used.'}
 (O/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
