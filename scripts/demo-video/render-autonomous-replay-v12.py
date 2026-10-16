"""Render actual chronological capture with a measured crop and a short genuine camera zoom."""
from pathlib import Path
import json,subprocess,math,time,hashlib,argparse
from PIL import Image
R=Path('/data-ssd/zhongchengkai/agnes');FF=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
def exact(stream,n):
 b=bytearray()
 while len(b)<n:
  v=stream.read(n-len(b))
  if not v:break
  b.extend(v)
 return bytes(b)
def main():
 assert Path.cwd()==R
 a=argparse.ArgumentParser();a.add_argument('--plan',required=True);args=a.parse_args();plan=json.loads(Path(args.plan).read_text());source=Path(plan['source']);output=Path(plan['output']);assert source.is_relative_to(R) and output.is_relative_to(R) and source.is_file() and not output.exists();assert plan['verified_actual_capture']
 sw,sh=plan['source_size'];geo=plan['geometry'];vw,vh=geo['viewport']['width'],geo['viewport']['height'];cuts=plan['cuts'];fps=30;segments=[];filt=[];last=0;offset=0
 for i,c in enumerate(cuts):
  assert c['start']>=last and c['end']>c['start'] and 1<=c['speed']<=4;last=c['end'];n=round((c['end']-c['start'])/c['speed']*fps);assert n>0;segments.append({**c,'output_start_frame':offset,'frames':n});offset+=n
  filt.append(f"[0:v]trim=start={c['start']}:end={c['end']},setpts=(PTS-STARTPTS)/{c['speed']},tpad=stop_mode=clone:stop_duration=0.08,fps={fps},trim=end_frame={n},setpts=PTS-STARTPTS[v{i}]")
 filt.append(''.join(f'[v{i}]'for i in range(len(cuts)))+f'concat=n={len(cuts)}:v=1:a=0[out]');script=output.with_suffix('.decode.filter.txt');output.parent.mkdir(parents=True,exist_ok=True);script.write_text(';\n'.join(filt))
 decoder=subprocess.Popen([str(FF),'-nostdin','-v','warning','-threads','3','-i',str(source),'-filter_complex',';'.join(filt),'-map','[out]','-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=output.with_suffix('.decode.log').open('wb'))
 encoder=subprocess.Popen([str(FF),'-nostdin','-v','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-threads','6','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],stdin=subprocess.PIPE,stderr=output.with_suffix('.encode.log').open('wb'))
 def box(mode):
  b=geo[mode];return (max(0,b['left']-6)*sw/vw,max(0,b['top']-6)*sh/vh,min(vw,b['right']+6)*sw/vw,min(vh,b['bottom']+6)*sh/vh)
 j=0;began=time.monotonic();previous_mode=None
 try:
  for frame in range(offset):
   while frame>=segments[j]['output_start_frame']+segments[j]['frames']:j+=1
   c=segments[j];raw=exact(decoder.stdout,sw*sh*3);assert len(raw)==sw*sh*3,(frame,len(raw));im=Image.frombytes('RGB',(sw,sh),raw);b=box(c['mode']);local=(frame-c['output_start_frame'])/fps
   if c.get('zoom_from') and local<c.get('zoom_seconds',1.2):
    v=min(1,local/c.get('zoom_seconds',1.2));v=v*v*(3-2*v);old=box(c['zoom_from']);b=tuple(x+(y-x)*v for x,y in zip(old,b))
   crop=im.crop(tuple(round(v)for v in b));scale=min(1920/crop.width,1080/crop.height);size=(round(crop.width*scale),round(crop.height*scale));canvas=Image.new('RGB',(1920,1080),'#F5F6F7');canvas.paste(crop.resize(size,Image.Resampling.LANCZOS),((1920-size[0])//2,(1080-size[1])//2));encoder.stdin.write(canvas.tobytes())
   if frame in plan.get('preview_frames',[]):canvas.save(output.parent/f'replay-frame-{frame}.jpg',quality=94)
   if frame%600==0:print(json.dumps({'frame':frame,'seconds':frame/fps,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  encoder.stdin.close();assert encoder.wait()==0;decoder.stdout.close();assert decoder.wait()==0
 finally:
  for v in [decoder,encoder]:
   if v.poll()is None:v.terminate()
 report={**plan,'frames':offset,'duration_seconds':offset/fps,'segments':segments,'output_size':[1920,1080],'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'method':'Real chronological screen recording; idle cuts and modest motion speed changes; measured uniform crop, genuine frame zoom; no new robot actions, route prompts, frozen movement or synthetic targets.'};output.with_suffix('.edit-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'output':str(output),'duration_seconds':offset/fps}),flush=True)
if __name__=='__main__':main()
