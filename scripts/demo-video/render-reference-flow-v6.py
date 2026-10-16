#!/usr/bin/env python3
"""Server-only edited film using locked labels, actual recorded frames and approved voice09."""
from pathlib import Path
import importlib.util,json,subprocess,time,hashlib,argparse,shutil
from PIL import Image
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-reference-flow-v6'
sp=importlib.util.spec_from_file_location('flow_v6',ROOT/'scripts/demo-video/reference-flow-v6.py');M=importlib.util.module_from_spec(sp);sp.loader.exec_module(M)
W,H,FPS=M.B.W,M.B.H,30;FF=M.B.FF
SOURCE=OUT/'input-active/project-film.mp4';TIMELINE=ROOT/'artifacts/demo-project-film-20261014/revision-voice09-title-v4/voice/narration-cues-voice09.json'
SECTIONS=[(0,22.5,'original_intro'),(30,42.5,'recorded'),(48,64,'recorded'),(72,97,0),(112,138,1),(152,180,2),(192,222,3),(233,264,'recorded'),(267,291.5,'recorded')]
CAPS=M.B.captions_from_timeline(TIMELINE)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact(pipe,n):
 out=bytearray()
 while len(out)<n:
  v=pipe.read(n-len(out))
  if not v:break
  out.extend(v)
 return bytes(out)
def section_plan():
 result=[];at=0
 for a,b,kind in SECTIONS:
  n=round((b-a)*FPS);result.append({'source_start':a,'source_end':b,'output_start':at/FPS,'output_end':(at+n)/FPS,'frames':n,'kind':kind});at+=n
 return result
PLAN=section_plan();DURATION=PLAN[-1]['output_end'];N=round(DURATION*FPS)
def output_caps():
 out=[]
 for sec in PLAN:
  a,b=sec['source_start'],sec['source_end']
  for cue in CAPS:
   lo=max(a,cue['start']);hi=min(b,cue['end'])
   if hi>lo:out.append({'start':sec['output_start']+lo-a,'end':sec['output_start']+hi-a,'text':cue['text']})
 return out

def preview():
 (OUT/'previews').mkdir(exist_ok=True)
 for idx,t,du in [(0,80,25),(1,122,26),(2,164,28),(3,205,30)]:
  data=subprocess.check_output([str(FF),'-v','error','-ss',str(t),'-i',str(SOURCE),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);raw=Image.frombytes('RGB',(W,H),data)
  M.compose(idx,t-[72,112,152,192][idx],du,raw,CAPS,t).save(OUT/'previews'/f'reference-flow-{idx+1}.jpg',quality=94)
  M.SCENES[idx][0].save(OUT/'previews'/f'reference-static-{idx+1}.png')
 (OUT/'locked-reference-text.json').write_text(json.dumps({'labels':M.LABELS,'connector_arrowheads':0,'reference_inputs':[str(x.relative_to(ROOT))for x in sorted((OUT/'references').glob('*.png'))]},ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'duration':DURATION,'frames':N,'plan':PLAN}),flush=True)

