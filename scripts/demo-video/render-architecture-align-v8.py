"""Two authorised diagram layout changes only; smart-splice existing approved film."""
from pathlib import Path
import importlib.util,json,hashlib,subprocess,shutil,time,argparse
from PIL import Image,ImageDraw
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-architecture-align-v8';SOURCE=OUT/'input-active/project-film.mp4'
sp=importlib.util.spec_from_file_location('diagrams8',ROOT/'scripts/demo-video/reference-flow-v8.py');M=importlib.util.module_from_spec(sp);sp.loader.exec_module(M)
sp=importlib.util.spec_from_file_location('timing6',ROOT/'scripts/demo-video/render-reference-flow-v6.py');T=importlib.util.module_from_spec(sp);sp.loader.exec_module(T)
CAPS=T.output_caps();W,H,FPS=1438,1080,30;FF=M.B.FF
CHAPTERS=[(51,76),(76,102),(102,130),(130,160)]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact(pipe,n):
 data=bytearray()
 while len(data)<n:
  part=pipe.read(n-len(data))
  if not part:break
  data.extend(part)
 return bytes(data)
def compose(idx,t,raw):
 a,b=CHAPTERS[idx];im=Image.new('RGB',(W,H),M.BG)
 im.paste(M.animated(idx,t-a,b-a).resize((1320,990),Image.Resampling.LANCZOS),(59,0))
 d=ImageDraw.Draw(im);d.rounded_rectangle((1038,21,1374,199),12,outline='#D9DFE4',width=1)
 # The current approved actual inset is already resized. Preserve these pixels.
 im.paste(raw.crop((1040,23,1372,197)),(1040,23))
 return M.B.subtitle(im,CAPS,t)
def extract(t):
 data=subprocess.check_output([str(FF),'-nostdin','-v','error','-ss',str(t),'-i',str(SOURCE),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);return Image.frombytes('RGB',(W,H),data)
def preview():
 (OUT/'previews').mkdir(exist_ok=True)
 for i,t in enumerate([60,86,114,144]):compose(i,t,extract(t)).save(OUT/'previews'/f'align-v8-chapter-{i+1}.jpg',quality=95)
 info={'cards':M.ALIGNMENT_CARDS,'icons':M.ALIGNMENT_ICONS,'labels':M.LABELS,'page_labels_removed':['01 / 04','02 / 04','03 / 04','04 / 04']}
 (OUT/'alignment-and-text-v8.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'orange_and_icon_centres_equal':[c['accent_center_x']for c in M.ALIGNMENT_CARDS]==[i['center'][0]for i in M.ALIGNMENT_ICONS],'labels':[len(x)for x in M.LABELS]}),flush=True)
def command(args,log):
 run=subprocess.run([str(x)for x in args],stdout=subprocess.PIPE,stderr=subprocess.PIPE);(OUT/log).write_bytes(run.stderr)
 if run.returncode:raise RuntimeError(run.stderr.decode()[-2500:])
def render():
 prefix=OUT/'unchanged-prefix-v7.mp4';middle=OUT/'diagrams-align-v8.mp4';tail=OUT/'unchanged-tail-v7.mp4';result=OUT/'project-film-architecture-align-v8.mp4'
 assert not any(p.exists()for p in [prefix,middle,tail,result])
 # Independently verified closed GOP cuts: source frame 1500 and frame 4800.
 command([FF,'-nostdin','-v','warning','-n','-i',SOURCE,'-map','0:v:0','-an','-frames:v','1500','-c:v','copy',prefix],'prefix-copy-v8.log')
 decoder=subprocess.Popen([str(FF),'-nostdin','-v','error','-threads','3','-ss','50','-i',str(SOURCE),'-map','0:v:0','-an','-frames:v','3300','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'region-decode-v8.log').open('wb'))
 encoder=subprocess.Popen([str(FF),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-threads','6','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(middle)],stdin=subprocess.PIPE,stderr=(OUT/'diagrams-encode-v8.log').open('wb'))
 first_hash=hashlib.sha256();first_out=hashlib.sha256();inset_ref=hashlib.sha256();inset_out=hashlib.sha256();previous=None;began=time.monotonic();inset_frames=0
 try:
  for j in range(3300):
   frame=1500+j;t=frame/FPS;data=exact(decoder.stdout,W*H*3);assert len(data)==W*H*3;raw=Image.frombytes('RGB',(W,H),data)
   if frame<1530:
    im=raw;first_hash.update(data);first_out.update(im.tobytes())
   else:
    idx=0 if frame<2280 else 1 if frame<3060 else 2 if frame<3900 else 3
    im=compose(idx,t,raw);local=frame-round(CHAPTERS[idx][0]*FPS)
    if local<10 and previous is not None:im=Image.blend(previous,im,M.B.ease(local/9))
    else:
     a=raw.crop((1040,23,1372,197)).tobytes();b=im.crop((1040,23,1372,197)).tobytes();assert a==b;inset_ref.update(a);inset_out.update(b);inset_frames+=1
   encoder.stdin.write(im.tobytes());previous=im
   if j%450==0:print(json.dumps({'frame':frame,'seconds':t,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  assert decoder.stdout.read(1)==b'';encoder.stdin.close();assert encoder.wait()==0 and decoder.wait()==0
 finally:
  for proc in [decoder,encoder]:
   if proc.poll()is None:proc.terminate()
 command([FF,'-nostdin','-v','warning','-n','-ss','160','-i',SOURCE,'-map','0:v:0','-an','-c:v','copy',tail],'tail-copy-v8.log')
 playlist=OUT/'video-concat-v8.txt';playlist.write_text(''.join(f"file '{p}'\n"for p in [prefix,middle,tail]))
 command([FF,'-nostdin','-v','warning','-n','-f','concat','-safe','0','-i',playlist,'-i',SOURCE,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',result],'final-mux-v8.log')
 shutil.copy2(OUT/'input-active/project-film.zh-CN.srt',OUT/'project-film-architecture-align-v8.zh-CN.srt')
 report={'source_sha256':sha(SOURCE),'candidate_sha256':sha(result),'changed_diagram_seconds':[51,160],'copy_ranges_seconds':[[0,50],[160,215.5]],'native_ui_bridge_frames':30,'native_ui_before_encoding_exact':first_hash.digest()==first_out.digest(),'inset_frames_before_encoding_exact':inset_frames,'inset_input_hash':inset_out.hexdigest(),'inset_reference_hash':inset_ref.hexdigest(),'all_audio_stream_copied':True,'subtitles_file_copied':True,'new_model_or_robot_actions':False}
 (OUT/'render-report-v8.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'candidate':str(result)}),flush=True)
if __name__=='__main__':
 assert Path.cwd()==ROOT
 ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');args=ap.parse_args();preview()
 if not args.preview:render()
