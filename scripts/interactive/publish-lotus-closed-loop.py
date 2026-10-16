"""Publish measured Lotus evidence, preserving every previous publication."""
import argparse
import datetime
import hashlib
import json
import shutil
import time
from pathlib import Path

ROOT=Path('/data-ssd/zhongchengkai/agnes')
OUT=ROOT/'artifacts/indoor-rescue-upgrade'
SESSION=OUT/'lotus-closed-loop-session-20261008'
p=argparse.ArgumentParser()
p.add_argument('--attempt',type=int,required=True)
p.add_argument('--mission',required=True)
a=p.parse_args()
validation=SESSION/f'attempt{a.attempt}-validation.json'
v=json.loads(validation.read_text())
physical=SESSION/f'attempt{a.attempt}-physical'
if not physical.exists():raise SystemExit('Preserve physical evidence before publication')
mission=ROOT/'artifacts/interactive-live/missions'/a.mission
state=json.loads((mission/'current.json').read_text())
names=['lotus-old-path-target.json','lotus-event-target-geometry.json',
       'lotus-event-closed-loop-validation.json','lotus-event-onboard-detection-final.json',
       'replan-causality-lotus-final.json','lotus-closed-loop-final-debug.json']
archive=SESSION/'published-history'/str(time.time_ns())
archive.mkdir(parents=True)
for name in names:
 if (OUT/name).exists():shutil.copy2(OUT/name,archive/name)
def save(name,d):
 (OUT/name).write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
for name in names[:3]:
 d=json.loads((physical/name).read_text());d.update(mission_id=a.mission,attempt=a.attempt)
 d['preserved_physical_evidence_directory']=str(physical)
 if name=='lotus-event-closed-loop-validation.json':
  d['independent_physical_continuity']=v.get('physical_continuity')
  d['preserved_trace']=str(physical/Path(d['trace']).name)
 save(name,d)
detection_keys=['lidar_surface_evidence','no_target_surface_detection_before_T1',
 'global_raw_marking','global_inflation_from_obstacle','old_path_inflation_conflict_at_event','live_world_from_onboard']
save(names[3],{'mission_id':a.mission,'checks':{k:v['checks'][k] for k in detection_keys},
 'first_onboard_detection':v['first_onboard_detection'],'first_global_marking':v['first_global_marking'],
 'global_inflation':v.get('global_inflation'),'onboard_world_update':v['onboard_world_update'],
 'evidence_stream':v['evidence_stream'],'no_scenario_state_input':True,
 'pass':all(v['checks'][k] for k in detection_keys)})
v['scope']='Causal replan validation; full rescue and final regression are separately required for overall PASS'
v['evidence_validation_file']=str(validation)
save(names[4],v)
backup=json.loads((ROOT/'backups/post-nav2-baseline-before-imported-map/backup-verification.json').read_text())
save(names[5],{'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'overall_status':'IMPORTED_MAP_SENSOR_DRIVEN_RESCUE_BLOCKED','attempt':a.attempt,
 'repair_attempts':json.loads((SESSION/'attempts.json').read_text()),
 'mission_id':a.mission,'mission_status':state['status'],'mission_outcome':state.get('outcome'),
 'causal_replan_pass':v['pass'],'chronology':v['chronology'],
 'physical_continuity':v.get('physical_continuity'),'backup_pass':backup['pass'],
 'full_rescue_and_final_regression_required':True,
 'raw_stream_sha256':hashlib.file_digest(Path(v['evidence_stream']).open('rb'),'sha256').hexdigest(),
 'preserved_previous_publication':str(archive),'pass':False})
print(json.dumps({'published':names,'causality_pass':v['pass'],'overall_pass':False}))
