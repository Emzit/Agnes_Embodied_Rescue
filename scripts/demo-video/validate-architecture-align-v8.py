"""Independent media-clock, preserved-picture and requested-layout QA."""
from pathlib import Path
import json,hashlib,subprocess,collections
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-architecture-align-v8';BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin';SOURCE=OUT/'input-active/project-film.mp4';FINAL=OUT/'project-film-architecture-align-v8.mp4'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def probe(p,kind):
 return json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error','-select_streams',kind,'-show_streams','-show_packets','-show_data_hash','sha256','-show_entries','stream=codec_name,width,height,nb_frames,avg_frame_rate,sample_rate,channels,time_base,extradata_hash:packet=pts,dts,pts_time,dts_time,duration,size,flags,data_hash','-of','json',str(p)]))
def main():
 assert Path.cwd()==ROOT
 a=probe(SOURCE,'a:0');b=probe(FINAL,'a:0');audio=a==b
 va=probe(SOURCE,'v:0');vb=probe(FINAL,'v:0');shape=vb['streams'][0];spec=shape['width']==1438 and shape['height']==1080 and shape['nb_frames']=='6465' and shape['avg_frame_rate']=='30/1'
 def chosen(packet):t=float(packet['pts_time']);return t<50 or t>=160
 x=[p for p in va['packets']if chosen(p)];y=[p for p in vb['packets']if chosen(p)]
 clocks=len(x)==len(y)==3165 and all({k:v for k,v in a.items()if k not in ['size','data_hash']}=={k:v for k,v in b.items()if k not in ['size','data_hash']}for a,b in zip(x,y))
 workers=[subprocess.Popen([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','3','-i',str(p),'-map','0:v:0','-an','-vf',"select='lt(n,1500)+gte(n,4800)',setpts=N/(30*TB)",'-c:v','rawvideo','-pix_fmt','yuv420p','-f','hash','-hash','sha256','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)for p in [SOURCE,FINAL]]
 hashes=[]
 for proc in workers:
  result,error=proc.communicate();assert proc.returncode==0,error.decode();hashes.append(result.decode().strip())
 pictures=hashes[0]==hashes[1]
 layout=json.loads((OUT/'alignment-and-text-v8.json').read_text());cs=layout['cards'];icons=layout['icons'];axis=len(cs)==len(icons)==7 and all(c['accent_center_x']==i['center'][0]for c,i in zip(cs,icons))
 left=[i for i in icons if i['center'][0]==159];right=[i for i in icons if i['center'][0]==909]
 icon_edges=len(left)==4 and len(right)==2 and len({(i['art_bounds'][0],i['art_bounds'][2])for i in left})==1 and len({(i['art_bounds'][0],i['art_bounds'][2])for i in right})==1 and all(i['art_bounds'][2]-i['art_bounds'][0]==44 for i in left+right)
 lc=[c for c in cs if c['accent_center_x']==159 and c['bounds'][2]<1000];rc=[c for c in cs if c['accent_center_x']==909]
 card_edges=len({(c['bounds'][0],c['bounds'][2])for c in lc})==1 and len({(c['bounds'][0],c['bounds'][2])for c in rc})==1 and cs[-1]['bounds'][0]==lc[0]['bounds'][0] and cs[-1]['bounds'][2]==rc[0]['bounds'][2]
 labels=json.loads((ROOT/'artifacts/demo-project-film-20261014/revision-reference-flow-v6/reference-text-transcription.json').read_text())['labels']
 text=True
 for j,(reference,actual)in enumerate(zip(labels,layout['labels'])):
  expected=collections.Counter(reference);expected.subtract([f'{j+1:02} / 04']);text=text and +expected==collections.Counter(actual)
 no_pages=all(not any(s in ['01 / 04','02 / 04','03 / 04','04 / 04']for s in chapter)for chapter in layout['labels'])
 subtitles=sha(OUT/'input-active/project-film.zh-CN.srt')==sha(OUT/'project-film-architecture-align-v8.zh-CN.srt')
 render=json.loads((OUT/'render-report-v8.json').read_text());inset=render['inset_input_hash']==render['inset_reference_hash'] and render['inset_frames_before_encoding_exact']==3230
 passed=all([audio,spec,clocks,pictures,axis,icon_edges,card_edges,text,no_pages,subtitles,inset,render['native_ui_before_encoding_exact']])
 report={'passed':passed,'frame_size_fps_and_duration_preserved':spec,'intro_and_recorded_ending_pixels_exact':pictures,'decoded_reference_sha256':hashes[0],'decoded_candidate_sha256':hashes[1],'preserved_video_clocks_exact':clocks,'preserved_fullframe_pictures':3165,'complete_audio_packets_and_clocks_exact':audio,'audio_packets_checked':len(a['packets']),'icons_and_orange_bars_share_vertical_axis':axis,'left_and_right_icon_edges_aligned':icon_edges,'column_card_boundaries_aligned':card_edges,'all_other_reference_words_identical':text,'four_page_numbers_deleted':no_pages,'subtitle_text_and_times_identical':subtitles,'steady_inset_pixels_before_encoding_exact':inset,'source_sha256':sha(SOURCE),'candidate_sha256':sha(FINAL),'changed_scope_seconds':[51,160],'new_robot_or_model_actions':False}
 (OUT/'qa-v8.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
 if not passed:raise SystemExit(1)
if __name__=='__main__':main()
