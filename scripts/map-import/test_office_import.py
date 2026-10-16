"""Indoor reference-map regression checks; scratch output stays in the workspace."""
import copy, importlib.util, json, math, unittest, uuid
from pathlib import Path
import xml.etree.ElementTree as ET
ROOT=Path('/data-ssd/zhongchengkai/agnes')
spec=importlib.util.spec_from_file_location('office_importer',ROOT/'scripts/map-import/map_import.py')
imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
class OfficeImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=json.loads((ROOT/'maps/imported/office_fire/office_skeleton.json').read_text())
        cls.out=ROOT/'artifacts/indoor-fire-20261012/tests'/str(uuid.uuid4())
        imp.compile_map(cls.s,cls.out)
        cls.world=ET.parse(cls.out/'world.sdf').getroot().find('world')
    def test_reference_topology_and_spawn(self):
        s=self.s
        self.assertTrue(imp.validate(s)['pass'],imp.validate(s))
        self.assertEqual(len(s['rooms']),4);self.assertEqual(len(s['doors']),4)
        self.assertEqual(s['boundary'],dict(min_x=-9,max_x=9,min_y=-8,max_y=8))
        st=s['start_poses'][0]
        self.assertEqual((st['x'],st['y']),(0,-6.7));self.assertAlmostEqual(st['yaw'],math.pi/2)
        self.assertEqual(s['metadata']['visual_style'],'office_fire')
    def test_doors_have_physical_leaves_and_edge_hinges(self):
        for d in self.s['doors']:
            model=self.world.find("./model[@name='door_"+d['id']+"']")
            self.assertIsNotNone(model)
            self.assertIsNotNone(model.find("./link[@name='panel']/collision"))
            joint=model.find("./joint[@type='revolute']")
            self.assertIsNotNone(joint.find('pose'))
            self.assertGreater(abs(float(joint.findtext('pose').split()[0])),.5)
            self.assertEqual(float(joint.findtext('axis/limit/lower')),0)
            self.assertGreaterEqual(float(joint.findtext('axis/limit/upper')),1.55)
    def test_furniture_prior_matches_authored_footprints(self):
        from simulation.visual_assets.office_scene import OFFICE_OBSTACLES
        self.assertEqual(self.s['static_obstacles'],OFFICE_OBSTACLES)
        raw=(self.out/'map.pgm').read_bytes()
        header,pixels=raw.split(b'\n255\n',1)
        width,height=map(int,header.splitlines()[1].split())
        def occupied(x,y):
            res=self.s['optional_navigation_constraints']['resolution']
            i=math.floor((x+9)/res);j=height-1-math.floor((y+8)/res)
            return pixels[j*width+i]==0
        for o in self.s['static_obstacles']:
            b=o['bounds'];self.assertTrue(occupied((b['min_x']+b['max_x'])/2,(b['min_y']+b['max_y'])/2))
        self.assertFalse(occupied(0,-6.7));self.assertFalse(occupied(0,0))
        for d in self.s['doors']:
            self.assertFalse(occupied(*d['at'])) # door state is sensed, not baked closed
    def test_malformed_furniture_is_rejected(self):
        for bounds in [dict(min_x=10,max_x=11,min_y=0,max_y=1),dict(min_x=0,max_x=0,min_y=0,max_y=1)]:
            bad=copy.deepcopy(self.s);bad['static_obstacles'][0]['bounds']=bounds
            self.assertFalse(imp.validate(bad)['pass'])
    def test_real_sensor_and_fire_particle_budget(self):
        camera=self.world.find(".//sensor[@name='camera']")
        self.assertEqual(camera.findtext('update_rate'),'30')
        self.assertEqual(camera.findtext('camera/image/width'),'640')
        particles=self.world.findall('.//particle_emitter');self.assertGreater(len(particles),0)
        self.assertLessEqual(sum(float(p.findtext('rate'))*float(p.findtext('lifetime')) for p in particles),550)
        self.assertTrue(all(p.findtext('particle_scatter_ratio')=='0' for p in particles))
    def test_all_render_assets_exist_in_workspace(self):
        for tag in ['.//mesh/uri','.//albedo_map','.//normal_map','.//roughness_map','.//emissive_map','.//color_range_image']:
            for e in self.world.findall(tag):
                p=Path(e.text);self.assertTrue(p.is_file(),e.text);self.assertTrue(p.resolve().is_relative_to(ROOT))
if __name__=='__main__':unittest.main()
