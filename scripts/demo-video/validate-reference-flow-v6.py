#!/usr/bin/env python3
"""Independent rendered-media checks for the reference-flow revision."""
from pathlib import Path
import json,subprocess,hashlib,math,importlib.util,collections,re,time
import numpy as np
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-reference-flow-v6';BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin'
W,H,FPS=1438,1080,30
sp=importlib.util.spec_from_file_location('edit',ROOT/'scripts/demo-video/render-reference-flow-v6.py');M=importlib.util.module_from_spec(sp);sp.loader.exec_module(M)
SOURCE=OUT/'input-active/project-film.mp4';FINAL=OUT/'project-film-reference-flow-v6.mp4'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def command(args):
 r=subprocess.run([str(BIN/'ffmpeg'),'-nostdin','-v','error',*map(str,args)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if r.returncode:raise RuntimeError(r.stderr.decode()[-3000:])
 return r.stdout
def probe():return json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error','-show_format','-show_streams','-of','json',str(FINAL)]))
def psnr(sse,n):return float('inf')if not sse else 10*math.log10(255**2/(sse/n))
def preserved_frames():
 select='+'.join(f'between(n,{round(a*FPS)},{round(b*FPS)-1})'for a,b,_ in M.SECTIONS)
 a=subprocess.Popen([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','3','-i',str(SOURCE),'-vf',f"select='{select}',setpts=N/(30*TB)",'-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'qa-source-decode.log').open('wb'))
 b=subprocess.Popen([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','3','-i',str(FINAL),'-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'qa-final-decode.log').open('wb'))
 frames=0;sse=0;samples=0;worst=100;began=time.monotonic()
 try:
  for sec in M.PLAN:
   for j in range(sec['frames']):
    x=M.exact(a.stdout,W*H*3);y=M.exact(b.stdout,W*H*3);assert len(x)==len(y)==W*H*3
    if not isinstance(sec['kind'],int):
     dx=np.frombuffer(x,np.uint8).astype(np.float32)-np.frombuffer(y,np.uint8)
     val=float(np.sum(dx*dx,dtype=np.float64));sse+=val;samples+=dx.size;worst=min(worst,psnr(val,dx.size));frames+=1
  assert a.stdout.read(1)==b'' and b.stdout.read(1)==b''
  assert a.wait()==0 and b.wait()==0
 finally:
  for proc in [a,b]:
   if proc.poll() is None:proc.terminate()
 return {'frames':frames,'mean_psnr_db':psnr(sse,samples),'minimum_frame_psnr_db':worst,'passed':psnr(sse,samples)>=35 and worst>=30,'elapsed':round(time.monotonic()-began,1)}
def audio():
 parts=[f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}]'for i,(a,b,_)in enumerate(M.SECTIONS)]
 graph=';'.join(parts)+';'+''.join(f'[a{i}]'for i in range(len(parts)))+f'concat=n={len(parts)}:v=0:a=1[a]'
 x=command(['-i',SOURCE,'-filter_complex',graph,'-map','[a]','-f','f32le','-acodec','pcm_f32le','-'])
 y=command(['-i',FINAL,'-map','0:a:0','-f','f32le','-acodec','pcm_f32le','-'])
 a=np.frombuffer(x,np.float32);b=np.frombuffer(y,np.float32);n=min(len(a),len(b));a=a[:n].astype(np.float64);b=b[:n].astype(np.float64)
 error=float(np.sqrt(np.mean((a-b)**2)));rms=float(np.sqrt(np.mean(a*a)));cor=float(np.dot(a,b)/(math.sqrt(np.dot(a,a)*np.dot(b,b))))
 return {'expected_interleaved_samples':len(x)//4,'actual_interleaved_samples':len(y)//4,'difference_samples':abs(len(x)-len(y))//4,'rms_error':error,'rms_reference':rms,'correlation':cor,'passed':cor>=.995 and error/max(rms,1e-9)<.08 and abs(len(x)-len(y))//4<=2048}
def frame(t):
 data=command(['-ss',t,'-i',FINAL,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);return np.frombuffer(data,np.uint8).reshape(H,W,3)
def motion():
 out=[]
 for i,(start,end)in enumerate([(51,76),(76,102),(102,130),(130,160)]):
  a=frame(start+2)[240:950];b=frame(start+4)[240:950];n=int(np.count_nonzero(np.max(np.abs(a.astype(np.int16)-b.astype(np.int16)),axis=2)>15));out.append({'chapter':i+1,'changed_diagram_pixels':n,'passed':n>150})
 return out
def main():
 if Path.cwd()!=ROOT:raise RuntimeError('WORKSPACE_REQUIRED')
 report=OUT/'final-qa-v6.json'
 if report.exists():raise RuntimeError('NEW_REPORT_REQUIRED')
 d=probe();video=next(s for s in d['streams']if s['codec_type']=='video');sound=next(s for s in d['streams']if s['codec_type']=='audio')
 spec=video['codec_name']=='h264' and video['width']==W and video['height']==H and video['avg_frame_rate']=='30/1' and int(video['nb_frames'])==M.N and abs(float(d['format']['duration'])-M.DURATION)<.08 and sound.get('tags',{}).get('language')=='zho'
 expected=json.loads((OUT/'reference-text-transcription.json').read_text())['labels'];actual=json.loads((OUT/'locked-reference-text.json').read_text())['labels'];text_exact=all(collections.Counter(a)==collectionss_counter(b) for a,b in zip(expected,actual))
 render=json.loads((OUT/'render-manifest-v6.json').read_text());voice_exact=len(render['voice09_complete_clips'])==9 and all(c['complete'] and c['playback_rate']==1 for c in render['voice09_complete_clips'])
 srt=(OUT/'project-film-reference-flow-v6.zh-CN.srt').read_text();captions='\n\n'.join(f'{i+1}\n{M.M.B.srt_time(c["start"])} --> {M.M.B.srt_time(c["end"])}\n{c["text"]}'for i,c in enumerate(M.output_caps()))+'\n'
 caption_exact=srt==captions and '1.5' not in srt and '×' not in srt
 pixels=preserved_frames();music=audio();movement=motion()
 passed=spec and text_exact and voice_exact and caption_exact and pixels['passed'] and music['passed'] and all(x['passed']for x in movement)
 result={'passed':passed,'duration_seconds':float(d['format']['duration']),'video_frames':video['nb_frames'],'audio_language':sound.get('tags',{}).get('language'),'all_reference_text_verbatim':text_exact,'all9_approved_voice09_clips_complete_and_unstretched':voice_exact,'captions_remapped_exactly':caption_exact,'recorded_picture_comparison':pixels,'actual_audio_against_original_cut_pcm':music,'actual_diagram_motion':movement,'source_sha256':sha(SOURCE),'candidate_sha256':sha(FINAL),'references_sha256':[sha(p)for p in sorted((OUT/'references').glob('*.png'))],'scope':'Actual finished video decoded and compared. No robot or model test performed for this editorial revision.'}
 report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False),flush=True)
 if not passed:raise SystemExit(1)
def collectionss_counter(v):return collections.Counter(v)
if __name__=='__main__':main()
