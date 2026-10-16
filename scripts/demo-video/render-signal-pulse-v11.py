"""Visual-only signal styling revision; opening, layout, dialogue and accepted audio retained."""
from pathlib import Path
import importlib.util,json,subprocess,hashlib,time,shutil
from PIL import Image,ImageDraw
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-signal-pulse-v11';SOURCE=OUT/'input-active/project-film.mp4';W,H,FPS,N=1438,1080,30,6465
spec=importlib.util.spec_from_file_location('diagram11',ROOT/'scripts/demo-video/reference-flow-v11.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
CAPS=json.loads((ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/caption-schedule-v9.json').read_text())['cues'];FF=M.B.FF
PIP=(1040,23,1372,197);SEGMENTS=[(51,76),(76,102),(102,130),(130,160)]
def exact(pipe,n):
 buf=bytearray()
 while len(buf)<n:
  chunk=pipe.read(n-len(buf))
  if not chunk:break
  buf.extend(chunk)
 return bytes(buf)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def graphic(idx,t,raw):
 a,b=SEGMENTS[idx];im=Image.new('RGB',(W,H),M.BG)
 im.paste(M.animated(idx,t-a,b-a).resize((1320,990),Image.Resampling.LANCZOS),(59,0))
 ImageDraw.Draw(im).rounded_rectangle((1038,21,1374,199),12,outline='#D9DFE4',width=1);im.paste(raw.crop(PIP),PIP[:2])
 return M.B.subtitle(im,CAPS,t)
def main():
 assert Path.cwd()==ROOT
 silent=OUT/'project-film-signal-pulse-silent-v11.mp4';final=OUT/'project-film-signal-pulse-v11.mp4';assert not silent.exists()and not final.exists()
 decoder=subprocess.Popen([str(FF),'-nostdin','-v','error','-threads','3','-i',str(SOURCE),'-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'source-decode.log').open('wb'))
 encoder=subprocess.Popen([str(FF),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-threads','6','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=(OUT/'encode.log').open('wb'))
 reference=hashlib.sha256();unchanged=hashlib.sha256();count=0;previous=None;began=time.monotonic();pip_frames=0;pip_ref=hashlib.sha256();pip_out=hashlib.sha256()
 try:
  for frame in range(N):
   t=frame/FPS;data=exact(decoder.stdout,W*H*3);assert len(data)==W*H*3;raw=Image.frombytes('RGB',(W,H),data);im=raw;changed=False
   if 1530<=frame<4800:
    idx=next(i for i,(a,b)in enumerate(SEGMENTS)if a<=t<b);im=graphic(idx,t,raw);local=frame-round(SEGMENTS[idx][0]*FPS)
    if local<10 and previous is not None:im=Image.blend(previous,im,M.B.ease(local/9))
    changed=True
    if local>=10:
     a=raw.crop(PIP).tobytes();b=im.crop(PIP).tobytes();assert a==b;pip_ref.update(a);pip_out.update(b);pip_frames+=1
   result=im.tobytes()
   if not changed:
    assert result==data;reference.update(frame.to_bytes(4,'big')+data);unchanged.update(frame.to_bytes(4,'big')+result);count+=1
   if frame in [674,682,690,1809,2505,3246,4014,4320]:im.save(OUT/'previews'/f'input-v11-{frame}.jpg',quality=95)
   encoder.stdin.write(result);previous=im
   if frame%450==0:print(json.dumps({'frame':frame,'seconds':t,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  assert decoder.stdout.read(1)==b''
  encoder.stdin.close();assert encoder.wait()==0 and decoder.wait()==0
 finally:
  for process in [decoder,encoder]:
   if process.poll()is None:process.terminate()
 result=subprocess.run([str(FF),'-nostdin','-v','warning','-n','-i',str(silent),'-i',str(SOURCE),'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',str(final)],stdout=subprocess.PIPE,stderr=subprocess.PIPE);(OUT/'mux.log').write_bytes(result.stderr);assert result.returncode==0,result.stderr.decode()[-2000:]
 shutil.copy2(OUT/'input-active/project-film.zh-CN.srt',OUT/'project-film-signal-pulse-v11.zh-CN.srt')
 report={'source_sha256':sha(SOURCE),'candidate_sha256':sha(final),'frames':N,'duration_seconds':215.5,'unchanged_fullframe_inputs':{'frames':count,'reference_sha256':reference.hexdigest(),'output_sha256':unchanged.hexdigest(),'exact':reference.digest()==unchanged.digest()},'steady_actual_inset_inputs':{'frames':pip_frames,'reference_sha256':pip_ref.hexdigest(),'output_sha256':pip_out.hexdigest(),'exact':pip_ref.digest()==pip_out.digest()},'audio_method':'Entire accepted voice09 and background AAC stream packet copy','subtitles_identical':sha(OUT/'input-active/project-film.zh-CN.srt')==sha(OUT/'project-film-signal-pulse-v11.zh-CN.srt'),'new_robot_actions':False,'new_core_model_calls':False}
 (OUT/'render-report-v11.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'final':str(final),'preserved_full_frames':count,'inset_frames':pip_frames}),flush=True)
if __name__=='__main__':main()
