"""Publish the validated signal styling update without changing recording or narration."""
from pathlib import Path
import json,hashlib,shutil,os,datetime
ROOT=Path('/data-ssd/zhongchengkai/agnes');OUT=ROOT/'artifacts/demo-project-film-20261014/revision-signal-pulse-v11';DELIVERY=ROOT/'artifacts/demo-project-film-20261014/final'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def ref(p):return {'path':str(p.relative_to(ROOT)),'sha256':sha(p),'bytes':p.stat().st_size}
def main():
 assert Path.cwd()==ROOT
 qa=json.loads((OUT/'qa-v11.json').read_text());assert qa['passed'];source=OUT/'input-active/project-film.mp4';assert sha(DELIVERY/'project-film.mp4')==sha(source),'ACTIVE_FILM_CHANGED_DURING_RENDER'
 movie=OUT/'project-film-signal-pulse-v11.mp4';sub=OUT/'project-film-signal-pulse-v11.zh-CN.srt';assert sha(movie)==qa['candidate_sha256']and sha(sub)==sha(OUT/'input-active/project-film.zh-CN.srt')
 m=json.loads((OUT/'input-active/project-film.edit-manifest.json').read_text());m['previous_qa']=m['qa'];m['previous_revision']={'version':m['version'],'source':ref(source),'manifest':ref(OUT/'input-active/project-film.edit-manifest.json')};m['supersedes']=m['previous_revision'];m['version']=11;m['kind']='PROJECT_FILM_ORANGE_WHITE_SIGNAL_CAPSULE_STYLE_REVISION';m['generated_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 m['change_scope'].update({'information_packet_style':'Orange-white capsule, tapered tail and fine fading arrival pulse','black_core_removed':True,'static_diagrams_words_and_connectors_identical_to_revision10':True,'accepted_audio_packets_and_srt_preserved_from_revision10':True})
 m['animation']['rendered_text']=ref(OUT/'layout-notes-v11.json');m['animation']['renderer']=ref(ROOT/'scripts/demo-video/reference-flow-v11.py');m['animation']['script']=ref(ROOT/'scripts/demo-video/render-signal-pulse-v11.py');m['animation']['note']='The only new visual change is the travelling signal: an antialiased orange-white capsule with restrained halo, tapered 42px tail and fine fading arrival pulse. All words, static diagram artwork, connector paths, motion timing, icon spacing and card positions from revision10 remain unchanged.';m['animation']['signal_style']=json.loads((OUT/'layout-notes-v11.json').read_text())['packet']
 m['qa']=ref(OUT/'qa-v11.json');m['render_report']=ref(OUT/'render-report-v11.json');m['visual_review']={'actual_finished_frames':[ref(OUT/'previews'/f'actual-v11-{t}.jpg')for t in [53.3,60.3,83.5,108.2,133.8,144.0]],'checked':'Capsule appearance in each of the four diagrams; preserved recording inset, opening dissolve and subtitles.'};m['output']=ref(movie);m['subtitles']['file']=ref(sub);m['subtitles']['unchanged_from_revision10']=True;m['narration']['unchanged_from_revision10_audio_packets_and_timing']=True
 manifest=OUT/'project-film-signal-pulse-v11.edit-manifest.json';manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
 for src,name in [(manifest,'project-film.edit-manifest.json'),(sub,'project-film.zh-CN.srt'),(movie,'project-film.mp4')]:
  target=DELIVERY/name;temporary=DELIVERY/(name+'.v11-staged');assert not temporary.exists();shutil.copy2(src,temporary);assert sha(src)==sha(temporary);os.replace(temporary,target)
 report={'version':11,'published_sha256':sha(DELIVERY/'project-film.mp4'),'video':'http://127.0.0.1:4177/demo-project-film','duration_seconds':215.5};(OUT/'delivery-report-v11.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
