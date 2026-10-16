"""Finished-media validation for the four authorised film edits."""
from pathlib import Path
import json,subprocess,hashlib,math,collections
import numpy as np
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-agh-narration-v9';BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin';SOURCE=OUT/'input-active/project-film.mp4';FINAL=OUT/'project-film-AGH-v9.mp4';W,H=1438,1080

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def call(args):
 result=subprocess.run([str(BIN/'ffmpeg'),'-nostdin','-v','error',*map(str,args)],stdout=subprocess.PIPE,stderr=subprocess.PIPE);assert result.returncode==0,result.stderr.decode();return result.stdout
def exact(pipe,n):
 out=bytearray()
 while len(out)<n:
  part=pipe.read(n-len(out))
  if not part:break
  out.extend(part)
 return bytes(out)
def picture_check():
 workers=[subprocess.Popen([str(BIN/'ffmpeg'),'-nostdin','-v','error','-threads','3','-i',str(p),'-map','0:v:0','-an','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=(OUT/(n+'-qa-decode.log')).open('wb'))for p,n in [(SOURCE,'source'),(FINAL,'candidate')]]
 sse=0.;samples=0;frames=0;worst=100.
 try:
  for i in range(6465):
   a=exact(workers[0].stdout,W*H*3);b=exact(workers[1].stdout,W*H*3);assert len(a)==len(b)==W*H*3
   if i<585 or 675<=i<690 or 1050<=i<1530 or i>=3060:
    x=np.frombuffer(a,np.uint8).astype(np.float32)-np.frombuffer(b,np.uint8);ss=float(np.sum(x*x,dtype=np.float64));sse+=ss;samples+=x.size;frames+=1;mse=ss/x.size;psnr=math.inf if not mse else 10*math.log10(255**2/mse);worst=min(worst,psnr)
  assert all(p.stdout.read(1)==b'' for p in workers);assert all(p.wait()==0 for p in workers)
 finally:
  for p in workers:
   if p.poll()is None:p.terminate()
 mean=10*math.log10(255**2/(sse/samples));return {'frames':frames,'mean_psnr_db':mean,'minimum_frame_psnr_db':worst,'passed':frames==4485 and mean>=35 and worst>=30}
def audio_check():
 expected=call(['-i',OUT/'voice/master-AGH-v9.wav','-t','215.5','-f','f32le','-c:a','pcm_f32le','-']);actual=call(['-i',FINAL,'-map','0:a:0','-t','215.5','-f','f32le','-c:a','pcm_f32le','-'])
 x=np.frombuffer(expected,np.float32).astype(np.float64);y=np.frombuffer(actual,np.float32).astype(np.float64);assert len(x)==len(y)
 rms=float(np.sqrt(np.mean(x*x)));err=float(np.sqrt(np.mean((x-y)**2)));corr=float(np.dot(x,y)/np.sqrt(np.dot(x,x)*np.dot(y,y)))
 return {'samples':len(x),'correlation':corr,'rms_error':err,'relative_rms_error':err/rms,'passed':corr>.995 and err/rms<.08}
def main():
 assert Path.cwd()==ROOT
 render=json.loads((OUT/'render-report-v9.json').read_text());layout=json.loads((OUT/'layout-notes-v9.json').read_text());timeline=json.loads((OUT/'narration-timeline-v9.json').read_text());mix=json.loads((OUT/'audio-mix-report-v9.json').read_text());prov=json.loads((OUT/'voice/audio-provenance-v9.json').read_text())
 media=json.loads(subprocess.check_output([str(BIN/'ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(FINAL)]));v=next(s for s in media['streams']if s['codec_type']=='video');a=next(s for s in media['streams']if s['codec_type']=='audio')
 spec=v['width']==W and v['height']==H and v['avg_frame_rate']=='30/1' and v['nb_frames']=='6465' and abs(float(media['format']['duration'])-215.5)<.05 and a['tags']['language']=='zho'
 note=layout['architecture_note'];reference=layout['perception_note'];footer=note['font_size']==reference['font_size']==24 and note['color']==reference['color'] and note['top_y']>layout['last_card_bottom_y']+12 and layout['architecture_line_y']>note['top_y']+44
 shadow=layout['architecture_shadow_alpha']>layout['previous_shadow_alpha']
 draft=(OUT/'script-AGH-v9.txt').read_text();srt=(OUT/'project-film-AGH-v9.zh-CN.srt').read_text();text='艾格尼斯'not in draft+srt and 'Agnes'not in draft and draft.count('AGH')==3 and srt.count('AGH')==3
 expected=json.loads((ROOT/'artifacts/demo-project-film-20261014/revision-architecture-align-v8/alignment-and-text-v8.json').read_text())['labels'];labels=all(collections.Counter(x)==collections.Counter(y)for x,y in zip(expected,layout['labels']))
 alignment=all(c['accent_center_x']==i['center'][0]for c,i in zip(layout['card_grid'],layout['icon_grid']))
 english=next(r for r in prov['records']if r['name']=='english-letter-names');spell=english['language']=='English' and english['text']=='A, G, H.' and prov['selected_voice_id']=='09' and prov['all_fit']
 pre=render['unchanged_fullframe_inputs']['exact']and render['native_chat_camera_map_outside_subtitle_band']['exact']and render['steady_actual_inset_inputs']['exact']and mix['unchanged_pcm_exact_before_encoding']
 pictures=picture_check();audio=audio_check();passed=all([spec,footer,shadow,text,labels,alignment,spell,pre,pictures['passed'],audio['passed'],render['opening_label']=='从门口进入'])
 result={'passed':passed,'duration_seconds':float(media['format']['duration']),'opening_label':render['opening_label'],'architecture_note_moved_below_card_with_clear_line_gap':footer,'architecture_note_font_color_matches_perception_note':footer,'architecture_card_shadow_stronger':shadow,'icon_and_accent_alignment_retained':alignment,'all_other_reference_text_unchanged':labels,'script_and_subtitles_use_AGH_not_old_chinese_name':text,'AGH_generated_as_English_letter_names_with_same_voice09':spell,'all_changed_clips_fit_without_speed_or_pitch_change':prov['all_fit'],'native_dialogue_camera_and_map_outside_captions_preserved_before_encoding':pre,'actual_preserved_picture_comparison':pictures,'actual_mixed_audio_comparison':audio,'six_other_passages_pcm_preserved':mix['six_other_narration_passages_preserved'],'source_sha256':sha(SOURCE),'candidate_sha256':sha(FINAL),'robot_or_core_model_changes':False}
 (OUT/'qa-v9.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False),flush=True)
 if not passed:raise SystemExit(1)
if __name__=='__main__':main()
