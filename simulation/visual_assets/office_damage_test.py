"""Material/geometry safety regression for project-authored office damage."""
import copy, hashlib, importlib.util, json, math, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np
from simulation.visual_assets.office_damage import apply_office_damage, BURN_ZONES, box_faces
from simulation.visual_assets.office_damage_generate import fields, read_png

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"artifacts/office-damage-20261013"
class DamageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUT.mkdir(parents=True,exist_ok=True)
        # Build an undamaged fixture; the live map may already have baked
        # damage and must never be an input to a repeatable regression test.
        cls.out=Path(tempfile.mkdtemp(prefix="test-",dir=OUT))
        spec=importlib.util.spec_from_file_location("damage_test_importer",ROOT/"scripts/map-import/map_import.py")
        importer=importlib.util.module_from_spec(spec);spec.loader.exec_module(importer)
        skeleton=json.loads((ROOT/"maps/imported/office_fire/office_skeleton.json").read_text())
        with patch("simulation.visual_assets.office_damage.apply_office_damage",return_value={}):
            importer.compile_map(skeleton,cls.out/"undamaged")
        cls.world=ET.parse(cls.out/"undamaged/world.sdf").getroot().find("world")
        cls.before=copy.deepcopy(cls.world)
        cls.result=apply_office_damage(cls.world,cls.out)
        cls.spec=json.loads((cls.out/"office-damage-surfaces.json").read_text())
        cls.assets=json.loads((cls.out/"office-damage-assets/manifest.json").read_text())
    def test_physics_and_all_doors_unchanged(self):
        before=[ET.tostring(c) for c in self.before.findall(".//collision")]
        self.assertEqual(before,[ET.tostring(c) for c in self.world.findall(".//collision")])
        for old in self.before.findall("model"):
            if old.get("name","").startswith("door_"):
                self.assertEqual(ET.tostring(old),ET.tostring(self.world.find("model[@name='"+old.get("name")+"']")))
        self.assertEqual(self.result["new_collision_count"],0)
    def test_existing_visuals_keep_one_mesh_and_only_two_sagging_sheets_added(self):
        self.assertEqual(len(self.world.findall(".//visual")),len(self.before.findall(".//visual"))+2)
        details=self.world.find("model[@name='office_damage_details']")
        self.assertEqual(len(details.findall(".//visual")),2)
        self.assertFalse(details.findall(".//collision"))
        for v in details.findall(".//visual"):
            self.assertGreater(float(v.findtext("pose").split()[2]),2.70)
    def test_visible_workstation_six_matches_flame_positions(self):
        affected=self.result["affected_original_visuals"]
        self.assertTrue(any(s.startswith("office_workstation_6/white_desk") for s in affected))
        self.assertFalse(any("office_workstation_4" in s for s in affected))
        self.assertFalse(any("drawer_cabinet" in s for s in affected))
        zone=next(z for z in BURN_ZONES if z["name"]=="workstation_6_desk")
        self.assertEqual(zone["center"],[-4.55,.67,.79])
    def test_material_budget_and_bounded_uv(self):
        self.assertLess(self.result["estimated_rgba_gpu_bytes"]*4/3,64*1024*1024)
        self.assertLess(self.result["atlas_count"],20)
        for atlas in self.spec["atlases"]:
            self.assertLessEqual(max(atlas["size"]),1024)
        ns={"c":"http://www.collada.org/2005/11/COLLADASchema"}
        for p in (self.out/"office-damage-meshes").glob("*.dae"):
            root=ET.parse(p).getroot()
            tex=[n for n in root.findall(".//c:source",ns) if "tex" in n.get("id","").lower() or "uv" in n.get("id","").lower()]
            for n in tex:
                values=list(map(float,n.find("c:float_array",ns).text.split()))
                self.assertTrue(all(0<=v<=1 for v in values))
    def test_world_coordinate_heat_and_facing_not_tiled_scorch(self):
        x=np.array([[-1.8,-4.8]]);y=np.array([[3.725,3.725]]);z=np.array([[1.55,1.55]])
        heat,soot,_=fields([x,y,z],[0,-1,0],"plaster",BURN_ZONES)
        self.assertGreater(heat[0,0],.7)
        self.assertLess(heat[0,1],.02)
        back,_,_=fields([x,y,z],[0,1,0],"plaster",BURN_ZONES)
        self.assertLess(back.max(),.001)
    def test_assets_are_opaque_rgb_nonblack_with_recorded_hashes(self):
        self.assertEqual(len(self.assets["files"]),self.result["atlas_count"]*3)
        for record in self.assets["files"]:
            path=Path(record["path"])
            self.assertTrue(path.resolve().is_relative_to(ROOT))
            data=path.read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(),record["sha256"])
            self.assertEqual(data[25],2) # RGB, never alpha cutouts
            pixels=read_png(path)
            self.assertTrue(np.isfinite(pixels).all())
            if path.name.endswith("_albedo.png"):
                self.assertGreater(pixels.mean(),.055)
                self.assertGreaterEqual(pixels.min(),.015)
    def test_no_damage_decals_or_missing_roof(self):
        self.assertEqual(self.result["black_overlay_planes"],0)
        ceiling=self.world.find("model[@name='office_ceiling']")
        self.assertIsNotNone(ceiling.find(".//collision/geometry/box"))
        for model in self.world.findall("model"):
            if model.get("name","").startswith("office_damage"):
                self.assertFalse(model.findall(".//transparency"))
                self.assertFalse(model.findall(".//particle_emitter"))
if __name__=="__main__":unittest.main()
