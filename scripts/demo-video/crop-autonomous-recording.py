"""Crop the authenticated actual autonomous capture using observed DOM boundaries.

Preserves original capture. A reviewed cut plan is required; no fake scene, loop
or frozen motion is used. Source intervals must be chronological and disjoint.
"""
from pathlib import Path
import argparse,json,math,subprocess,hashlib
ROOT=Path('/data-ssd/zhongchengkai/agnes');BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin'
def inside(p):
 p=Path(p);p=(ROOT/p).resolve()if not p.is_absolute()else p.resolve()
 if not p.is_relative_to(ROOT):raise ValueError('PROJECT_PATH_REQUIRED')
 return p
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 assert Path.cwd()==ROOT
 ap=argparse.ArgumentParser();ap.add_argument('--plan',required=True);ap.add_argument('--check',action='store_true');a=ap.parse_args();planfile=inside(a.plan);plan=json.loads(planfile.read_text());source=inside(plan['source']);out=inside(plan['output']);assert source.is_file()and not out.exists();assert plan['verified_actual_capture']is True
 info=json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(source)]));v=next(s for s in info['streams']if s['codec_type']=='video');sw,sh=v['width'],v['height'];last=0;filters=[];segments=[]
 for i,cut in enumerate(plan['cuts']):
  assert cut['mode']in ['full','dual','focus'];start,end=float(cut['start']),float(cut['end']);assert start>=last and end>start;last=end;speed=float(cut.get('speed',1));assert 1<=speed<=8
  measured=plan['bounds'][cut['mode']];vw,vh=measured['viewport']['width'],measured['viewport']['height'];box=measured['content_bounds'];assert 0<=box['top']<box['bottom']<=vh and box['bottom']-box['top']>vh*.35
  y=math.floor(max(0,box['top']-8)*sh/vh)//2*2;bottom=min(sh,math.ceil((box['bottom']+8)*sh/vh));height=(bottom-y)//2*2
  left=float(box.get('left',0));right=float(box.get('right',vw));assert 0<=left<right<=vw
  x=math.floor(max(0,left-8)*sw/vw)//2*2;width=(min(sw,math.ceil((right+8)*sw/vw))-x)//2*2
  filters.append(f'[0:v]trim=start={start}:end={end},setpts=(PTS-STARTPTS)/{speed},crop={width}:{height}:{x}:{y},scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF5F6F7,setsar=1,fps=30[v{i}]')
  segments.append({**cut,'measured_css_bounds':box,'source_video_crop':[x,y,width,height],'removed_bottom_video_px':sh-(y+height),'output_duration':(end-start)/speed})
 filters.append(''.join(f'[v{i}]'for i in range(len(segments)))+f'concat=n={len(segments)}:v=1:a=0[out]')
 report={'source':str(source.relative_to(ROOT)),'source_sha256':sha(source),'source_video_size':[sw,sh],'cuts':segments,'duration_seconds':sum(s['output_duration']for s in segments),'output_size':[1920,1080],'method':'Actual chronological capture cropped to measured card bounds; scale uniformly to common landscape canvas; no loop, fake frame or frozen movement.'}
 if a.check:print(json.dumps(report,ensure_ascii=False));return
 out.parent.mkdir(parents=True,exist_ok=True);script=out.with_suffix('.filter.txt');script.write_text(';\n'.join(filters))
 cmd=[str(BIN/'ffmpeg'),'-nostdin','-n','-i',str(source),'-filter_complex_script',str(script),'-map','[out]','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-threads','6','-movflags','+faststart',str(out)]
 result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE);out.with_suffix('.encode.log').write_bytes(result.stderr);assert result.returncode==0,result.stderr.decode()[-1800:];report['output']=str(out.relative_to(ROOT));report['output_sha256']=sha(out);out.with_suffix('.crop-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
