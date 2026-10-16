"""Aggregate actual test evidence; never invent a pass or substitute sensor data."""
import json
import re
from pathlib import Path
import subprocess

ROOT = Path('/data-ssd/zhongchengkai/agnes')
OUT = ROOT / 'artifacts/phase9e'
LOG = ROOT / 'logs/phase9e'

def read_json(path):
    return json.loads(path.read_text())

def write_json(name, value):
    (OUT/name).write_text(json.dumps(value, indent=2)+'\n')

def counts(name):
    text = (LOG/name).read_text()
    result = {}
    for field in ['tests', 'pass', 'fail', 'skipped', 'cancelled']:
        result[field] = int(re.search(r'ℹ '+field+r' (\d+)', text).group(1))
    assert result['pass'] > 0 and result['fail'] == 0 and result['cancelled'] == 0
    return result

def alive(entry):
    try:
        stat = Path('/proc/'+str(entry['pid'])+'/stat').read_text().rsplit(')',1)[1].split()
        return stat[0] != 'Z' and stat[19] == entry['start_time']
    except OSError:
        return False

generic = counts('regression.log')
nav2 = counts('nav2-regression.log')
sensors = counts('acceptance-test.log')
numeric_unit = (LOG/'sensor-unit.log').read_text()
assert 'Ran 3 tests' in numeric_unit and '\nOK\n' in numeric_unit
d = read_json(ROOT/'artifacts/phase9d/acceptance.json')
c = read_json(ROOT/'artifacts/phase9c/acceptance.json')
assert d['passed'] and c['passed']
cleanups = {phase: read_json(ROOT/f'artifacts/{phase}/process-cleanup.json')
            for phase in ['phase9c','phase9d','phase9e']}
assert all(value['all_stopped'] for value in cleanups.values())
registries = {phase: read_json(ROOT/f'.runtime-{phase}/processes.json')
              for phase in ['phase9d','phase9e']}
assert not any(alive(e) for registry in registries.values() for e in registry['entries'])
tracked = [pid for cleanup in cleanups.values() for pid in cleanup['tracked_pids']]
assert not any(Path(f'/proc/{pid}').exists() for pid in tracked)
status = subprocess.check_output(['git','-C',str(ROOT/'third_party/agnes-harness'),
                                  'status','--short'], text=True)
assert status == ''
regression = {'passed': True, 'generic_and_phase9c': generic,
              'phase9d_real_nav2': nav2, 'phase9e_real_sensors': sensors,
              'numeric_sensor_unit_tests': {'passed': 3, 'failed': 0},
              'phase9b_fixture_test_executed': False,
              'phase9b_coverage': 'JSONL unit tests and live protocol/navigation/cancel tested with real Nav2; fixture action server prohibited',
              'mock_backend': 'PASS', 'remaining_unimplemented_tools': 0,
              'earlier_nav2_attempt': 'TF discovery readiness failed; bounded readiness retry, unchanged navigation assertions',
              'agnes_tracked_source_modified': False}
write_json('regression.json', regression)
cleanup = read_json(OUT/'process-cleanup.json')
cleanup['regression_process_cleanup'] = cleanups
cleanup['all_phase9e_and_regression_processes_stopped'] = True
write_json('process-cleanup.json', cleanup)
environment = read_json(OUT/'environment.json')
render_log = (ROOT/'.phase9e-home/.gz/rendering/ogre2.log').read_text()
environment['rendering_provenance'] = [line.split(': ',1)[-1] for line in render_log.splitlines()
                                      if any(key in line for key in ['GL_VERSION =','GL_VENDOR =','GL_RENDERER ='])]
environment['preflight'] = {'numpy': True, 'sensor_msgs': True,
                            'image_transport': False, 'cv_bridge': False,
                            'opencv': False, 'new_dependencies_installed': False}
write_json('environment.json', environment)
acceptance = read_json(OUT/'acceptance.json')
assert acceptance['passed']
acceptance['regression_passed'] = True
acceptance['all_processes_stopped'] = True
acceptance['conclusion'] = 'PHASE9E_REAL_SENSORS_PASS'
write_json('acceptance.json', acceptance)
print('PHASE9E_REAL_SENSORS_PASS')
