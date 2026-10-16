from pathlib import Path
import subprocess,json,hashlib,time
import numpy as np
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/narration-and-ending-v13';S=R/'artifacts/demo-project-film-20261015/replay-replacement-v12/project-film-replay-v12.mp4';E=R/'artifacts/demo-video/autonomous-delivery-20261014/supplement-open-approach.mp4';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
RAW=R/'artifacts/demo-video-20261013/recordings/c0977a81-24ca-457c-9d68-840391278d98/source.webm'
W,H,N=1438,1080,6465;SIZE=W*H*3//2;FH=976;ESIZE=W*FH*3//2;BAND=(976,1054);WINDOWS=[(23,35),(51.8,76),(76.8,102)]
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(s,n):
 b=bytearray()
 while len(b)<n:
  v=s.read(n-len(b))
  if not v:break
  b.extend(v)
 return bytes(b)
def planes(b,w=W,h=H,copy=False):
 a=np.frombuffer(b,dtype=np.uint8);y=w*h;c=y//4;p=[a[:y].reshape(h,w),a[y:y+c].reshape(h//2,w//2),a[y+c:].reshape(h//2,w//2)]
 return [x.copy()for x in p]if copy else p
def frame_at(time):
 data=subprocess.check_output([str(F),'-nostdin','-v','error','-threads','3','-ss',str(time),'-i',str(S),'-map','0:v:0','-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p','-']);assert len(data)==SIZE;return planes(data)