def render():
 output=OUT/'project-film-reference-flow-silent-v6.mp4'
 if output.exists():raise RuntimeError('NEW_OUTPUT_REQUIRED')
 # Every accepted spoken clip is kept completely, without changing its playback rate.
 voice=json.loads(TIMELINE.read_text())['clips'];coverage=[]
 for c in voice:
  sec=next((s for s in PLAN if s['source_start']<=c['start'] and s['source_end']>=c['end']),None)
  assert sec is not None,'INCOMPLETE_VOICE:'+c['id']
  coverage.append({'id':c['id'],'source_start':c['start'],'source_end':c['end'],'output_start':sec['output_start']+c['start']-sec['source_start'],'complete':True,'playback_rate':1})
 select='+'.join(f'between(n,{round(a*FPS)},{round(b*FPS)-1})'for a,b,_ in SECTIONS)
 decoder=subprocess.Popen([str(FF),'-nostdin','-v','error','-threads','4','-i',str(SOURCE),'-vf',f"select='{select}',setpts=N/(30*TB)",'-an','-sn','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'selected-decode.log').open('wb'))
 encoder=subprocess.Popen([str(FF),'-nostdin','-hide_banner','-loglevel','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-threads','6','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],stdin=subprocess.PIPE,stderr=(OUT/'encode-v6.log').open('wb'))
 count=0;began=time.monotonic();hashref=hashlib.sha256();hashnew=hashlib.sha256();kept=0;previous=None;frame_by_section=[]
 try:
  for sec in PLAN:
   kind=sec['kind'];start=count
   for j in range(sec['frames']):
    data=exact(decoder.stdout,W*H*3);assert len(data)==W*H*3
    raw=Image.frombytes('RGB',(W,H),data);source_time=sec['source_start']+j/FPS
    if isinstance(kind,int):
     im=M.compose(kind,j/FPS,(sec['frames']/FPS),raw,CAPS,source_time)
     if j<10 and previous is not None:im=Image.blend(previous,im,M.B.ease(j/9))
    else:
     im=raw
     # Real recorded UI and original introduction remain exact selected source pixels.
     hashref.update(count.to_bytes(4,'big')+data);hashnew.update(count.to_bytes(4,'big')+im.tobytes());kept+=1
    encoder.stdin.write(im.tobytes());previous=im;count+=1
    if count%450==0:print(json.dumps({'frame':count,'seconds':count/FPS,'elapsed':round(time.monotonic()-began,1)}),flush=True)
   frame_by_section.append({**sec,'output_start_frame':start,'output_end_frame':count})
  assert count==N and decoder.stdout.read(1)==b''
  encoder.stdin.close();assert encoder.wait()==0 and decoder.wait()==0
 except BaseException:
  for proc in [encoder,decoder]:
   if proc.poll() is None:proc.terminate()
  raise
 caps=output_caps();(OUT/'project-film-reference-flow-v6.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{M.B.srt_time(c["start"])} --> {M.B.srt_time(c["end"])}\n{c["text"]}'for i,c in enumerate(caps))+'\n')
 manifest={'version':6,'title':'具身救援 · 从指令到行动','kind':'REFERENCE_BASED_FLOW_ANIMATION_AND_PAUSE_TRIM','duration_seconds':DURATION,'frames':N,'fps':FPS,'source':{'path':str(SOURCE.relative_to(ROOT)),'sha256':sha(SOURCE)},'sections':frame_by_section,'voice09_complete_clips':coverage,'audio_time_stretch':False,'idle_time_removed_seconds':300-DURATION,'reference_text':M.LABELS,'reference_inputs':[{'path':str(p.relative_to(ROOT)),'sha256':sha(p)}for p in sorted((OUT/'references').glob('*.png'))],'rendering':'Code-native vector/text reconstruction from user references. Orange endpoint dots and smoothly eased travelling dots, no connector arrowheads. Actual chronological recording inset remains visible in header without covering diagram labels.','source_ui_exact_before_encoding':{'frames':kept,'reference_hash':hashref.hexdigest(),'input_hash':hashnew.hexdigest(),'match':hashref.digest()==hashnew.digest()},'new_robot_actions':False,'new_model_calls':False,'original_manifest':str((OUT/'input-active/project-film.edit-manifest.json').relative_to(ROOT))}
 (OUT/'render-manifest-v6.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'silent':str(output),'frames':count,'duration':DURATION,'recorded_inputs_exact':manifest['source_ui_exact_before_encoding']['match']}),flush=True)

def audio():
 silent=OUT/'project-film-reference-flow-silent-v6.mp4';target=OUT/'project-film-reference-flow-v6.mp4'
 if target.exists():raise RuntimeError('NEW_OUTPUT_REQUIRED')
 parts=[]
 for i,(a,b,_)in enumerate(SECTIONS):parts.append(f'[1:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}]')
 graph=';'.join(parts)+';'+''.join(f'[a{i}]'for i in range(len(SECTIONS)))+f'concat=n={len(SECTIONS)}:v=0:a=1[a]'
 cmd=[str(FF),'-nostdin','-hide_banner','-loglevel','warning','-n','-i',str(silent),'-i',str(SOURCE),'-filter_complex',graph,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-metadata:s:a:0','language=zho','-movflags','+faststart',str(target)]
 result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE);(OUT/'mux-v6.log').write_bytes(result.stderr);assert result.returncode==0,result.stderr.decode()[-2000:]
 print(json.dumps({'final':str(target),'sha256':sha(target)}),flush=True)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');ap.add_argument('--audio-only',action='store_true');args=ap.parse_args()
 if Path.cwd()!=ROOT:raise RuntimeError('WORKSPACE_REQUIRED')
 if args.audio_only:audio()
 elif args.preview:preview()
 else:preview();render();audio()
