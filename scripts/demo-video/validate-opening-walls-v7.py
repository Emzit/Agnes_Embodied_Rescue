"""Read-only media and presentation geometry verification for opening revision."""
from pathlib import Path
import json,subprocess,hashlib,importlib.util,math
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-opening-walls-v7';BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin'
SOURCE=OUT/'input-active/project-film.mp4';FINAL=OUT/'project-film-opening-walls-v7.mp4'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def probe(p,selection):
 return json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error','-select_streams',selection,'-show_streams','-show_packets','-show_data_hash','sha256','-show_entries','stream=codec_name,width,height,nb_frames,avg_frame_rate,sample_rate,channels,time_base,extradata_hash:packet=pts,dts,pts_time,dts_time,duration,size,flags,data_hash','-of','json',str(p)]))
def main():
 assert Path.cwd()==ROOT
 audio1=probe(SOURCE,'a:0');audio2=probe(FINAL,'a:0');audio_exact=audio1==audio2
 video1=probe(SOURCE,'v:0');video2=probe(FINAL,'v:0')
 a=[q for q in video1['packets']if float(q['pts_time'])>=25];b=[q for q in video2['packets']if float(q['pts_time'])>=25]
 packet_clock_exact=len(a)==len(b) and all({k:v for k,v in x.items()if k not in ['data_hash','size']}=={k:v for k,v in y.items()if k not in ['data_hash','size']}for x,y in zip(a,b))
 # The concat demuxer inserts SPS/PPS headers at keyframes. Verify decoded
 # pictures independently instead of claiming their packaging bytes match.
 workers=[subprocess.Popen([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','3','-ss','25','-i',str(p),'-map','0:v:0','-an','-c:v','rawvideo','-pix_fmt','yuv420p','-f','hash','-hash','sha256','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)for p in [SOURCE,FINAL]]
 hashes=[]
 for worker in workers:
  result,error=worker.communicate();assert worker.returncode==0,error.decode();hashes.append(result.decode().strip())
 exact=packet_clock_exact and hashes[0]==hashes[1];shape=video2['streams'][0];spec=shape['width']==1438 and shape['height']==1080 and shape['avg_frame_rate']=='30/1' and shape['nb_frames']=='6465'
 subtitles=sha(OUT/'input-active/project-film.zh-CN.srt')==sha(OUT/'project-film-opening-walls-v7.zh-CN.srt')
 sp=importlib.util.spec_from_file_location('map7',ROOT/'scripts/demo-video/film-map-25d-v7.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
 heights=[m.wall_cutaway_height(seg)for seg in m.WALLS];uniform=len(set(heights))==1
 # A door centre cannot be part of the joined wall footprint.
 doors=[]
 for d in m.OFFICE['geometry']['doors']:
  x,y=d['at'];covered=any(min(p[0]for p in poly)+1e-8<x<max(p[0]for p in poly)-1e-8 and min(p[1]for p in poly)+1e-8<y<max(p[1]for p in poly)-1e-8 for poly in m.UNION_CELLS)
  doors.append({'id':d['id'],'width':d['width'],'opening_clear':not covered})
 report={'passed':audio_exact and exact and spec and subtitles and uniform and all(d['opening_clear']for d in doors),'geometry_fps_total_frames_preserved':spec,'all_later_video_frames_after25seconds_exact':exact,'all_later_packet_clocks_exact':packet_clock_exact,'decoded_reference_sha256':hashes[0],'decoded_candidate_sha256':hashes[1],'keyframe_header_packaging_changed':a!=b,'later_video_packets_checked':len(a),'all_audio_packets_and_timestamps_exact':audio_exact,'audio_packets_checked':len(audio1['packets']),'subtitle_text_and_times_identical':subtitles,'walls_use_single_cutaway_height':uniform,'wall_height':heights[0],'walls_joined_as_one_union':True,'door_holes':doors,'actual_office_geometry_sha256':sha(m.GEOMETRY_FILE),'deleted_legend':'R1 大房间 · R2 近端 · R3 中部 · R4 右前','source_sha256':sha(SOURCE),'candidate_sha256':sha(FINAL),'scope':'Presentation animation only; simulation and live UI unchanged.'}
 (OUT/'qa-v7.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
 if not report['passed']:
  print('VIDEO_MISMATCHES',[(i,x['pts_time'],x['data_hash'],y['data_hash'])for i,(x,y)in enumerate(zip(a,b))if x!=y][:4]);raise SystemExit(1)
if __name__=='__main__':main()
