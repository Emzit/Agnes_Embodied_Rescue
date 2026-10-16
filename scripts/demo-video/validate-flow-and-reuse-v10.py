"""Media validation: exact audio packets, layout, clean dissolve and unchanged recording inputs."""
from pathlib import Path
import json,subprocess,hashlib,math,collections,importlib.util
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-flow-and-reuse-v10';BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin';SOURCE=OUT/'input-active/project-film.mp4';FINAL=OUT/'project-film-flow-reuse-v10.mp4';W,H=1438,1080

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact(pipe,n):
 out=bytearray()
 while len(out)<n:
  part=pipe.read(n-len(out))
  if not part:break
  out.extend(part)
 return bytes(out)
def packets(p):
 cmd=[str(BIN/'ffprobe'),'-v','error','-select_streams','a:0','-show_packets','-show_streams','-show_data_hash','sha256','-show_entries','stream=codec_name,sample_rate,channels,time_base,extradata_hash:packet=pts,dts,pts_time,dts_time,duration,size,flags,data_hash','-of','json',str(p)]
 return json.loads(subprocess.check_output(cmd))
def pictures():
 workers=[subprocess.Popen([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','3','-i',str(p),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/(n+'-qa-decode.log')).open('wb'))for p,n in [(SOURCE,'source'),(FINAL,'candidate')]]
 sse=0.;samples=0;frames=0;worst=100.;contact=Image.new('RGB',(960,810),'#F5F6F7');j=0
 try:
  for i in range(6465):
   a=exact(workers[0].stdout,W*H*3);b=exact(workers[1].stdout,W*H*3);assert len(a)==len(b)==W*H*3
   if not(675<=i<690 or 1530<=i<4800):
    x=np.frombuffer(a,np.uint8).astype(np.float32)-np.frombuffer(b,np.uint8);ss=float(np.sum(x*x,dtype=np.float64));sse+=ss;samples+=x.size;frames+=1;mse=ss/x.size;psnr=math.inf if not mse else 10*math.log10(255**2/mse);worst=min(worst,psnr)
   if i in [674,675,678,682,686,689,690,1800,2610,3420,4320]:
    im=Image.frombytes('RGB',(W,H),b);im.save(OUT/'previews'/f'actual-v10-{i}.jpg',quality=95)
    if i<=690:
     tile=im.resize((320,240));contact.paste(tile,((j%3)*320,(j//3)*270));ImageDraw.Draw(contact).text(((j%3)*320+6,(j//3)*270+242),f'{i/30:.3f}s / frame {i}',fill='#1C1F23');j+=1
  assert all(p.stdout.read(1)==b'' for p in workers);assert all(p.wait()==0 for p in workers)
 finally:
  for p in workers:
   if p.poll()is None:p.terminate()
 contact.save(OUT/'previews/actual-opening-transition-v10.jpg',quality=95)
 mean=10*math.log10(255**2/(sse/samples));return {'frames':frames,'mean_psnr_db':mean,'minimum_frame_psnr_db':worst,'passed':frames==3180 and mean>=35 and worst>=30}
def main():
 assert Path.cwd()==ROOT
 render=json.loads((OUT/'render-report-v10.json').read_text());layout=json.loads((OUT/'layout-notes-v10.json').read_text())
 media=json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(FINAL)]));v=next(s for s in media['streams']if s['codec_type']=='video');a=next(s for s in media['streams']if s['codec_type']=='audio')
 spec=v['width']==W and v['height']==H and v['avg_frame_rate']=='30/1' and v['nb_frames']=='6465' and abs(float(media['format']['duration'])-215.5)<.05 and a['tags']['language']=='zho'
 audio=packets(SOURCE)==packets(FINAL);srt=sha(OUT/'input-active/project-film.zh-CN.srt')==sha(OUT/'project-film-flow-reuse-v10.zh-CN.srt')
 db=next(x for x in layout['architecture_icons']if x['kind']=='database');c=next(x for x in layout['architecture_cards']if x['bounds'][1]==705)
 alignment=db['center'][0]==c['accent_center_x']==159 and db['art_bounds'][1]-c['accent_bounds'][3]==12 and db['art_bounds'][2]-db['art_bounds'][0]==44
 old=json.loads((ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9/layout-notes-v9.json').read_text())['labels'];new=layout['labels'];labels=old[:3]==new[:3]
 expected=collections.Counter(old[3]);expected.subtract(['简化莲华古城','当前场景：经典地图 / 简化莲华古城 / 办公室火灾','当前为 Gazebo 仿真验证。真机部署与完整搜救稳定性仍需进一步验证。']);expected.update(['当前场景：经典地图 / 办公室火灾']);labels=labels and +expected==collections.Counter(new[3])
 swap=layout['reuse_cards']['03 安全切换']==[755,595,1393,878] and layout['reuse_cards']['04 切换后验证']==[57,595,694,878]
 transition=render['clean_opening_dissolve']['exact'] and len(render['clean_opening_dissolve']['frames'])==15 and all(not f['old_baked_frame_used']for f in render['clean_opening_dissolve']['frames'])
 before=render['unchanged_fullframe_inputs']['exact']and render['steady_actual_inset_inputs']['exact']and render['unchanged_fullframe_inputs']['frames']==3180 and render['steady_actual_inset_inputs']['frames']==3230
 pic=pictures();passed=all([spec,audio,srt,alignment,labels,swap,transition,before,pic['passed']])
 result={'passed':passed,'duration_seconds':float(media['format']['duration']),'video_frames':6465,'audio_payloads_and_packet_times_identical':audio,'srt_file_identical':srt,'database_icon_gap_and_column_alignment':alignment,'authorized_deletions_only':labels,'cards_swapped_with_their_content':swap,'transition_uses_only_revised_intro_and_original_recording':transition,'unchanged_recording_inputs_exact':before,'actual_preserved_picture_comparison':pic,'information_flow_visibility':layout['packet'],'source_sha256':sha(SOURCE),'candidate_sha256':sha(FINAL),'robot_or_core_model_changes':False}
 (OUT/'qa-v10.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False),flush=True)
 if not passed:raise SystemExit(1)
if __name__=='__main__':main()
