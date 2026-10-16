from pathlib import Path
import json,subprocess,hashlib,math,time
R=Path('/data-ssd/zhongchengkai/agnes');V=R/'artifacts/demo-project-film-20261014/revision-autonomous-v12';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg';Q=F.with_name('ffprobe')
assert Path.cwd()==R
p=json.loads((V/'replay-supplement-plan-v12.json').read_text());out=V/'autonomous-replay-supplement-clean-v12.mp4';assert not out.exists();p['output']=str(out)
sw,sh=p['source_size'];g=p['geometry'];b=g['dual'];vw,vh=g['viewport']['width'],g['viewport']['height'];x0=round((b['left']-6)*sw/vw);y0=round((b['top']-6)*sh/vh);x1=round((b['right']+6)*sw/vw);y1=round((b['bottom']+6)*sh/vh);w,h=x1-x0,y1-y0;scale=min(1920/w,1080/h);nw,nh=round(w*scale),round(h*scale);left,top=(1920-nw)//2,(1080-nh)//2
filters=[];segments=[];offset=0
for i,c in enumerate(p['cuts']):
 assert c['mode']=='dual';n=round((c['end']-c['start'])/c['speed']*30);segments.append({**c,'output_start_frame':offset,'frames':n});offset+=n
 filters.append(f"[0:v]trim=start={c['start']}:end={c['end']},setpts=(PTS-STARTPTS)/{c['speed']},tpad=stop_mode=clone:stop_duration=0.08,fps=30,trim=end_frame={n},setpts=PTS-STARTPTS,crop={w}:{h}:{x0}:{y0},scale={nw}:{nh}:flags=lanczos,pad=1920:1080:{left}:{top}:color=0xF5F6F7[v{i}]")
filters.append(''.join(f'[v{i}]'for i in range(len(segments)))+f'concat=n={len(segments)}:v=1:a=0[out]')
cmd=[str(F),'-nostdin','-v','warning','-n','-threads','4','-c:v','libvpx-vp9','-i',p['source'],'-filter_complex',';'.join(filters),'-map','[out]','-an','-c:v','libx264','-preset','fast','-crf','18','-threads','6','-pix_fmt','yuv420p','-movflags','+faststart',str(out)]
print(json.dumps({'stage':'compatible-vp9-decode-and-crop','frames':offset}),flush=True)
result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE);(V/'supplement-clean-encode.log').write_bytes(result.stderr);assert result.returncode==0,result.stderr.decode()[-2000:]
probe=json.loads(subprocess.check_output([str(Q),'-v','error','-show_entries','format=duration:stream=width,height,nb_frames,r_frame_rate','-of','json',str(out)]));assert int(probe['streams'][0]['nb_frames'])==offset
report={**p,'frames':offset,'duration_seconds':offset/30,'segments':segments,'output_size':[1920,1080],'probe':probe,'output_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'decoder':'libvpx-vp9','decode_correction':'Native FFmpeg VP9 decoder produced damaged references; libvpx-vp9 restores genuine original frames. No reconstructed or synthetic pixels.','method':'Chronological actual dual-camera/map recording, measured uniform crop, idle cuts and modest motion speed changes.'};out.with_suffix('.edit-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'output':str(out),'duration_seconds':offset/30}),flush=True)
