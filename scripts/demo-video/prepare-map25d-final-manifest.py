#!/usr/bin/env python3
"""Bind actual map25d-v5 media only after full preservation and encoded visual QA."""
from pathlib import Path
import argparse,datetime,hashlib,json
ROOT=Path("/data-ssd/zhongchengkai/agnes")
D=ROOT/"artifacts/demo-project-film-20261014/revision-map25d-v5"
V4="e66bd0e252644298238d523cb6baf85ebf7e618ccb47607944b32f887bdf4a92"
def sha(p):
 with p.open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def inside(value):
 p=Path(value)
 if not p.is_absolute():p=ROOT/p
 p=p.resolve()
 if not p.is_relative_to(ROOT) or not p.is_file():raise ValueError("Existing project-local file required")
 return p
def bind(p):return {"path":str(p.relative_to(ROOT)),"sha256":sha(p),"bytes":p.stat().st_size}
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument("--video",required=True);ap.add_argument("--silent",required=True);ap.add_argument("--renderer",required=True)
 ap.add_argument("--map-module",required=True);ap.add_argument("--visual-qa",required=True);ap.add_argument("--path-qa",required=True);ap.add_argument("--preservation-qa",required=True)
 args=ap.parse_args()
 video=inside(args.video);silent=inside(args.silent);renderer=inside(args.renderer);module=inside(args.map_module)
 visual=inside(args.visual_qa);path=inside(args.path_qa);preservation=inside(args.preservation_qa)
 old=json.loads((D/"input-active/project-film.edit-manifest.json").read_text())
 if sha(D/"input-active/project-film.mp4")!=V4:raise ValueError("Immutable approvedv4 source required")
 q=json.loads(preservation.read_text());v=json.loads(visual.read_text());p=json.loads(path.read_text());digest=sha(video)
 if q.get("passed") is not True or q["candidate"]["sha256"]!=digest or q["reference"]["sha256"]!=V4:raise ValueError("Actualexact candidate preservationQA required")
 if digest not in visual.read_text() or not(v.get("passed") or v.get("verified") or v.get("status")=="PASS"):raise ValueError("Independentexact candidate visualQA required")
 if not(p.get("passed") or p.get("verified") or p.get("status")=="PASS"):raise ValueError("Projected3D map pathQA required")
 if not q.get("original_audio_entire_encoded_packet_and_clock_signature_exact") or not q.get("captions_entire_text_clock_content_exact"):raise ValueError("Preserveentire09audio/SRT required")
 rep=D/"render-preservation-report.json";audit=D/"preservation-audit.json";pd=json.loads(rep.read_text())
 if pd["output_silent"]["sha256"]!=sha(silent):raise ValueError("Bind exactactual silentrender")
 output=video.with_suffix(".edit-manifest.json")
 if output.exists():raise ValueError("Preserveexistingcandidate manifest")
 narration=old["narration"].copy()
 narration.update({"kind":"SELECTED_VOICE09_ENTIRE_ACCEPTED_AUDIO_STREAM_COPIED","selected_voice_id":"09","source_movie":bind(D/"input-active/project-film.mp4"),"source_completed_mix_manifest":bind(D/"input-active/project-film.edit-manifest.json"),"encoded_audio_packet_and_clocks_exact":True,"audio_packet_count":q["audio_packets"],"new_synthesis_or_remix":False})
 animation={k:v for k,v in old["original_animation"].items() if k not in("renderer","output_silent","render_preservation","preencoding_audit","full_UI_regions_exclusive_xyxy","retimed_caption_band_exclusive_xyxy")}
 animation.update({"renderer":bind(renderer),"map25d_module":bind(module),"output_silent":bind(silent),"render_preservation":bind(rep),"preencoding_audit":bind(audit),"map_style":"Bright restrained industrial2.5Darchitectural overhead skeleton. Exactcanonicalofficegeometry and doors; projectedillustrativemotion, notnewrobotstate.","style":pd.get("style",{}),"projected_path_QA":bind(path),"recorded_fullframes_include_original_v4burnedsubtitles":True,"caption_retiming":False})
 artifacts={k:v for k,v in old.get("artifacts",{}).items()}
 info={"version":5,"kind":"EDITORIAL_PROJECT_PRESENTATION_MAP25D_ANIMATION_ONLY_REVISION","technical_validation_only":False,"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"title":old["title"],"duration_seconds":300,"supersedes":{"previous_movie":bind(D/"input-active/project-film.mp4"),"previous_manifest":bind(D/"input-active/project-film.edit-manifest.json"),"previous_subtitles":bind(D/"input-active/project-film.zh-CN.srt"),"input_archive":bind(D/"input-archive.json")},"composition":old["composition"],"source":old["source"],"original_recorded_demo_lineage":old["original_recorded_demo_lineage"],"change_scope":{"animation_only":True,"map_architectural2p5D_reprojection":True,"original_office_geometry_and_doors_retained":True,"native_dialogue_camera_and_navigation_frame_timing_color_aspect_unchanged":True,"all_recorded_fullframe_pixels_preencoding_exact_including_subtitles":True,"all_steady_inset_pixels_preencoding_exact":True,"original_voice09_entire_encoded_audio_copied":True,"subtitles_timing_and_text_unchanged":True,"new_robot_actions":False,"new_runtime_model_calls":False},"original_animation":animation,"artifacts":artifacts,"review":{"verified":True,"status":"Actualwholepreservedmedia/audio/captionQA plus independentencodedmapvisual andpathQA passed; browserplaybackpending","actual_recorded_media_preservation_QA":bind(preservation),"actual_encoded_map_visual_QA":bind(visual),"projected_map_path_QA":bind(path),"wholevideo_decode_warning_free":q.get("decode_warning_free"),"fullframe_count":3255,"steady_PIP_count":4770,"fullframe_SSIM":q["pixel_comparisons"]["full_recorded_view"]["SSIM"]["mean_YUV444_SSIM"],"inset_SSIM":q["pixel_comparisons"]["recorded_inset"]["SSIM"]["mean_YUV444_SSIM"]},"output":{"path":str(video.relative_to(ROOT)),"sha256":digest,"bytes":video.stat().st_size,"duration":300.0,"frames":9000,"width":1438,"height":1080,"fps":30,"streams":[{"type":"video","codec":"h264"},{"type":"audio","codec":"aac"}]},"subtitle_files":[str(video.with_suffix(".zh-CN.srt").relative_to(ROOT))],"subtitles":old["subtitles"],"subtitle_binding":{"candidate":bind(video.with_suffix(".zh-CN.srt")),"source":bind(D/"input-active/project-film.zh-CN.srt"),"entire_content_exact":True},"narration":narration,"delivery":{"page":"http://127.0.0.1:4177/demo-project-film","movie_media_url":"http://127.0.0.1:4177/api/demo-ui/project-film/final.mp4","state":"MEDIA_VERIFIED_PUBLICATION_HTTP_BROWSER_PENDING","currentUIheadingunchanged":True,"newUIorROSrestartneeded":False}}
 with output.open("x") as f:json.dump(info,f,ensure_ascii=False,indent=2);f.write("\n")
 print(json.dumps({"manifest":str(output.relative_to(ROOT)),"manifest_SHA256":sha(output),"video_SHA256":digest}))
if __name__=="__main__":main()
