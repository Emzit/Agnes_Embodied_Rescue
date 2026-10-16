"""Focused verification of signal-only media revision."""
from pathlib import Path
import json,hashlib,subprocess,importlib.util,math
from PIL import Image
import numpy as np
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-signal-pulse-v11';SOURCE=OUT/'input-active/project-film.mp4';FINAL=OUT/'project-film-signal-pulse-v11.mp4';BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin';W,H=1438,1080;PIP=(1040,23,1372,197)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def probe(p,audio=False):
 args=['-select_streams','a:0','-show_packets','-show_streams','-show_data_hash','sha256','-show_entries','stream=codec_name,sample_rate,channels,time_base,extradata_hash:packet=pts,dts,pts_time,dts_time,duration,size,flags,data_hash']if audio else ['-show_streams','-show_format']
 return json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error',*args,'-of','json',str(p)]))
def frame(p,t):
 raw=subprocess.check_output([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','2','-ss',str(t),'-i',str(p),'-an','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);assert len(raw)==W*H*3
 return Image.frombytes('RGB',(W,H),raw)
def psnr(a,b):
 x=np.asarray(a).astype(np.float32)-np.asarray(b);mse=float(np.mean(x*x));return 100 if not mse else 10*math.log10(255**2/mse)
def module(v):
 s=importlib.util.spec_from_file_location('flow'+str(v),ROOT/f'scripts/demo-video/reference-flow-v{v}.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def main():
 assert Path.cwd()==ROOT
 render=json.loads((OUT/'render-report-v11.json').read_text());old,new=module(10),module(11)
 static=old.LABELS==new.LABELS and old.ALIGNMENT_CARDS==new.ALIGNMENT_CARDS and old.ALIGNMENT_ICONS==new.ALIGNMENT_ICONS and all(a[0].tobytes()==b[0].tobytes()and a[1:]==b[1:]for a,b in zip(old.SCENES,new.SCENES))
 media=probe(FINAL);v=next(s for s in media['streams']if s['codec_type']=='video');a=next(s for s in media['streams']if s['codec_type']=='audio');spec=v['width']==W and v['height']==H and v['avg_frame_rate']=='30/1' and v['nb_frames']=='6465' and abs(float(media['format']['duration'])-215.5)<.05 and a['tags']['language']=='zho'
 audio=probe(SOURCE,True)==probe(FINAL,True);srt=sha(OUT/'input-active/project-film.zh-CN.srt')==sha(OUT/'project-film-signal-pulse-v11.zh-CN.srt')
 unchanged=render['unchanged_fullframe_inputs']['exact']and render['unchanged_fullframe_inputs']['frames']==3195 and render['steady_actual_inset_inputs']['exact']and render['steady_actual_inset_inputs']['frames']==3230
 full=[];insets=[]
 for t in [0,10,22.4666666667,22.7333333333,23,35,47,163,191,210]:
  src=frame(SOURCE,t);dst=frame(FINAL,t);full.append({'seconds':t,'psnr_db':psnr(src,dst)})
  if 22<t<23:dst.save(OUT/'previews'/f'actual-v11-opening-{round(t,3)}.jpg',quality=95)
 for t in [53.3,60.3,83.5,108.2,133.8,144.0]:
  src=frame(SOURCE,t);dst=frame(FINAL,t);insets.append({'seconds':t,'psnr_db':psnr(src.crop(PIP),dst.crop(PIP))});dst.save(OUT/'previews'/f'actual-v11-{t}.jpg',quality=95)
 packet=new.signal_sprite();colours=np.asarray(packet);no_black=not np.any((colours[:,:,3]>150)&(np.max(colours[:,:,:3],axis=2)<120))
 passed=all([spec,static,audio,srt,unchanged,no_black,min(x['psnr_db']for x in full)>35,min(x['psnr_db']for x in insets)>35])
 qa={'passed':passed,'duration_seconds':215.5,'static_diagram_words_bounds_icon_positions_paths_identical_to_v10':static,'opening_real_dialogue_and_actual_robot_recording_inputs_retained':unchanged,'audio_packets_and_timing_identical':audio,'srt_identical':srt,'no_dark_core_pixels_in_signal':no_black,'actual_unchanged_fullframe_samples':full,'actual_recording_inset_samples':insets,'source_sha256':sha(SOURCE),'candidate_sha256':sha(FINAL),'new_runtime_actions':False,'new_core_model_calls':False};(OUT/'qa-v11.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2)+'\n');print(json.dumps(qa,ensure_ascii=False),flush=True)
 if not passed:raise SystemExit(1)
if __name__=='__main__':main()
