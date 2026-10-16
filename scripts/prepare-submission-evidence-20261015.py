from pathlib import Path
import json,hashlib,subprocess,zipfile,os,re,shutil,datetime
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/submission-materials-20261015';D=O/'package';E=D/'04_可核查运行证据';C=D/'05_源码与配置';C.mkdir(parents=True,exist_ok=True)
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
SENSITIVE=re.compile(r'^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|bearer|authorization|cookie|credentials|client[_-]?secret)$',re.I)
changes=[]
def sanitize(x,path=''):
 if isinstance(x,dict):
  out={}
  for k,v in x.items():
   if SENSITIVE.fullmatch(k):out[k]='[REDACTED_CREDENTIAL]';changes.append(path+'/'+k)
   else:out[k]=sanitize(v,path+'/'+k)
  return out
 if isinstance(x,list):return[sanitize(v,path+'/'+str(i))for i,v in enumerate(x)]
 if isinstance(x,str):
  x=re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~+/-]{20,}',r'\1[REDACTED]',x)
  x=re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|password)\s*[=:]\s*["\']?)([A-Za-z0-9._~+/-]{16,})',r'\1[REDACTED]',x)
 return x
records=[]
def copy(src,relative):
 p=R/src;out=E/relative;out.parent.mkdir(parents=True,exist_ok=True);before=len(changes)
 if p.suffix in ['.json','.jsonl']:
  if p.suffix=='.json':out.write_text(json.dumps(sanitize(json.loads(p.read_text())),ensure_ascii=False,indent=2)+'\n')
  else:out.write_text(''.join(json.dumps(sanitize(json.loads(l)),ensure_ascii=False)+'\n'for l in p.read_text().splitlines()if l.strip()))
 else:shutil.copyfile(p,out)
 records.append({'original_project_path':src,'original_sha256':sha(p),'delivered_file':str(out.relative_to(D)),'delivered_sha256':sha(out),'redacted_fields':len(changes)-before})
root='artifacts/demo-video/autonomous-retake-20261014T142608Z/'
for f in ['session-plan.json','actual-ui-messages.jsonl','native-events.jsonl','native-tool-results.jsonl','native-turn-end.jsonl','post-task-door-states.json','ros-observer.jsonl','scene-reset/readiness.json','scene-reset/after.json']:
 copy(root+f,'正常案例/阶段一/'+Path(f).name)
for f in ['actual-followup-prompt.txt','native-events.jsonl','native-tool-results.jsonl','verified-physical-endpoint.json','verified-tool-summary.json','ros-observer.jsonl','turn-result.json']:
 copy(root+'supplement-open-and-approach/'+f,'正常案例/阶段二/'+f)
fail=R/'artifacts/submission-evidence-20261014/search-partial-failure'
for f in fail.iterdir():
 if f.is_file():copy(str(f.relative_to(R)),'失败案例/'+f.name)
copy('artifacts/map-switch-localization-repair-20261015/roundtrip-verification.json','地图切换/roundtrip-verification.json')
(E/'证据来源清单.json').write_text(json.dumps({'files':records,'redaction_policy':'Credential fields and bearer values only; statements, success and failure outputs retained. Source hashes identify original server files.','redacted_fields_count':len(changes),'originals_untouched':True},ensure_ascii=False,indent=2)+'\n')
# Compact readable chain with explicit phase separation, references into exact provided AGH tool results.
chain=[]
for phase,folder in [('阶段一单句自主搜寻',E/'正常案例/阶段一'),('阶段二追加指令开门接近',E/'正常案例/阶段二')]:
 for line in (folder/'native-tool-results.jsonl').read_text().splitlines():
  x=json.loads(line);tool=x.get('tool','');res=x.get('result');res=res if isinstance(res,dict)else{};selected={k:res[k]for k in ['status','reason','code','operation_id','door_id','target_verified','after_confidence','current_location','stopped','navigation_active','navigation_status']if k in res}
  if any(w in tool for w in ['navigate_to','inspect_door','open_door','inspect_object','stop_robot','get_robot_state','get_observation']):chain.append({'phase':phase,'at_UTC':x.get('at'),'event_seq':x.get('event_seq'),'call_seq':x.get('call_seq'),'tool':tool,'args':x.get('args'),'result_excerpt':selected,'full_record':str((folder/'native-tool-results.jsonl').relative_to(D))})
(E/'代表工具链.json').write_text(json.dumps({'chain':chain,'note':'Excerpts aid reading; full native results remain the authority. Two phases have different user objectives.'},ensure_ascii=False,indent=2)+'\n')
# Source snapshot includes current live source and all tracked Harness files, never private runtime homes or caches.
tracked=set(subprocess.check_output(['git','ls-files','-z'],cwd=R).decode().split('\0'));tracked.discard('')
for folder in ['packages','services','scripts','simulation','maps','demo','docs']:
 for p in (R/folder).rglob('*'):
  if p.is_file()and not any(x in p.parts for x in ['node_modules','.git','dist','build','__pycache__','logs','cache','backups']):tracked.add(str(p.relative_to(R)))
tracked.update(['runtime/ros2-jazzy/pixi.toml','runtime/ros2-jazzy/pixi.lock','README.md','UPSTREAM.md','package.json','.gitignore'])
allowed=[p for p in sorted(tracked)if not any(x in Path(p).parts for x in ['.git','node_modules','profiles','tools','artifacts','logs','.github-cli','.agh-home-step7']) and not p.startswith(('scripts/codex-','scripts/credentials')) and not p.endswith(('.pyc','.pem','.key'))]
secret=re.compile(rb'(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
files=[];held=[];zpath=C/'具身救援源码快照.zip'
with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED,compresslevel=8)as z:
 for name in allowed:
  p=R/name
  if not p.exists()or not p.is_file():continue
  if p.stat().st_size>6*1024*1024:held.append({'file':name,'reason':'large asset; separate dependency or re-generation required'});continue
  data=p.read_bytes()
  if secret.search(data):held.append({'file':name,'reason':'credential-like material excluded, including upstream synthetic key fixtures'});continue
  if p.is_symlink():
   target=p.resolve()
   if not target.is_relative_to(R):held.append({'file':name,'reason':'out of workspace symlink'});continue
  z.write(p,'agnes/'+name);files.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'mode':oct(p.stat().st_mode&0o777)})
