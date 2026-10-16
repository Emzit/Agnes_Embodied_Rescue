"""Render asset regressions; all scratch paths stay inside the project."""
from pathlib import Path
import json,unittest,xml.etree.ElementTree as ET
import math,hashlib,copy,uuid,importlib.util
from unittest.mock import patch
from simulation.visual_assets.scene_style import ROOT,ASSETS,person_links,box_mesh
E=ROOT/'artifacts/realistic-visuals-20261012'
NS={'c':'http://www.collada.org/2005/11/COLLADASchema'}
class AppearanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        loader=importlib.util.spec_from_file_location('map_import',ROOT/'scripts/map-import/map_import.py')
        importer=importlib.util.module_from_spec(loader);loader.loader.exec_module(importer)
        cls.work=ROOT/'artifacts/visual-style-tests'/str(uuid.uuid4())
        cls.before=cls.work/'before';cls.after=cls.work/'after'
        skeleton=json.loads((ROOT/'maps/imported/lotus_demo/lotus_skeleton.json').read_text())
        with patch.object(importer,'apply_world_style',lambda world,out:None):
            baseline=copy.deepcopy(skeleton);baseline['metadata'].pop('visual_style',None)
            importer.compile_map(baseline,cls.before)
        importer.compile_map(skeleton,cls.after)
        cls.old=ET.parse(cls.before/'world.sdf');cls.new=ET.parse(cls.after/'world.sdf')
    def test_collision_geometry_preserved(self):
        def values(tree):
            return [(m.get('name'),ET.tostring(m.find('pose')) if m.find('pose') is not None else None,[ET.tostring(c) for c in m.findall('.//collision')]) for m in tree.findall('.//world/model') if m.findall('.//collision')]
        self.assertEqual(values(self.old),values(self.new))
    def test_map_and_registry_preserved(self):
        old=self.before
        for name in ['map.pgm','map.yaml','world_registry.json','interaction-registry.json']:
            self.assertEqual((old/name).read_bytes(),(self.after/name).read_bytes())
    def test_camera_resolution_only_and_same_rate(self):
        a=copy.deepcopy(self.old.find(".//sensor[@name='camera']"));b=self.new.find(".//sensor[@name='camera']")
        self.assertEqual(b.findtext('update_rate'),'30')
        self.assertEqual((b.findtext('camera/image/width'),b.findtext('camera/image/height')),('640','480'))
        a.find('camera/image/width').text='640';a.find('camera/image/height').text='480'
        self.assertEqual(ET.tostring(a),ET.tostring(b))
    def test_texture_manifest_and_paths(self):
        manifest=json.loads((ASSETS/'manifest.json').read_text());self.assertEqual(manifest['third_party_assets'],[])
        for f in manifest['files']:
            p=ROOT/f['path'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),f['sha256'])
        for p in self.new.findall('.//albedo_map')+self.new.findall('.//normal_map')+self.new.findall('.//roughness_map')+self.new.findall('.//mesh/uri'):
            self.assertTrue(Path(p.text).is_file());self.assertTrue(Path(p.text).is_relative_to(ROOT))
    def test_world_has_metre_uv_meshes_and_pbr(self):
        walls=[m for m in self.new.findall('.//world/model') if m.get('name','').startswith('wall_')]
        self.assertGreater(len(walls),40)
        for m in walls:
            self.assertIsNotNone(m.find('./link/visual/geometry/mesh'))
            self.assertIsNotNone(m.find('./link/visual/material/pbr/metal/normal_map'))
        box_mesh(self.work/'test-box.dae',(6,.1,2.5))
        t=ET.parse(self.work/'test-box.dae');uv=[float(v) for v in t.find(".//c:source[@id='uv']/c:float_array",NS).text.split()]
        self.assertIn(5.,uv) # 6 m / 1.2 m texture tile
    def test_sphere_winding_and_normals(self):
        t=ET.parse(ASSETS/'meshes/sphere.dae')
        values=[float(x) for x in t.find(".//c:source[@id='pos']/c:float_array",NS).text.split()]
        verts=[values[i:i+3] for i in range(0,len(values),3)]
        indices=[int(v) for v in t.find('.//c:triangles/c:p',NS).text.split()]
        for i in range(0,len(indices),9):
            a,b,c=[verts[indices[i+j]] for j in [0,3,6]]
            ab=[b[k]-a[k] for k in range(3)];ac=[c[k]-a[k] for k in range(3)]
            cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
            self.assertGreater(sum(cross[k]*a[k] for k in range(3)),0)
    def test_torso_normals_follow_taper_without_uv_seam(self):
        tree=ET.parse(ASSETS/'meshes/torso.dae')
        values=[float(v) for v in tree.find(".//c:source[@id='norm']/c:float_array",NS).text.split()]
        normals=[values[i:i+3] for i in range(0,len(values),3)]
        for normal in normals:
            self.assertAlmostEqual(sum(v*v for v in normal),1,places=5)
        for ring in range(6):
            self.assertEqual(normals[ring*33],normals[ring*33+32])
        # At the shoulder-to-neck taper the surface faces upward, not only out.
        self.assertGreater(normals[5*33+8][2],.8)
        self.assertGreater(normals[5*33][2],.3)
    def test_person_complete_geometry_and_no_collision_change(self):
        p=ET.fromstring(person_links());self.assertFalse(p.findall('collision'))
        names={v.get('name') for v in p.findall('visual')}
        for n in ['head','neck','jacket','pelvis','left_shin','right_thigh','left_hand','right_shoe','nose','left_iris']:self.assertIn(n,names)
        self.assertGreater(len(names),30)
        for v in p.findall('visual'):self.assertIsNotNone(v.find('material/pbr/metal'))
    def test_fire_is_opt_in_visual_only_and_bounded(self):
        self.assertFalse(self.old.findall('.//particle_emitter'))
        effects=[m for m in self.new.findall('.//world/model') if m.get('name','').startswith('rescue_fire_')]
        self.assertEqual(len(effects),3)
        self.assertFalse([c for m in effects for c in m.findall('.//collision')])
        particles=self.new.findall('.//particle_emitter')
        self.assertEqual(len(particles),12)
        self.assertTrue(all(e.findtext('particle_scatter_ratio')=='0' for e in particles))
        self.assertLess(sum(float(e.findtext('rate'))*float(e.findtext('lifetime')) for e in particles),300)
        manifest=json.loads((ASSETS/'fire_manifest.json').read_text())
        self.assertEqual(manifest['third_party_assets'],[])
        for f in manifest['files']:
            self.assertEqual(hashlib.sha256((ROOT/f['path']).read_bytes()).hexdigest(),f['sha256'])
        for e in particles:
            for t in ['color_range_image','material/pbr/metal/albedo_map']:
                self.assertTrue(Path(e.findtext(t)).is_file())
    def test_lighting_shadows_enabled(self):
        self.assertEqual(self.new.findtext('.//world/scene/shadows'),'true')
        self.assertEqual(self.new.findtext(".//light[@name='sun']/cast_shadows"),'true')
if __name__=='__main__':unittest.main()
