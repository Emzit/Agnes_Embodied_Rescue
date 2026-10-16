"""Publish validated v10 media atomically; retain the prior active version in input-active."""
from pathlib import Path
import json,hashlib,shutil,os,datetime
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-flow-and-reuse-v10';DELIVERY=ROOT/'artifacts/demo-project-film-20261014/final'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def ref(p):return {'path':str(p.relative_to(ROOT)),'sha256':sha(p),'bytes':p.stat().st_size}
def main():
 assert Path.cwd()==ROOT
 qa=json.loads((OUT/'qa-v10.json').read_text());assert qa['passed'];source=OUT/'input-active/project-film.mp4';assert sha(DELIVERY/'project-film.mp4')==sha(source),'ACTIVE_FILM_CHANGED_DURING_RENDER'
 movie=OUT/'project-film-flow-reuse-v10.mp4';sub=OUT/'project-film-flow-reuse-v10.zh-CN.srt';assert sha(movie)==qa['candidate_sha256'];assert sha(sub)==sha(OUT/'input-active/project-film.zh-CN.srt')
 m=json.loads((OUT/'input-active/project-film.edit-manifest.json').read_text());m['previous_qa']=m['qa'];m['previous_revision']={'version':m['version'],'source':ref(source),'manifest':ref(OUT/'input-active/project-film.edit-manifest.json')};m['supersedes']=m['previous_revision'];m['version']=10;m['kind']='PROJECT_FILM_CLEAN_DISSOLVE_HIGH_CONTRAST_FLOW_AND_REUSE_LAYOUT_REVISION';m['generated_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 m['change_scope'].update({'opening_dissolve_old_baked_frames_removed':True,'architecture_database_icon_bar_gap_px':12,'information_packets_high_contrast':True,'reuse_cards_03_04_swapped_with_contents':True,'reference_words_preserved_except_user_requested_page_labels':False,'reference_words_preserved_except_explicit_user_requested_deletions':True,'accepted_voice09_audio_packets_and_timing_preserved':True,'accepted_srt_file_preserved':True})
 m['animation']['rendered_text']=ref(OUT/'layout-notes-v10.json');m['animation']['renderer']=ref(ROOT/'scripts/demo-video/reference-flow-v10.py');m['animation']['script']=ref(ROOT/'scripts/demo-video/render-flow-and-reuse-v10.py');m['animation']['note']='Reference-based layouts retained; ROS2 database icon moved down by 8px to leave 12px clearance. Moving packets use an ink core, orange ring, short orange tail and stronger active-card border. Reuse card03 is bottom right and04 bottom left, with information flow following01-02-03-04.'
 m['animation']['reuse_revision']={'deleted_map_list_entry':'简化莲华古城','scene_line':'当前场景：经典地图 / 办公室火灾','deleted_grey_footer':'当前为 Gazebo 仿真验证。真机部署与完整搜救稳定性仍需进一步验证。','card03_bounds':[755,595,1393,878],'card04_bounds':[57,595,694,878]}
 m['opening_animation']['scope_seconds']=[0,23];m['opening_animation']['transition']={'output_seconds':[22.5,23.0],'frames':15,'from':'Revised opening frame674','to':'Original film-footage frames0-14','curve':'Smoothstep dissolve','stale_baked_transition_frames_used':False};m['opening_animation']['transition_revision_script']=ref(ROOT/'scripts/demo-video/render-flow-and-reuse-v10.py')
 m['qa']=ref(OUT/'qa-v10.json');m['render_report']=ref(OUT/'render-report-v10.json');m['visual_review']={'actual_finished_frames':[ref(OUT/'previews'/name)for name in ['actual-opening-transition-v10.jpg','actual-v10-1800.jpg','actual-v10-2610.jpg','actual-v10-3420.jpg','actual-v10-4320.jpg']],'checked':'Clean opening dissolve; ROS2 spacing; high-contrast data packets; fifth diagram removals, card positions and connector order.'};m['output']=ref(movie)
 m['subtitles']['file']=ref(sub);m['subtitles']['unchanged_from_revision09']=True;m['narration']['unchanged_from_revision09_audio_packets_and_timing']=True
 manifest=OUT/'project-film-flow-reuse-v10.edit-manifest.json';manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
 for src,name in [(manifest,'project-film.edit-manifest.json'),(sub,'project-film.zh-CN.srt'),(movie,'project-film.mp4')]:
  target=DELIVERY/name;temporary=DELIVERY/(name+'.v10-staged');assert not temporary.exists();shutil.copy2(src,temporary);assert sha(src)==sha(temporary);os.replace(temporary,target)
 result={'version':10,'published_sha256':sha(DELIVERY/'project-film.mp4'),'previous_film_backup':ref(source),'video':'http://127.0.0.1:4177/demo-project-film','duration_seconds':215.5};(OUT/'delivery-report-v10.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