with zipfile.ZipFile(zpath)as z:assert z.testzip()is None
(C/'source-file-manifest.json').write_text(json.dumps({'snapshot_date':'2026-10-15','current_outer_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=R).decode().strip(),'includes_uncommitted_current_source':True,'upstream_commit':'fe90962a6b8561d8cae7e5d451905604fcf475cf475cf'.replace('475cf475cf','475cf'),'archive_sha256':sha(zpath),'files':files,'excluded':held,'private_runtime_and_model_keys_excluded':True,'installed_dependencies_not_included':True},ensure_ascii=False,indent=2)+'\n')
patch=subprocess.check_output(['git','diff','--binary','HEAD'],cwd=R/'third_party/agnes-harness');(C/'AGH本地适配补丁.patch').write_bytes(patch);(C/'AGH本地适配说明.md').write_text('# AGH 本地适配说明\n\n上游固定提交 fe90962a6b8561d8cae7e5d451905604fcf475cf。源码快照是当前工作区文件，已包含补丁后的内容；补丁用于审查，不要再次应用到快照。\n\n当前嵌套上游有 21 个修改文件，涵盖图像输入能力透传、MCP 结果图像/产物投影及相关协议、Web、worker 接口与测试。具体以补丁为准。UPSTREAM.md 中“未修改”和早期 Step 2/3 文档描述的是历史阶段，不能用来说明本次状态。\n\n保留 AGH Apache-2.0 许可；本项目自有代码的发布许可由参赛成员审核。运行凭据、已安装工具链、缓存、原始巨大录像不在源代码包中。\n')
# Verified runtime model metadata only; no account/provider credential export.
(E/'模型调用核查.json').write_text(json.dumps({'core_task_provider':'agnes-ai','core_task_request_model':'agnes-3.0-flash','task_session':'autonomous-retake-1791988041810','task_preset':'standard','visual_provider':'agnes-ai','visual_request_model':'agnes-3.0-flash','visual_preset':'sensor-image','visual_input':'Fresh real Gazebo/ROS Camera PNG sent as SDK image content','visual_output':'Structured detections with labels, pixel bboxes and model confidence; not map coordinates','visual_source_code':'services/robot-mcp/perception/vlm-worker.mts','task_evidence':'04_可核查运行证据/正常案例/阶段一/actual-ui-messages.jsonl','weight_revision':'【待主办方确认_模型权重版本】','route':'account-agnes-official','postproduction_TTS':'Qwen/Qwen3-TTS-12Hz-1.7B-Base, selected generic synthetic voice09, disclosed separately from robot task','all_live_core_calls_in_this_evidence_use_agnes':True},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'evidence_files':len(records),'redacted_fields':len(changes),'source_files':len(files),'source_archive_bytes':zpath.stat().st_size,'held_files':len(held)},ensure_ascii=False))
