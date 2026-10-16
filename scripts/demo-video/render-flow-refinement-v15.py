from pathlib import Path
import json,subprocess,hashlib,time,importlib.util
import numpy as np
from PIL import Image
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/flow-refinement-v15';P=R/'artifacts/demo-project-film-20261015/uniform-narration-v14';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';W,H=1438,1080;SIZE=W*H*3//2
PLAN=json.loads((O/'flow-plan-v15.json').read_text());S=R/PLAN['source_movie'];CUES=json.loads((O/'caption-schedule-v15.json').read_text())['cues']
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(s,n):
 b=bytearray()
 while len(b)<n:
  q=s.read(n-len(b))
  if not q:break
  b.extend(q)
 return bytes(b)
def planes(data,height=H,copy=False):
 a=np.frombuffer(data,dtype=np.uint8);n=W*height;c=n//4;p=[a[:n].reshape(height,W),a[n:n+c].reshape(height//2,W//2),a[n+c:].reshape(height//2,W//2)]
 return [x.copy()for x in p]if copy else p
def npz(p):
 d=np.load(p,allow_pickle=False);return[d['y'],d['u'],d['v']]
def pack(p):return b''.join(x.tobytes()for x in p)
def main():
 assert Path.cwd()==R and sha(S)==PLAN['source_movie_sha256']
 spec=importlib.util.spec_from_file_location('caption_style',R/'scripts/demo-video/render-project-film-map25d-v5.py');B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
 blanks={name:npz(P/f'blank-{i:02}.npz')for name,i in [('start_scan',2),('vision',4)]};atlas=[]
 for i,c in enumerate(CUES):
  tile=None
  if c.get('render_new'):
   blank=blanks[c['clip_id']];rgb=subprocess.check_output([str(F),'-v','error','-f','rawvideo','-pix_fmt','yuv420p','-s',f'{W}x78','-i','-','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],input=pack(blank));assert len(rgb)==W*78*3
   im=Image.new('RGB',(W,H),'#F5F6F7');im.paste(Image.frombytes('RGB',(W,78),rgb),(0,976));method=B.full_subtitle if c['clip_id']=='start_scan'else B.subtitle
   im=method(im,[{'start':0,'end':1,'text':c['text']}],.5);raw=im.crop((0,976,W,1054)).tobytes();encoded=subprocess.check_output([str(F),'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x78','-i','-','-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p','-'],input=raw);tile=planes(encoded,height=78,copy=True)
  elif c['clip_id']in blanks:tile=npz(P/f'caption-{c['source_cue_index']:03}.npz')
  atlas.append(tile)
  if tile is not None:np.savez_compressed(O/f'caption-{i:03}.npz',y=tile[0],u=tile[1],v=tile[2])
 for name,tile in blanks.items():np.savez_compressed(O/f'blank-{name}.npz',y=tile[0],u=tile[1],v=tile[2])
 silent=O/'project-film-flow-silent-v15.mp4';final=O/'project-film-flow-v15.mp4';assert not silent.exists()and not final.exists()
 reader=subprocess.Popen([str(F),'-nostdin','-v','error','-xerror','-threads','3','-i',str(S),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'source-decode.log').open('wb'))
 encoder=subprocess.Popen([str(F),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','yuv420p','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-qp','0','-preset','medium','-threads','6','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=(O/'encode.log').open('wb'))
 counts={'source_frames':0,'output_frames':0,'caption_patch_frames':0,'unchanged_full_frames':0,'removed_waiting_frames':0};hashes=[hashlib.sha256(),hashlib.sha256()];began=time.monotonic();lo=PLAN['cut']['source_frame_start'];hi=PLAN['cut']['source_frame_end'];oldN=PLAN['total_frames']+hi-lo
 try:
  for sourceframe in range(oldN):
   data=exact(reader.stdout,SIZE);assert len(data)==SIZE,(sourceframe,len(data));counts['source_frames']+=1
   if lo<=sourceframe<hi:counts['removed_waiting_frames']+=1;continue
   frame=counts['output_frames'];t=frame/30;src=planes(data);dst=[x.copy()for x in src];name=next((c['id']for c in PLAN['clips']if c['id']in blanks and c['start']-1e-6<=t<c['window_end']),None)
   if name:
    ci=next((j for j,c in enumerate(CUES)if c['start']<=t<c['end']),None);tile=blanks[name]if ci is None else atlas[ci];assert tile is not None
    for i,d in enumerate(dst):div=1 if i==0 else 2;d[976//div:1054//div]=tile[i]
    counts['caption_patch_frames']+=1
   else:counts['unchanged_full_frames']+=1
   for i,(s,d)in enumerate(zip(src,dst)):
    div=1 if i==0 else 2
    assert np.array_equal(s[:976//div],d[:976//div])and np.array_equal(s[1054//div:],d[1054//div:])
    for a,b in [(s[:976//div],d[:976//div]),(s[1054//div:],d[1054//div:])]:hashes[0].update(a.tobytes());hashes[1].update(b.tobytes())
   encoder.stdin.write(pack(dst));counts['output_frames']+=1
   if frame%1200==0:print(json.dumps({'frame':frame,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  assert reader.stdout.read(1)==b'';encoder.stdin.close();assert reader.wait()==0 and encoder.wait()==0
 finally:
  for q in [reader,encoder]:
   if q.poll()is None:q.terminate()
 assert counts['output_frames']==PLAN['total_frames']and hashes[0].digest()==hashes[1].digest()
 subprocess.run([str(F),'-nostdin','-v','warning','-n','-i',str(silent),'-i',str(O/'flow-audio-v15.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',str(final)],check=True,stderr=(O/'mux.log').open('wb'))
 manifest={**PLAN,'sha256':sha(final),'bytes':final.stat().st_size,'output_file':str(final.relative_to(R)),'counts':counts,'only_removed_waiting_and_requested_audio_subtitles_changed':True,'visual_pixels_outside_caption_band_preserved':True,'protected_visual_reference_sha256':hashes[0].hexdigest(),'protected_visual_candidate_sha256':hashes[1].hexdigest(),'ending_without_exit_preserved':True,'prior_v14_unchanged':sha(S)==PLAN['source_movie_sha256'],'alpha_unchanged':sha(R/'artifacts/media-archive/alpha/alpha.mp4')=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'}
 assert manifest['alpha_unchanged']and manifest['prior_v14_unchanged'];(O/'project-film-flow-v15.edit-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'render_completed':True,'seconds':PLAN['duration_seconds'],'bytes':manifest['bytes'],'counts':counts}),flush=True)
if __name__=='__main__':main()
