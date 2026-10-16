"""Offline cases for ambiguous Gazebo acknowledgements and strict spawn proof."""
import copy
from pathlib import Path
from types import SimpleNamespace
import subprocess
import unittest
from simulation.final_rescue.object_spawn import (create_model_verified,parse_entity_observation,
    validate_spawn_evidence,expected_models)

ROOT=Path('/data-ssd/zhongchengkai/agnes')
WORLD='fixture_office_world'
POSE={'x':6.747,'y':-4.747,'z':0.,'roll':0.,'pitch':0.,'yaw':-2.744}
def response(stdout='',returncode=0):return SimpleNamespace(stdout=stdout,stderr='',returncode=returncode)
def observed(model='toolbox_2',world=WORLD,pose=None,entity_id=791):
    p=pose or POSE
    return f"""Requesting state for world [{world}]...
Model: [{entity_id}]
  - Name: {model}
  - Pose [ XYZ (m) ] [ RPY (rad) ]:
    [{p['x']} {p['y']} {p['z']}]
    [{p['roll']} {p['pitch']} {p['yaw']}]
"""
def missing(model='toolbox_2'):
    return f'Requesting state for world [{WORLD}]...\nNo model named <{model}> was found\n'
class FakeTransport:
    def __init__(self,results):self.results=list(results);self.commands=[]
    def __call__(self,command,**_):
        self.commands.append(command)
        result=self.results.pop(0)
        if isinstance(result,Exception):raise result
        return result
    def count(self,kind):return sum(command[1]==kind for command in self.commands)

def create(results,max_attempts=3):
    runner=FakeTransport(results)
    record=create_model_verified('toolbox_2','toolbox',POSE,
       ROOT/'artifacts/office-realism-v3-20261012/fixture-toolbox.sdf',WORLD,
       run=runner,sleep=lambda _:None,now=lambda:100.,max_attempts=max_attempts)
    return record,runner

class CreationTests(unittest.TestCase):
    def test_true_ack_is_preserved_without_extra_creation_or_model_probe(self):
        r,transport=create([response('data: true\n\n')])
        self.assertTrue(r['spawn_verified']);self.assertEqual(r['gazebo_response'],'data: true\n\n')
        self.assertEqual(transport.count('service'),1);self.assertEqual(transport.count('model'),0)

    def test_empty_ack_existing_entity_preserves_raw_and_does_not_recreate(self):
        r,transport=create([response(''),response(observed())])
        self.assertTrue(r['spawn_verified']);self.assertEqual(r['gazebo_response'],'')
        self.assertEqual(r['returncode'],0)
        self.assertEqual(r['verification']['entity_id'],791)
        self.assertEqual(r['verification']['status'],'EXISTS_AT_EXPECTED_POSE')
        self.assertEqual(transport.count('service'),1)

    def test_missing_entity_is_required_before_second_creation(self):
        r,transport=create([response(''),response(missing()),response('data: true\n')])
        self.assertTrue(r['spawn_verified'])
        self.assertEqual([c[1] for c in transport.commands],['service','model','service'])

    def test_unknown_state_never_authorizes_second_create(self):
        r,transport=create([response(''),response(''),response('')])
        self.assertFalse(r['spawn_verified'])
        self.assertEqual(transport.count('service'),1)
        self.assertEqual(transport.count('model'),2)

    def test_wrong_existing_pose_is_failure_without_replacement(self):
        r,transport=create([response(''),response(observed(pose={**POSE,'x':POSE['x']+1}))])
        self.assertFalse(r['spawn_verified'])
        self.assertEqual(r['verification']['status'],'EXISTS_AT_DIFFERENT_POSE')
        self.assertEqual(transport.count('service'),1)

    def test_timeout_after_successful_creation_is_resolved_by_real_entity(self):
        timeout=subprocess.TimeoutExpired(['gz','service'],6,output=b'',stderr=b'timed out')
        r,transport=create([timeout,response(observed())])
        self.assertTrue(r['spawn_verified']);self.assertIsNone(r['returncode'])
        self.assertEqual(r['gazebo_response'],'')
        self.assertEqual(r['attempts'][0]['create']['error'],'TimeoutExpired')
        self.assertEqual(transport.count('service'),1)

    def test_retries_are_bounded_and_require_absence_each_time(self):
        r,transport=create([response('data: false\n'),response(missing())]*3)
        self.assertFalse(r['spawn_verified'])
        self.assertEqual(transport.count('service'),3);self.assertEqual(transport.count('model'),3)

    def test_wrong_world_name_or_entity_id_cannot_establish_existence(self):
        for raw in (observed(world='old_world'),observed(model='wrong_model'),observed(entity_id=0),
                    observed(pose={**POSE,'z':float('nan')}),'EXISTS_AT_EXPECTED_POSE'):
            with self.subTest(raw=raw):
                self.assertEqual(parse_entity_observation(raw,0,'toolbox_2',WORLD,POSE)['status'],'UNKNOWN')