def band_at(time):return [p[BAND[0]//(1 if i==0 else 2):BAND[1]//(1 if i==0 else 2)].copy()for i,p in enumerate(frame_at(time))]
def packed(p):return b''.join(x.tobytes()for x in p)
def main():
 assert Path.cwd()==R and sha(S)=='bd9b09bae6fd16c49512af9f5c197ff0720ef2528353a62564505af180034663'
 assert json.loads((O/'audio-validation.json').read_text())['unchanged_PCM_exact']
 cues=json.loads((O/'caption-schedule-v13.json').read_text())['cues'];changes=[c for c in cues if c.get('clip_id') in ['native_task','task_loop','vision']]
 tiles=[band_at((c['source_caption_start']+c['source_caption_end'])/2)for c in changes]
 blank={k:band_at(t)for k,t in [('native_task',35.15),('task_loop',51.6),('vision',76.5)]}
 # Reuse the original rendered caption pixels: only their timing changes.
 for j,tile in enumerate(tiles):np.savez_compressed(O/f'caption-tile-{j:02}.npz',y=tile[0],u=tile[1],v=tile[2])
 sections=[{'source_kind':'edited-supplement','source_frames':[0,258],'output_frames':[4800,4980],'label':'Right-front door opening'},
 {'source_kind':'edited-supplement','source_frames':[258,420],'output_frames':[4980,5205],'label':'First entry through the open doorway; cut before uninformative wall sweep'},
 {'source_kind':'original-raw-capture','source_seconds':[477.9,493.4],'output_frames':[5205,5790],'label':'Genuine close multiview observations of the person in the room'},
 {'source_kind':'original-raw-capture','source_seconds':[493.4,511.4],'output_frames':[5790,6330],'label':'Live verified person view during unchanged closing explanation'},
 {'source_kind':'original-raw-capture','source_seconds':[535.9,540.4],'output_frames':[6330,6465],'label':'Verified stop and final target view'}]
 filters=[]
 for i,c in enumerate(sections):
  frames=c['output_frames'][1]-c['output_frames'][0]
  if c['source_kind']=='edited-supplement':
   a,b=c['source_frames'];speed=(b-a)/frames;trim=f'[0:v]trim=start_frame={a}:end_frame={b}';spatial='scale=1438:810:flags=lanczos,pad=1438:976:0:82:color=0xF5F6F7,setsar=1'
  else:
   a,b=c['source_seconds'];speed=(b-a)/(frames/30);trim=f'[1:v]trim=start={a-477.9:.6f}:end={b-477.9:.6f}';spatial='crop=1420:750:8:56,scale=1438:760:flags=lanczos,pad=1438:976:0:108:color=0xF5F6F7,setsar=1'
  c['editorial_speed_vs_source']=speed
  filters.append(f'{trim},setpts=(PTS-STARTPTS)/{speed:.14f},tpad=stop_mode=clone:stop_duration=0.1,fps=30,trim=end_frame={frames},setpts=PTS-STARTPTS,{spatial}[e{i}]')
 filters.append('[e0][e1][e2][e3][e4]concat=n=5:v=1:a=0[out]')
 (O/'ending.filter.txt').write_text(';\n'.join(filters))
 sources=[subprocess.Popen([str(F),'-nostdin','-v','error','-threads','3','-i',str(S),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'base-decode.log').open('wb')),
 subprocess.Popen([str(F),'-nostdin','-v','error','-threads','3','-i',str(E),'-threads','3','-c:v','libvpx-vp9','-ss','477.9','-i',str(RAW),'-filter_complex',';'.join(filters),'-map','[out]','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'ending-decode.log').open('wb'))]
 silent=O/'project-film-polished-silent-v13.mp4';final=O/'project-film-polished-v13.mp4';assert not silent.exists()and not final.exists()
 encoder=subprocess.Popen([str(F),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','yuv420p','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','medium','-threads','6','-qp','0','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=(O/'encode.log').open('wb'))
 counts={'base_full_frames_exact':0,'retimed_caption_band_frames':0,'replaced_ending_frames':0};start=time.monotonic()
 try:
  for frame in range(N):
   data=exact(sources[0].stdout,SIZE);assert len(data)==SIZE,(frame,len(data));src=planes(data);dst=[p.copy()for p in src];t=frame/30;changed=False
   if frame>=4800:
    end=exact(sources[1].stdout,ESIZE);assert len(end)==ESIZE,(frame,len(end));p=planes(end,W,FH)
    for d,e in zip(dst,p):d[:e.shape[0]]=e
    counts['replaced_ending_frames']+=1;changed=True
   if any(a<=t<b for a,b in WINDOWS):
    clip='native_task'if t<35 else 'task_loop'if t<76 else 'vision'
    tile=next((tile for c,tile in zip(changes,tiles)if c['start']<=t<c['end']),blank[clip])
    for i,(d,b)in enumerate(zip(dst,tile)):
     div=1 if i==0 else 2;d[976//div:1054//div]=b
    counts['retimed_caption_band_frames']+=1;changed=True
   if not changed:assert packed(dst)==data;counts['base_full_frames_exact']+=1
   for i,(d,s)in enumerate(zip(dst,src)):
    div=1 if i==0 else 2
    if frame<4800:assert np.array_equal(d[:976//div],s[:976//div])
    if frame>=4800:assert np.array_equal(d[976//div:],s[976//div:])
    assert np.array_equal(d[1054//div:],s[1054//div:])
   encoder.stdin.write(packed(dst))
   if frame%600==0:print(json.dumps({'frame':frame,'seconds':t,'elapsed':round(time.monotonic()-start,1)}),flush=True)
  for p in sources:assert p.stdout.read(1)==b''
  encoder.stdin.close();assert encoder.wait()==0
  for p in sources:assert p.wait()==0
 finally:
  for p in sources+[encoder]:
   if p.poll()is None:p.terminate()
 run=subprocess.run([str(F),'-nostdin','-v','warning','-n','-i',str(silent),'-i',str(O/'polished-audio-v13.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',str(final)],capture_output=True);(O/'mux.log').write_bytes(run.stderr);assert run.returncode==0,run.stderr.decode()
 report={'version':13,'kind':'USER_REQUESTED_AGH_SEAM_VISION_PACING_AND_ROOM_EXIT_CUT','title':'具身救援 · 从指令到行动','duration_seconds':215.5,'frames':N,'dimensions':[W,H],'source_v12':str(S.relative_to(R)),'source_v12_sha256':sha(S),'output_file':str(final.relative_to(R)),'sha256':sha(final),'bytes':final.stat().st_size,'technical_animation_and_all_nonfinal_recorded_views_preserved_exact_before_subtitle_band':True,'changed_subtitle_band':[976,1054],'subtitle_words_unchanged':True,'caption_windows':WINDOWS,'six_other_narration_clips_unchanged':True,'ending_source':str(E.relative_to(R)),'ending_source_sha256':sha(E),'raw_capture_source':str(RAW.relative_to(R)),'raw_capture_sha256':sha(RAW),'raw_decoder':'libvpx-vp9','raw_UI_crop':[8,56,1420,750],'ending_sections':sections,'removed_ending_source_frames':[669,1906],'removed_ending_source_seconds':[669/30,1906/30],'removed_content':'Exit, return and uninformative wall sweep omitted. First entry, genuine close multiview verification and live final person evidence remain. No loops or frozen/synthetic frames; unchanged closing voice plays over actual later capture.','montage_does_not_claim_continuous_recording':True,'post_confirmation_live_frames_used_instead_of_loop_or_freeze':True,'synthetic_actions':False,'new_robot_actions':False,'counts':counts,'frozen_alpha_unchanged':True,'prior_v12_and_original_two_recordings_unchanged':True,'audio_provenance':str((O/'narration-edits-v13.json').relative_to(R))}
 alpha=R/'artifacts/media-archive/alpha/alpha.mp4';assert sha(alpha)=='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'
 (O/'project-film-polished-v13.edit-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'completed':True,'bytes':report['bytes'],'counts':counts}),flush=True)
if __name__=='__main__':main()
