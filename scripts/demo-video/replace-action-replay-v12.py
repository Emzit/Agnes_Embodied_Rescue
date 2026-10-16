"""Replace only recorded views in a separate derivative; preserve Alpha and accepted sound/text."""
from pathlib import Path
import subprocess,json,hashlib,time,shutil,importlib.util,io
import numpy as np
from PIL import Image,ImageDraw
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/demo-project-film-20261015/replay-replacement-v12'
A=R/'artifacts/media-archive/alpha/alpha.mp4';S=O/'merged-robot-actions.mp4';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
W,H,FPS,N=1438,1080,30,6465;Y=W*H;UV=Y//4;SIZE=Y+2*UV;RH=976;REPLAY_SIZE=W*RH*3//2
PIP=(1040,22,1372,198);ALPHA_SHA='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def exact(stream,n):
 b=bytearray()
 while len(b)<n:
  t=stream.read(n-len(b))
  if not t:break
  b.extend(t)
 return bytes(b)
def planes(data,w=W,h=H,copy=False):
 a=np.frombuffer(data,dtype=np.uint8);y=w*h;c=y//4
 v=[a[:y].reshape(h,w),a[y:y+c].reshape(h//2,w//2),a[y+c:].reshape(h//2,w//2)]
 return [p.copy() for p in v] if copy else v
def packed(p):return b''.join(x.tobytes()for x in p)
def caption_restore(dst,src):
 for i,(d,s)in enumerate(zip(dst,src)):d[976//(1 if i==0 else 2):]=s[976//(1 if i==0 else 2):]
def inset(dst,replay):
 x0,y0,x1,y1=PIP
 for i,(d,s)in enumerate(zip(dst,replay)):
  div=1 if i==0 else 2
  content=s[(82+24)//div:(82+786)//div]
  tile=np.asarray(Image.fromarray(content).resize(((x1-x0)//div,(y1-y0)//div),Image.Resampling.LANCZOS))
  d[y0//div:y1//div,x0//div:x1//div]=tile

def raw_to_rgb(data):
 b=subprocess.check_output([str(F),'-nostdin','-v','error','-f','rawvideo','-pix_fmt','yuv420p','-s',f'{W}x{H}','-i','-','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],input=data)
 return Image.frombytes('RGB',(W,H),b)
def rgb_to_raw(im):
 return subprocess.check_output([str(F),'-nostdin','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-i','-','-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p','-'],input=im.tobytes())
def main():
 assert Path.cwd()==R and sha(A)==ALPHA_SHA
 final=O/'project-film-replay-v12.mp4';silent=O/'project-film-replay-silent-v12.mp4';assert not final.exists() and not silent.exists()
 mapping=[{'source_frames':[0,390],'film_frames':[675,1050],'label':'Original native task submission and full dashboard'},
 {'source_frames':[390,5536],'film_frames':[1050,4800],'label':'Autonomous search, continuous recorded progression in full view and technical insets'},
 {'source_frames':[5536,8198],'film_frames':[4800,6465],'label':'Authorized opening, entry, approach, verification and stop'}]
 filters=[]
 for i,c in enumerate(mapping):
  n=c['film_frames'][1]-c['film_frames'][0];a,b=c['source_frames'];speed=(b-a)/n;c['editorial_speed_vs_existing_replay']=speed
  filters.append(f'[0:v]trim=start_frame={a}:end_frame={b},setpts=(PTS-STARTPTS)/{speed:.14f},tpad=stop_mode=clone:stop_duration=0.1,fps=30,trim=end_frame={n},setpts=PTS-STARTPTS[v{i}]')
 filters.append('[v0][v1][v2]concat=n=3:v=1:a=0,scale=1438:810:flags=lanczos,pad=1438:976:0:82:color=0xF5F6F7[out]')
 (O/'replay-retiming.filter.txt').write_text(';\n'.join(filters))
 base=subprocess.Popen([str(F),'-nostdin','-v','error','-threads','3','-i',str(A),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'alpha-decode.log').open('wb'))
 replay=subprocess.Popen([str(F),'-nostdin','-v','error','-threads','3','-reinit_filter','0','-i',str(S),'-filter_complex',';'.join(filters),'-map','[out]','-an','-f','rawvideo','-pix_fmt','yuv420p','-'],stdout=subprocess.PIPE,stderr=(O/'replay-decode.log').open('wb'))
 encode=subprocess.Popen([str(F),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','yuv420p','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','medium','-threads','6','-qp','0','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=(O/'encode.log').open('wb'))
 spec=importlib.util.spec_from_file_location('accepted_diagram11',R/'scripts/demo-video/reference-flow-v11.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
 report={'kind':'RECORDED_ACTIONS_ONLY_REPLACEMENT_DERIVATIVE','base_file':str(A.relative_to(R)),'base_sha256':ALPHA_SHA,'merged_actions':str(S.relative_to(R)),'merged_sha256':sha(S),'duration_seconds':N/FPS,'frames':N,'dimensions':[W,H],'mapping':mapping,'technical_animation_times_unchanged':[[0,22.5],[51,76],[76,102],[102,130],[130,160]],'allowed_changes':{'recorded_full_view':[[22.5,51],[160,215.5]],'technical_recorded_inset':{'time':[51,160],'rectangle':PIP},'first_inset_transition':[51,51+10/30],'opening_transition':[22.5,23]},'accepted_caption_band_preserved_yuv':[976,H],'video_encoding':'H264 lossless YUV420 encoding preserves decoded base pixels exactly outside replacement regions','audio_encoding':'Entire Alpha AAC stream copied without encoding','new_robot_actions':False,'new_model_calls':False,'original_two_recordings_unchanged':True,'opening_dissolve_duration_preserved_seconds':0.5,'filter_reinitialization_disabled_for_joined_color_metadata':True,'frozen_alpha_unchanged':True,'note':'Phase one is autonomous after a single native-chat task. Phase two follows a separately user-authorized prompt. Original narration and subtitle wording, including its existing room-order explanation, is retained at the user request.'}
 start=time.monotonic();previous=None;last_full=None;counts={'unchanged_intro_frames':0,'technical_frames_outside_inset_preserved':0,'caption_band_frames':0};protected=hashlib.sha256()
 try:
  for frame in range(N):
   raw=exact(base.stdout,SIZE);assert len(raw)==SIZE,(frame,len(raw));src=planes(raw);dst=[a.copy()for a in src]
   if frame>=675:
    rp=exact(replay.stdout,REPLAY_SIZE);assert len(rp)==REPLAY_SIZE,(frame,len(rp));r=planes(rp,W,RH)
    if frame<1530 or frame>=4800:
     for d,s in zip(dst,r):d[:s.shape[0]]=s
     if 675<=frame<690:
      if frame==675:last_intro=raw_to_rgb(previous)
      clean=raw_to_rgb(packed(dst))
      dst=planes(rgb_to_raw(Image.blend(last_intro,clean,M.B.ease((frame-675)/14))),copy=True)
    elif 1530<=frame<1540:
     # The original 10-frame reveal blends recorded footage behind the exact accepted diagram.
     # Rebuild that same reveal using the new last full view, preventing any old recording flash.
     last_full=raw_to_rgb(previous)
     t=frame/30;graphic=Image.new('RGB',(W,H),'#F5F6F7');graphic.paste(M.animated(0,t-51,25).resize((1320,990),Image.Resampling.LANCZOS),(59,0))
     ImageDraw.Draw(graphic).rounded_rectangle((1038,21,1374,199),12,outline='#D9DFE4',width=1)
     clean=planes(rgb_to_raw(graphic),copy=True);inset(clean,r);graphic=raw_to_rgb(packed(clean))
     dst=planes(rgb_to_raw(Image.blend(last_full,graphic,M.B.ease((frame-1530)/9))),copy=True)
    else:
     inset(dst,r);counts['technical_frames_outside_inset_preserved']+=1
   else:counts['unchanged_intro_frames']+=1
   caption_restore(dst,src);counts['caption_band_frames']+=1
   result=packed(dst);previous=result;encode.stdin.write(result)
   for i,(d,s)in enumerate(zip(dst,src)):
    div=1 if i==0 else 2;assert np.array_equal(d[976//div:],s[976//div:])
   if frame<675:assert result==raw
   if 1540<=frame<4800:
    for i,(d,s)in enumerate(zip(dst,src)):
     div=1 if i==0 else 2;x0,y0,x1,y1=[v//div for v in PIP]
     assert np.array_equal(d[:y0],s[:y0]) and np.array_equal(d[y1:],s[y1:])
     assert np.array_equal(d[y0:y1,:x0],s[y0:y1,:x0]) and np.array_equal(d[y0:y1,x1:],s[y0:y1,x1:])
   if frame%450==0:print(json.dumps({'frame':frame,'seconds':frame/30,'elapsed':round(time.monotonic()-start,1)}),flush=True)
  assert base.stdout.read(1)==b'' and replay.stdout.read(1)==b''
  encode.stdin.close();assert encode.wait()==0 and base.wait()==0 and replay.wait()==0
 finally:
  for p in [base,replay,encode]:
   if p.poll()is None:p.terminate()
 r=subprocess.run([str(F),'-nostdin','-v','warning','-n','-i',str(silent),'-i',str(A),'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',str(final)],capture_output=True);(O/'mux.log').write_bytes(r.stderr);assert r.returncode==0,r.stderr.decode()
 srt=O/'project-film-replay-v12.zh-CN.srt';shutil.copyfile(A.with_name('alpha.zh-CN.srt'),srt)
 report.update({'output_file':str(final.relative_to(R)),'sha256':sha(final),'bytes':final.stat().st_size,'preservation_frame_counts':counts,'subtitle_sha256':sha(srt),'subtitles_identical':sha(srt)==sha(A.with_name('alpha.zh-CN.srt')),'alpha_sha256_after':sha(A)})
 assert report['alpha_sha256_after']==ALPHA_SHA
 (O/'project-film-replay-v12.edit-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'render_complete':True,'output':str(final),'bytes':final.stat().st_size}),flush=True)
if __name__=='__main__':main()
