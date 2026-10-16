"""Offline safety tests for optional office visual modulation.

No Gazebo node, publisher, service or scene process is started. All fixtures
remain under this project's artifacts directory.
"""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from simulation.final_rescue import office_fire_dynamics as dynamics

ROOT=Path('/data-ssd/zhongchengkai/agnes')
FIXTURES=ROOT/'artifacts/office-realism-v3-20261012/runtime-tests'
WORLD="""<sdf version="1.9"><world name="fixture_office_world">
<light name="office_fire_test_light" type="point"/>
<model name="office_fire_test_source"><link name="effects">
<particle_emitter name="flame" type="box">
<topic>/office_fire/test/flame</topic><rate>20</rate>
<min_velocity>0.1</min_velocity><max_velocity>0.5</max_velocity>
<particle_size>0.4 0.6 0.2</particle_size>
</particle_emitter></link></model></world></sdf>"""

def config():
    return {
        'world_name':'stale_world_name',
        'lights':[{'name':'office_fire_test_light','color':[1,.5,.1],
                   'position':[1,2,2.5],'range':5}],
        'emitters':[{'model':'office_fire_test_source','link':'effects',
                     'emitter':'flame','topic':'/office_fire/test/flame',
                     'rate':20,'min_velocity':.1,'max_velocity':.5,
                     'particle_size':[.4,.6,.2]}],
    }

