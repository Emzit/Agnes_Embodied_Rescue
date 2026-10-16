from pathlib import Path
import json,subprocess,hashlib,time
import numpy as np
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/uniform-narration-v14';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';W,H=1438,1080;SIZE=W*H*3//2
PLAN=json.loads((O/'pacing-plan-v14.json').read_text());S=R/PLAN['source_movie'];CUES=json.loads((O/'caption-schedule-v14.json').read_text())['cues']
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(s,n):
 b=bytearray()
 while len(b)<n:
  q=s.read(n-len(b))
  if not q:break
  b.extend(q)
 return bytes(b)
def planes(data,copy=False):
 a=np.frombuffer(data,dtype=np.uint8);n=W*H;c=n//4;p=[a[:n].reshape(H,W),a[n:n+c].reshape(H//2,W//2),a[n+c:].reshape(H//2,W//2)]
 return [x.copy()for x in p]if copy else p
def band(t):
 b=subprocess.check_output([str(F),'-nostdin','-v','error','-threads','3','-ss',str(t),'-i',str(S),'-frames:v','1','-map','0:v:0','-f','rawvideo','-pix_fmt','yuv420p','-']);assert len(b)==SIZE
 return [p[976//(1 if i==0 else 2):1054//(1 if i==0 else 2)].copy()for i,p in enumerate(planes(b))]
def pack(p):return b''.join(x.tobytes()for x in p)
def main():
 assert Path.cwd()==R and sha(S)==PLAN['source_movie_sha256']
 atlas=[]
 for i,c in enumerate(CUES):
  tile=band((c['source_start']+c['source_end'])/2);atlas.append(tile);np.savez_compressed(O/f'caption-{i:03}.npz',y=tile[0],u=tile[1],v=tile[2])
 blanks=[];old=json.loads((R/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/narration-timeline-v9.json').read_text())['clips'];updated={c['id']:c for c in json.loads((R/'artifacts/demo-project-film-20261015/narration-and-ending-v13/narration-edits-v13.json').read_text())['clips']}
 for i,(section,c)in enumerate(zip(PLAN['sections'],old)):
  a={**c,**updated.get(c['id'],{})};t=min(section['source_end']-.2,a['start']+a['duration_seconds']+.3);tile=band(t);blanks.append(tile);np.savez_compressed(O/f'blank-{i:02}.npz',y=tile[0],u=tile[1],v=tile[2])
 filters=[]
 for i,c in enumerate(PLAN['sections']):
  filters.append(f"[0:v]trim=start_frame={c['source_frame_start']}:end_frame={c['source_frame_end']},setpts=(PTS-STARTPTS)/{c['video_timing_factor']:.14f},tpad=stop_mode=clone:stop_duration=0.1,fps=30,trim=end_frame={c['frames']},setpts=PTS-STARTPTS,setsar=1[s{i}]")
 filters.append(''.join(f'[s{i}]'for i in range(len(PLAN['sections'])))+'concat=n=9:v=1:a=0[out]');flt=';'.join(filters);(O/'retime-video.filter.txt').write_text(';\n'.join(filters))
 silent=O/'project-film-uniform-silent-v14.mp4';final=O/'project-film-uniform-v14.mp4';assert not silent.exists()and not final.exists()
 reader=subprocess.Popen([str(F),'-nostdin','-v','error','-threads','3','-i',str(S),'-filter_complex',flt,'-map','[out]','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'retime-decode.log').open('wb'))
 encoder=subprocess.Popen([str(F),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','yuv420p','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-qp','0','-preset','medium','-threads','6','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=(O/'encode.log').open('wb'))
 idx=0;start=time.monotonic();counts={'frames':0,'caption_retiming_frames':0};hashes=[hashlib.sha256(),hashlib.sha256()]
 try:
  for frame in range(PLAN['total_frames']):
   while frame>=PLAN['sections'][idx]['output_end_frame']:idx+=1
   t=frame/30;b=exact(reader.stdout,SIZE);assert len(b)==SIZE,(frame,len(b));src=planes(b);dst=[p.copy()for p in src]
   if t>=PLAN['clips'][idx]['start']-1e-6:
    ci=next((j for j,c in enumerate(CUES)if c['start']<=t<c['end']),None);tile=blanks[idx]if ci is None else atlas[ci]
    for i,(d,v)in enumerate(zip(dst,tile)):
     div=1 if i==0 else 2;d[976//div:1054//div]=v
    counts['caption_retiming_frames']+=1
   for i,(s,d)in enumerate(zip(src,dst)):
    div=1 if i==0 else 2;assert np.array_equal(s[:976//div],d[:976//div])and np.array_equal(s[1054//div:],d[1054//div:])
    for a,e in [(s[:976//div],d[:976//div]),(s[1054//div:],d[1054//div:])]:hashes[0].update(a.tobytes());hashes[1].update(e.tobytes())
   encoder.stdin.write(pack(dst));counts['frames']+=1
   if frame%600==0:print(json.dumps({'frame':frame,'seconds':t,'elapsed':round(time.monotonic()-start,1)}),flush=True)
  assert reader.stdout.read(1)==b'';encoder.stdin.close();assert encoder.wait()==0 and reader.wait()==0
 finally:
  for p in [reader,encoder]:
   if p.poll()is None:p.terminate()
 run=subprocess.run([str(F),'-nostdin','-v','warning','-n','-i',str(silent),'-i',str(O/'uniform-audio-v14.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',str(final)],capture_output=True);(O/'mux.log').write_bytes(run.stderr);assert run.returncode==0,run.stderr.decode()
 report={**PLAN,'kind':'UNIFIED_CALMER_VOICE09_NARRATION_WITH_SYNCHRONIZED_VIDEO_AND_SUBTITLES','title':'具身救援 · 从指令到行动','sha256':sha(final),'bytes':final.stat().st_size,'output_file':str(final.relative_to(R)),'technical_animation_artwork_and_native_recording_content_unchanged':True,'only_video_timing_and_caption_display_timing_changed':True,'source_ending_without_exit_and_return_preserved':True,'new_recorded_actions':False,'new_generated_voice':False,'video_encoding':'Lossless YUV420; decoded source visual pixels outside retimed caption band preserved at each selected source frame.','protected_visual_reference_sha256':hashes[0].hexdigest(),'protected_visual_output_sha256':hashes[1].hexdigest(),'counts':counts,'alpha_unchanged':True,'prior_v13_unchanged':True}
 assert hashes[0].digest()==hashes[1].digest();assert sha(S)==PLAN['source_movie_sha256'];assert sha(R/'artifacts/media-archive/alpha/alpha.mp4')=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'
 (O/'project-film-uniform-v14.edit-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'completed':True,'duration_seconds':PLAN['duration_seconds'],'bytes':report['bytes']}),flush=True)
if __name__=='__main__':main()
