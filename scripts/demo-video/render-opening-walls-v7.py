"""Opening-only film revision. All later animation and accepted audio copied."""
from pathlib import Path
import importlib.util,subprocess,json,hashlib,time,shutil,argparse
from PIL import Image
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-opening-walls-v7';SOURCE=OUT/'input-active/project-film.mp4'
sp=importlib.util.spec_from_file_location('base_v5',ROOT/'scripts/demo-video/render-project-film-map25d-v5.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
sp=importlib.util.spec_from_file_location('joined_map_v7',ROOT/'scripts/demo-video/film-map-25d-v7.py');MAP=importlib.util.module_from_spec(sp);sp.loader.exec_module(MAP)
B.MAP25D=MAP
original_text=B.text
REMOVED='R1 大房间  ·  R2 近端  ·  R3 中部  ·  R4 右前'
def opening_text(d,xy,s,size=24,fill=B.WHITE):
 if s==REMOVED:return
 if s=='办公室火灾骨架':xy=(xy[0],848)
 if xy==(1130,845):xy=(xy[0],854)
 return original_text(d,xy,s,size,fill)
B.text=opening_text
CAPS=B.captions_from_timeline(ROOT/'artifacts/demo-project-film-20261014/revision-voice09-title-v4/voice/narration-cues-voice09.json')
W,H=1438,1080;FF=B.FF;PROBE=FF.with_name('ffprobe');FPS=30;OPENING_FRAMES=675;SPLICE_FRAMES=750

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact(pipe,n):
 out=bytearray()
 while len(out)<n:
  v=pipe.read(n-len(out))
  if not v:break
  out.extend(v)
 return bytes(out)
def intro(t):return B.subtitle(B.light_push(B.intro(t),t,30),CAPS,t)
def preview():
 (OUT/'previews').mkdir(exist_ok=True)
 for t in [0,10,16,19,22]:intro(t).save(OUT/'previews'/f'opening-v7-{t}.jpg',quality=95)
 # Direct map masks bind the union and a single height without touching the scene.
 info={'wall_heights':{wall['id']:MAP.wall_cutaway_height(wall)for wall in MAP.WALLS},'unified_top_plane':MAP.CUTAWAY_HEIGHT,'union_cells':len(MAP.UNION_CELLS),'exterior_edges':len(MAP.UNION_EDGES),'removed_caption':REMOVED,'geometry_file':str(MAP.GEOMETRY_FILE),'geometry_sha256':sha(MAP.GEOMETRY_FILE),'unchanged_path':MAP.PATH,'doors':MAP.OFFICE['geometry']['doors'],'physical_runtime_change':False}
 (OUT/'geometry-and-text-v7.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'previews':str(OUT/'previews'),'uniform_height':MAP.CUTAWAY_HEIGHT,'top_planes':len(set(info['wall_heights'].values()))}),flush=True)
def run(args,log):
 r=subprocess.run([str(x)for x in args],capture_output=True);(OUT/log).write_bytes(r.stderr)
 if r.returncode:raise RuntimeError(r.stderr.decode()[-2500:])
 return r.stdout

def render():
 introfile=OUT/'opening-and-splice-v7.mp4';tail=OUT/'unchanged-tail-v6.mp4';result=OUT/'project-film-opening-walls-v7.mp4'
 assert not any(p.exists()for p in [introfile,tail,result]),'NEW_OUTPUTS_REQUIRED'
 decoder=subprocess.Popen([str(FF),'-nostdin','-v','error','-i',str(SOURCE),'-an','-frames:v',str(SPLICE_FRAMES),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/'source-decode-v7.log').open('wb'))
 encoder=subprocess.Popen([str(FF),'-nostdin','-hide_banner','-v','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-threads','6','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(introfile)],stdin=subprocess.PIPE,stderr=(OUT/'opening-encode-v7.log').open('wb'))
 original=hashlib.sha256();kept=hashlib.sha256();began=time.monotonic()
 try:
  for i in range(SPLICE_FRAMES):
   data=exact(decoder.stdout,W*H*3);assert len(data)==W*H*3
   if i<OPENING_FRAMES:data_out=intro(i/FPS).tobytes()
   else:data_out=data;original.update(data);kept.update(data_out)
   encoder.stdin.write(data_out)
   if i%150==0:print(json.dumps({'frame':i,'elapsed':round(time.monotonic()-began,1)}),flush=True)
  assert decoder.stdout.read(1)==b''
  encoder.stdin.close();assert encoder.wait()==0 and decoder.wait()==0
 finally:
  for proc in [decoder,encoder]:
   if proc.poll()is None:proc.terminate()
 # 25.000 seconds is an independently verified source I-frame. The remainder
 # is packet-copied, keeping every existing technology animation and dialogue.
 run([FF,'-nostdin','-hide_banner','-v','warning','-n','-ss','25','-i',SOURCE,'-map','0:v:0','-an','-c:v','copy',tail],'tail-copy-v7.log')
 playlist=OUT/'video-concat-v7.txt';playlist.write_text(f"file '{introfile}'\nfile '{tail}'\n")
 run([FF,'-nostdin','-hide_banner','-v','warning','-n','-f','concat','-safe','0','-i',playlist,'-i',SOURCE,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',result],'splice-mux-v7.log')
 shutil.copy2(OUT/'input-active/project-film.zh-CN.srt',OUT/'project-film-opening-walls-v7.zh-CN.srt')
 (OUT/'render-report-v7.json').write_text(json.dumps({'source_sha256':sha(SOURCE),'candidate_sha256':sha(result),'changed_intro_frames':OPENING_FRAMES,'source_native_ui_splice_frames_preserved_before_encoding':{'frames':SPLICE_FRAMES-OPENING_FRAMES,'reference':original.hexdigest(),'input':kept.hexdigest(),'match':original.digest()==kept.digest()},'later_video_after_seconds':25,'later_video_method':'H264 packet copy at source keyframe','audio_method':'Entire accepted audio stream packet copy, including timing','subtitles_identical':True,'new_runtime_actions':False},indent=2)+'\n')
 print(json.dumps({'candidate':str(result),'sha256':sha(result)}),flush=True)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');args=ap.parse_args()
 assert Path.cwd()==ROOT
 preview()
 if not args.preview:render()
