"""Requested label, architecture footer/shadow, narration and subtitle revision."""
from pathlib import Path
import importlib.util,json,subprocess,hashlib,time
from PIL import Image,ImageDraw
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9';SOURCE=OUT/'input-active/project-film.mp4';W,H,FPS,N=1438,1080,30,6465
spec=importlib.util.spec_from_file_location('diagram9',ROOT/'scripts/demo-video/reference-flow-v9.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
spec=importlib.util.spec_from_file_location('opening7',ROOT/'scripts/demo-video/render-opening-walls-v7.py');O=importlib.util.module_from_spec(spec);spec.loader.exec_module(O)
old_text=O.B.text
def opening_text(d,xy,s,size=24,fill=O.B.WHITE):
 if s=='从门洞中心进入':s='从门口进入'
 return old_text(d,xy,s,size,fill)
O.B.text=opening_text
CAPS=json.loads((OUT/'caption-schedule-v9.json').read_text())['cues'];FF=M.B.FF
LABEL_ROI=(1095,832,1340,891);CAPTION_ROI=(0,976,W,1054);PIP=(1040,23,1372,197)
def exact(pipe,n):
 buf=bytearray()
 while len(buf)<n:
  chunk=pipe.read(n-len(buf))
  if not chunk:break
  buf.extend(chunk)
 return bytes(buf)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def graphic(idx,t,raw,captions=True):
 a,b=(51,76)if idx==0 else(76,102);im=Image.new('RGB',(W,H),M.BG)
 im.paste(M.animated(idx,t-a,b-a).resize((1320,990),Image.Resampling.LANCZOS),(59,0))
 ImageDraw.Draw(im).rounded_rectangle((1038,21,1374,199),12,outline='#D9DFE4',width=1);im.paste(raw.crop(PIP),PIP[:2])
 return M.B.subtitle(im,CAPS,t)if captions else im

def main():
 assert Path.cwd()==ROOT
 silent=OUT/'project-film-AGH-silent-v9.mp4';final=OUT/'project-film-AGH-v9.mp4';assert not silent.exists()and not final.exists()
 decoder=subprocess.Popen([str(FF),'-nostdin','-v','error','-threads','3','-i',str(SOURCE),'-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'source-video-decode-v9.log').open('wb'))
 footage=subprocess.Popen([str(FF),'-nostdin','-v','error','-threads','2','-i',str(ROOT/'artifacts/demo-project-film-20261014/film-footage.mp4'),'-an','-frames:v','375','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'caption-clean-footage-v9.log').open('wb'))
 encoder=subprocess.Popen([str(FF),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-threads','6','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=(OUT/'encode-v9.log').open('wb'))
 preserved=hashlib.sha256();preserved_out=hashlib.sha256();count=0;native_ref=hashlib.sha256();native_out=hashlib.sha256();native_count=0;previous=None;began=time.monotonic();pip_frames=0;pip_ref=hashlib.sha256();pip_out=hashlib.sha256()
 try:
  for frame in range(N):
   t=frame/FPS;data=exact(decoder.stdout,W*H*3);assert len(data)==W*H*3;raw=Image.frombytes('RGB',(W,H),data);im=raw.copy();changed=False
   clean_footage=None
   if 675<=frame<1050:
    f=exact(footage.stdout,W*H*3);assert len(f)==W*H*3;clean_footage=Image.frombytes('RGB',(W,H),f)
   if 585<=frame<675:
    fresh=O.intro(t);im.paste(fresh.crop(LABEL_ROI),LABEL_ROI[:2]);changed=True
   elif 690<=frame<1050:
    im.paste(clean_footage.crop(CAPTION_ROI),CAPTION_ROI[:2]);im=M.B.full_subtitle(im,CAPS,t);changed=True
    a=raw.crop((0,0,W,976)).tobytes()+raw.crop((0,1054,W,H)).tobytes();b=im.crop((0,0,W,976)).tobytes()+im.crop((0,1054,W,H)).tobytes();assert a==b;native_ref.update(a);native_out.update(b);native_count+=1
   elif 1530<=frame<2280:
    im=graphic(0,t,raw);local=frame-1530
    if local<10 and previous is not None:im=Image.blend(previous,im,M.B.ease(local/9))
    changed=True
    if local>=10:
     a=raw.crop(PIP).tobytes();b=im.crop(PIP).tobytes();assert a==b;pip_ref.update(a);pip_out.update(b);pip_frames+=1
   elif 2280<=frame<3060:
    local=frame-2280
    if local<10:
     im=graphic(1,t,raw)
     if previous is not None:im=Image.blend(previous,im,M.B.ease(local/9))
    else:
     clean=graphic(1,t,raw,captions=False);im.paste(clean.crop(CAPTION_ROI),CAPTION_ROI[:2]);im=M.B.subtitle(im,CAPS,t)
    changed=True
    if local>=10:
     a=raw.crop(PIP).tobytes();b=im.crop(PIP).tobytes();assert a==b;pip_ref.update(a);pip_out.update(b);pip_frames+=1
   result=im.tobytes()
   if not changed:
    assert result==data;preserved.update(frame.to_bytes(4,'big')+data);preserved_out.update(frame.to_bytes(4,'big')+result);count+=1
   encoder.stdin.write(result);previous=im
   if frame%450==0:print(json.dumps({'frame':frame,'seconds':t,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  assert decoder.stdout.read(1)==b'' and footage.stdout.read(1)==b''
  encoder.stdin.close();assert encoder.wait()==0 and decoder.wait()==0 and footage.wait()==0
 finally:
  for process in [decoder,footage,encoder]:
   if process.poll()is None:process.terminate()
 # The master keeps all other existing voice passages unchanged before AAC coding.
 result=subprocess.run([str(FF),'-nostdin','-v','warning','-n','-i',str(silent),'-i',str(OUT/'voice/master-AGH-v9.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-metadata:s:a:0','language=zho','-movflags','+faststart',str(final)],stdout=subprocess.PIPE,stderr=subprocess.PIPE);(OUT/'mux-v9.log').write_bytes(result.stderr);assert result.returncode==0,result.stderr.decode()[-2000:]
 report={'source_sha256':sha(SOURCE),'candidate_sha256':sha(final),'frames':N,'duration_seconds':215.5,'unchanged_fullframe_inputs':{'frames':count,'reference_sha256':preserved.hexdigest(),'output_sha256':preserved_out.hexdigest(),'exact':preserved.digest()==preserved_out.digest()},'native_chat_camera_map_outside_subtitle_band':{'frames':native_count,'reference_sha256':native_ref.hexdigest(),'output_sha256':native_out.hexdigest(),'exact':native_ref.digest()==native_out.digest()},'steady_actual_inset_inputs':{'frames':pip_frames,'reference_sha256':pip_ref.hexdigest(),'output_sha256':pip_out.hexdigest(),'exact':pip_ref.digest()==pip_out.digest()},'opening_label':'从门口进入','opening_changed_roi':LABEL_ROI,'changed_voice_ids':['native_task','task_loop','vision'],'new_robot_actions':False,'new_core_model_calls':False}
 (OUT/'render-report-v9.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'final':str(final),'preserved_full_frames':count,'native_UI_retained':True}),flush=True)
if __name__=='__main__':main()
