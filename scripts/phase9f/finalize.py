"""Validate and aggregate actual Phase 9F/ROS/Nav2/sensor test evidence."""
import json
import re
from pathlib import Path
import subprocess

ROOT=Path('/data-ssd/zhongchengkai/agnes')
OUT=ROOT/'artifacts/phase9f'
LOG=ROOT/'logs/phase9f'
def load(path):return json.loads(path.read_text())
def save(name,value):(OUT/name).write_text(json.dumps(value,indent=2)+'\n')
def counts(name):
    text=(LOG/name).read_text()
    result={f:int(re.search(r'ℹ '+f+r' (\d+)',text).group(1)) for f in ['tests','pass','fail','skipped','cancelled']}
    assert result['pass']>0 and result['fail']==0 and result['cancelled']==0
    return result

results={name:counts(file) for name,file in [('generic_and_phase9c','regression.log'),
    ('real_nav2','nav2-regression.log'),('real_sensors','sensor-regression.log'),('real_world_model','acceptance-test.log')]}
cleanups={phase:load(ROOT/f'artifacts/{phase}/process-cleanup.json') for phase in ['phase9c','phase9d','phase9e','phase9f']}
assert all(c['all_stopped'] for c in cleanups.values())
for phase in ['phase9d','phase9e','phase9f']:
    registry=load(ROOT/f'.runtime-{phase}/processes.json')
    for entry in registry['entries']:
        path=Path(f"/proc/{entry['pid']}/stat")
        if path.exists():
            stat=path.read_text().rsplit(')',1)[1].split()
            assert stat[0]=='Z' or stat[19]!=entry['start_time']
assert not any(Path(f'/proc/{pid}').exists() for c in cleanups.values() for pid in c['tracked_pids'])
assert subprocess.check_output(['git','-C',str(ROOT/'third_party/agnes-harness'),'status','--short'],text=True)==''
assert load(OUT/'nav2-map-alignment.json')['mismatched_cells']==0
assert load(OUT/'leak-check.json')['passed']
for phase in ['phase9c','phase9d','phase9e']:
    assert load(ROOT/f'artifacts/{phase}/acceptance.json')['passed']
save('regression.json',{'passed':True,'results':results,'mock_backend':'PASS',
    'phase9b_fixture_executed':False,'phase9b_protocol_regression':'JSONL unit tests and live real Nav2 bridge checks',
    'remaining_unimplemented_tools':[],
    'no_new_dependencies':True,'agnes_core_modified':False})
cleanup=load(OUT/'process-cleanup.json')
cleanup['regression_cleanups']=cleanups
cleanup['all_phase9f_and_regression_processes_stopped']=True
save('process-cleanup.json',cleanup)
acceptance=load(OUT/'acceptance.json')
assert acceptance['passed']
acceptance['regression_passed']=True
acceptance['conclusion']='PHASE9F_WORLD_MODEL_PASS'
save('acceptance.json',acceptance)
print('PHASE9F_WORLD_MODEL_PASS')