def fixture_payload():
    spec={'seed':123,'person_pose_orientation':{'x':1,'y':2,'yaw':.4},'object_placements':[
        {'id':'fire_extinguisher_1','label':'fire_extinguisher','x':3,'y':4,'yaw':.2},
        {'id':'toolbox_2','label':'toolbox',**POSE},
        {'id':'hazard_marker_3','label':'hazard_marker','x':5,'y':6,'yaw':.7}]}
    rows=[]
    for item in expected_models(spec):
        rows.append({**item,'world_name':WORLD,'requested_pose':item['pose'],'gazebo_response':'data: true\n',
                     'returncode':0,'completed_at':100.,'spawn_verified':True})
    payload={'seed':123,'world_name':WORLD,'recorded_at':101.,'objects_spawned':rows}
    return spec,payload
class ProofTests(unittest.TestCase):
    def test_complete_current_acknowledged_set_passes(self):
        spec,payload=fixture_payload()
        self.assertTrue(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))

    def test_verified_exists_can_pass_without_fabricated_boolean(self):
        spec,payload=fixture_payload();row=payload['objects_spawned'][2]
        row.update(gazebo_response='',verification={'raw_stdout':observed(),'returncode':0,'observed_at':100.})
        self.assertTrue(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))
        self.assertEqual(row['gazebo_response'],'')

    def test_raw_empty_false_or_wrong_pose_cannot_pass_by_claimed_status(self):
        for raw in ('',observed(pose={**POSE,'x':8}),observed(world='another_world')):
            spec,payload=fixture_payload();row=payload['objects_spawned'][2]
            row.update(gazebo_response='',verification={'status':'EXISTS_AT_EXPECTED_POSE','entity_id':791,
                       'actual_pose':POSE,'raw_stdout':raw,'returncode':0,'observed_at':100.})
            self.assertFalse(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))

    def test_wrong_seed_world_set_label_requested_pose_or_time_fails(self):
        mutators=[
            lambda p:p.update(seed=999),
            lambda p:p.update(world_name='old_world'),
            lambda p:p['objects_spawned'].pop(),
            lambda p:p['objects_spawned'].__setitem__(0,copy.deepcopy(p['objects_spawned'][1])),
            lambda p:p['objects_spawned'][0].update(label='toolbox'),
            lambda p:p['objects_spawned'][0].update(requested_pose={**POSE,'x':999}),
            lambda p:p['objects_spawned'][0].update(world_name='old_world'),
            lambda p:p.update(recorded_at=98.),
            lambda p:p['objects_spawned'][0].update(completed_at=98.),
        ]
        for index,mutate in enumerate(mutators):
            with self.subTest(case=index):
                spec,payload=fixture_payload();mutate(payload)
                self.assertFalse(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))

    def test_old_read_only_observation_is_rejected(self):
        spec,payload=fixture_payload();row=payload['objects_spawned'][2]
        row.update(gazebo_response='',verification={'raw_stdout':observed(),'returncode':0,'observed_at':98.})
        self.assertFalse(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))

    def test_boolean_false_is_not_success_even_if_returncode_zero(self):
        spec,payload=fixture_payload();payload['objects_spawned'][0]['gazebo_response']='data: false\n'
        self.assertFalse(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))

    def test_fallback_respects_yaw_and_height_not_only_xy(self):
        for change in ({'yaw':POSE['yaw']+.1},{'z':.1}):
            spec,payload=fixture_payload();row=payload['objects_spawned'][2]
            row.update(gazebo_response='',verification={'raw_stdout':observed(pose={**POSE,**change}),
                       'returncode':0,'observed_at':100.})
            self.assertFalse(validate_spawn_evidence(payload,spec,WORLD,observed_after=99.))

if __name__=='__main__':unittest.main()