class OfficeVisualConfigTests(unittest.TestCase):
    def setUp(self):
        FIXTURES.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='config-',dir=FIXTURES)
        self.directory=Path(self.temp.name)
        self.world=self.directory/'world.sdf'
        self.world.write_text(WORLD)
        self.config_path=self.directory/'office-fire-runtime-config.json'
        self.write(config())

    def tearDown(self):
        self.temp.cleanup()

    def write(self,value):
        self.config_path.write_text(json.dumps(value))

    def test_valid_exact_static_envelope_uses_selected_world(self):
        result=dynamics.load_config(self.world)
        self.assertEqual(result['world_name'],'fixture_office_world')
        self.assertEqual(result['emitters'][0]['particle_size'],[.4,.6,.2])
        self.assertEqual(result['emitters'][0]['max_velocity'],.5)

    def test_absent_optional_config_starts_no_visual_thread(self):
        self.config_path.unlink()
        with patch.object(dynamics.threading,'Thread') as thread:
            instance=dynamics.OfficeFireDynamics(self.world)
        self.assertIsNone(instance.config)
        self.assertIsNone(instance.thread)
        thread.assert_not_called()
        instance.close()

    def test_size_requires_exactly_three_dimensions(self):
        for size in ([],[.1,.2],[.1,.2,.1,.2],None,'0.1 0.2 0.1'):
            with self.subTest(size=size):
                value=config();value['emitters'][0]['particle_size']=size;self.write(value)
                with self.assertRaisesRegex(ValueError,'INVALID_OFFICE_PARTICLE_SIZE'):
                    dynamics.load_config(self.world)

    def test_each_size_dimension_must_be_finite_and_nonnegative(self):
        for axis in range(3):
            for invalid in (-.01,math.nan,math.inf,-math.inf,None,'bad'):
                with self.subTest(axis=axis,invalid=invalid):
                    value=config();value['emitters'][0]['particle_size'][axis]=invalid;self.write(value)
                    with self.assertRaisesRegex(ValueError,'INVALID_OFFICE_PARTICLE_SIZE'):
                        dynamics.load_config(self.world)

    def test_each_size_dimension_cannot_exceed_sdf(self):
        for axis in range(3):
            with self.subTest(axis=axis):
                value=config();value['emitters'][0]['particle_size'][axis]+=.00002;self.write(value)
                with self.assertRaisesRegex(ValueError,'EXCEEDS_STATIC_BUDGET'):
                    dynamics.load_config(self.world)

    def test_zero_sizes_and_normalized_numeric_values_are_safe(self):
        value=config()
        value['emitters'][0].update(rate='0',min_velocity='0',max_velocity='.2',
                                   particle_size=[0,'0',0])
        self.write(value)
        emitter=dynamics.load_config(self.world)['emitters'][0]
        self.assertEqual(emitter['particle_size'],[0.,0.,0.])
        self.assertTrue(all(isinstance(emitter[k],float) for k in ('rate','min_velocity','max_velocity')))

    def test_minimum_velocity_cannot_exceed_maximum(self):
        value=config();value['emitters'][0].update(min_velocity=.3,max_velocity=.2);self.write(value)
        with self.assertRaisesRegex(ValueError,'INVALID_OFFICE_EMITTER_VELOCITY_RANGE'):
            dynamics.load_config(self.world)

    def test_rate_and_velocity_static_caps_and_finite_values(self):
        for key,value,error in (
            ('rate',20.00002,'EXCEEDS_STATIC_BUDGET'),
            ('max_velocity',.50002,'EXCEEDS_STATIC_BUDGET'),
            ('rate',-1,'INVALID_OFFICE_EMITTER_LIMIT'),
            ('min_velocity',math.inf,'INVALID_OFFICE_EMITTER_LIMIT'),
            ('max_velocity',math.nan,'INVALID_OFFICE_EMITTER_LIMIT'),
        ):
            with self.subTest(key=key,value=value):
                candidate=config();candidate['emitters'][0][key]=value;self.write(candidate)
                with self.assertRaisesRegex(ValueError,error):
                    dynamics.load_config(self.world)

    def test_invalid_sdf_size_cannot_supply_budget(self):
        for size in ('0.4 0.6','0.4 nan 0.2','0.4 -0.1 0.2'):
            with self.subTest(size=size):
                self.world.write_text(WORLD.replace('0.4 0.6 0.2',size))
                with self.assertRaisesRegex(ValueError,'INVALID_OFFICE_STATIC_EMITTER_LIMIT'):
                    dynamics.load_config(self.world)

    def test_malformed_config_cannot_terminate_host_or_start_transport(self):
        for malformed in ('{broken json',json.dumps({'emitters':[{'model':'absent'}]})):
            with self.subTest(malformed=malformed):
                self.config_path.write_text(malformed)
                with patch.object(dynamics.threading,'Thread') as thread:
                    instance=dynamics.OfficeFireDynamics(self.world)
                thread.assert_not_called()
                self.assertIsNone(instance.thread)
                self.assertEqual(instance.state['status'],'VISUAL_MODULATION_FAILED')
                written=json.loads(self.world.with_name('office-fire-runtime.json').read_text())
                self.assertEqual(written['status'],'VISUAL_MODULATION_FAILED')
                instance.close()

    def test_config_failure_with_unwritable_status_still_cannot_escape_constructor(self):
        self.config_path.write_text('{broken json')
        with patch.object(Path,'write_text',side_effect=PermissionError('fixture read-only')):
            instance=dynamics.OfficeFireDynamics(self.world)
        self.assertEqual(instance.state['status'],'VISUAL_MODULATION_FAILED')
        self.assertEqual(instance.state['status_write_error'],'PermissionError')
        self.assertIsNone(instance.thread)
        instance.close()

    def test_status_replace_failure_does_not_escape_or_erase_render_state(self):
        self.config_path.unlink()
        instance=dynamics.OfficeFireDynamics(self.world)
        instance.state['status']='RUNNING'
        with patch.object(Path,'replace',side_effect=OSError('fixture disk error')):
            instance.save()
        self.assertEqual(instance.state['status'],'RUNNING')
        self.assertEqual(instance.state['status_write_error'],'OSError')
        instance.close()

    def test_external_sim_clock_is_atomic_finite_and_supports_world_reset(self):
        self.config_path.unlink()
        instance=dynamics.OfficeFireDynamics(self.world)
        self.assertIsNone(instance.clock['time'])
        with patch.object(dynamics.time,'monotonic',return_value=10.):
            instance.update_clock(42.5)
        self.assertEqual(instance.clock,{'time':42.5,'seen':10.})
        for bad in (float('nan'),float('inf'),-float('inf')):
            instance.update_clock(bad)
            self.assertEqual(instance.clock,{'time':42.5,'seen':10.})
        with patch.object(dynamics.time,'monotonic',return_value=11.):
            instance.update_clock(.1)
        self.assertEqual(instance.clock,{'time':.1,'seen':11.})
        instance.close()

    def test_pulse_is_continuous_varied_and_within_declared_envelope(self):
        values=[]
        for phase in (-9,-1,0,.7,2,8,20):
            phase_values=[dynamics.pulse(index*.037,phase) for index in range(-3000,3001)]
            self.assertGreater(max(phase_values)-min(phase_values),.2)
            self.assertTrue(all(.64-1e-12<=value<=1+1e-12 for value in phase_values))
            self.assertLess(abs(dynamics.pulse(1,phase)-dynamics.pulse(1+1e-6,phase)),1e-5)
            values.append(dynamics.pulse(.3,phase))
        self.assertGreater(len(set(values)),1)

if __name__=='__main__':
    unittest.main()
