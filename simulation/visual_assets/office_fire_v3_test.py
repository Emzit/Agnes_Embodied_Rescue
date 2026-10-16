"""Meaningful bounds, physical invariants and provenance checks for office fire."""
import copy,hashlib,json,math,struct,unittest,uuid,zlib
from pathlib import Path
import xml.etree.ElementTree as ET
from simulation.visual_assets.office_fire_v3 import ROOT,ASSETS,apply_fire_effects

class OfficeFireV3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out=ROOT/"artifacts/fire-v3-20261013/effects-tests"/str(uuid.uuid4())
        cls.world=ET.fromstring('<world name="fire"><model name="office_workstation_6"><pose>-4.4 .7 0 0 0 0</pose><link name="structure"><visual name="drawer_cabinet"><geometry><box><size>.35 .55 .63</size></box></geometry></visual><collision name="drawer_cabinet_collision"><pose>.52 .01 .32 0 0 0</pose><geometry><box><size>.35 .55 .63</size></box></geometry></collision></link></model><model name="door_sample"><link name="panel"><collision name="panel"><geometry><box><size>1.17 .065 2.15</size></box></geometry></collision></link><joint type="revolute" name="hinge"><parent>frame</parent><child>panel</child></joint></model></world>')
        cls.before=copy.deepcopy(cls.world)
        cls.meta=apply_fire_effects(cls.world,cls.out)
    def test_collisions_and_door_joint_are_preserved(self):
        for m in self.before.findall("model"):
            updated=self.world.find("model[@name='"+m.get("name")+"']")
            for tag in ("collision","joint"):
                self.assertEqual([ET.tostring(e) for e in m.findall(".//"+tag)],[ET.tostring(e) for e in updated.findall(".//"+tag)])
        self.assertEqual(len(self.world.findall(".//collision")),2)
        for model in self.world.findall("model"):
            if model.get("name","").startswith("office_fire_"):self.assertFalse(model.findall(".//collision"))
    def test_visible_fuel_uses_existing_furniture_volume(self):
        self.assertIsNone(self.world.find("model[@name='office_workstation_6']/link/visual[@name='drawer_cabinet']"))
        cabinet=self.world.find("model[@name='office_fire_cabinet_papers']")
        self.assertGreater(len(cabinet.findall(".//visual")),10)
        for visual in cabinet.findall(".//visual"):
            pose=list(map(float,visual.findtext("pose").split()))
            size=list(map(float,visual.findtext("geometry/box/size").split()))
            # Existing occupied desk footprint, including the rotated sheets.
            roll,pitch,yaw=pose[3:]
            cr,sr,cp,sp,cy,sy=math.cos(roll),math.sin(roll),math.cos(pitch),math.sin(pitch),math.cos(yaw),math.sin(yaw)
            rows=((cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr),(sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr))
            extent=[sum(abs(row[i])*size[i]/2 for i in range(3)) for row in rows]
            self.assertGreater(pose[0]-extent[0],-5.30)
            self.assertLess(pose[0]+extent[0],-3.50)
            self.assertGreater(pose[1]-extent[1],-.42)
            self.assertLess(pose[1]+extent[1],1.13)
        self.assertTrue(any("paper" in v.get("name","") for v in cabinet.findall(".//visual")))
        self.assertEqual(self.meta["scorch_overlay_meshes"],0)
        self.assertEqual(self.meta["ground_fire_piles"],0)
    def test_full_lifetime_envelopes_and_smoke_layer(self):
        for row in self.meta["emitters"]:
            pitch=row["pitch"];xyz=row["position"];spread=row["spread"]
            nozzle=(abs(math.sin(pitch))*spread[0]+abs(math.cos(pitch))*spread[2])/2
            vertical=-math.sin(pitch)*row["max_velocity"]*row["lifetime"]
            half=row["particle_size"][1]/2+row["growth"]*row["lifetime"]
            top=xyz[2]+nozzle+max(0,vertical)+half
            low=xyz[2]-nozzle+min(0,vertical)-half
            self.assertLess(top,2.8,(row["emitter"],top))
            if row["emitter"] in ("upper_smoke","lower_wisp"):
                self.assertGreaterEqual(low,2.15,(row["model"],low))
                self.assertLessEqual(top,2.65,(row["model"],top))
            if row["emitter"] in ("rollover","curl","upper_smoke","lower_wisp"):
                self.assertAlmostEqual(math.sin(pitch),0)
    def test_fire_birth_is_attached_to_visible_fuel(self):
        rows={e["emitter"]:e for e in self.meta["emitters"]}
        for name,fuel_surface in [("desk_front",.7425),("desk_side",.7425),("paper_tongue_0",.99)]:
            e=rows[name]
            sprite_bottom=e["position"][2]-e["particle_size"][1]/2
            self.assertLess(abs(sprite_bottom-fuel_surface),.09,(name,sprite_bottom))
        self.assertAlmostEqual(rows["chair_back"]["position"][1],-.235)
        self.assertTrue(all(z["model"]!="office_workstation_4" for z in self.meta["burn_zones"] if "model" in z))

    def test_dynamic_controls_do_not_increase_static_budget(self):
        self.assertLessEqual(self.meta["max_live_particle_budget"],550)
        self.assertLessEqual(len(self.meta["dynamic_emitters"]),20)
        self.assertEqual(len(self.meta["lights"]),5)
        self.assertFalse(self.world.findall("light"))
        for row in self.meta["dynamic_emitters"]:
            self.assertEqual(row["rate_max_factor"],1)
            self.assertEqual(row["particle_size_mode"],"static")
        for e in self.world.findall(".//particle_emitter"):
            self.assertEqual(e.findtext("particle_scatter_ratio"),"0")
            self.assertTrue(e.findtext("topic").startswith("/office_fire/"))
    def test_assets_are_real_alpha_pngs_with_provenance(self):
        metadata=json.loads((ASSETS.parent/"office_fire_v3_manifest.json").read_text())
        self.assertEqual(metadata["third_party_assets"],[])
        self.assertEqual(metadata["models_called"],[])
        for entry in metadata["files"]:
            data=(ROOT/entry["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(),entry["sha256"])
            self.assertEqual(data[:8],bytes([137,80,78,71,13,10,26,10]))
            pos=8;packed=b"";width=height=None
            while pos<len(data):
                length=struct.unpack(">I",data[pos:pos+4])[0];tag=data[pos+4:pos+8];payload=data[pos+8:pos+8+length]
                self.assertEqual(zlib.crc32(tag+payload)&0xffffffff,struct.unpack(">I",data[pos+8+length:pos+12+length])[0])
                if tag==b"IHDR":
                    width,height,depth,kind,*_=struct.unpack(">IIBBBBB",payload)
                    self.assertEqual((depth,kind),(8,6))
                elif tag==b"IDAT":packed+=payload
                pos+=length+12
            raw=zlib.decompress(packed);stride=1+width*4
            self.assertEqual(len(raw),height*stride)
            if height>1:
                for y in (0,height-1):
                    self.assertTrue(all(raw[y*stride+1+x*4+3]==0 for x in range(width)))
                if Path(entry["path"]).name.startswith(("flame_","ceiling_roll_")):
                    bright_body=0;soft_edge=0
                    for y in range(height):
                        for x in range(width):
                            pixel=raw[y*stride+1+x*4:y*stride+1+x*4+4]
                            if min(x,y,width-1-x,height-1-y)<7:
                                self.assertEqual(pixel,bytes(4),"transparent color guard")
                            if pixel[3]==0:
                                self.assertEqual(pixel[:3],bytes(3),"no luminous RGB outside silhouette")
                            if pixel[3]>140:bright_body+=1
                            if 10<pixel[3]<110:soft_edge+=1
                    self.assertGreater(bright_body,width*height*(.005 if Path(entry["path"]).name.startswith("ceiling_roll_") else .02),"keep visibly burning core")
                    self.assertGreater(soft_edge,width*height*.025,"broad feather instead of cut edge")
    def test_texture_references_and_idempotent_rebuild(self):
        for tag in ("albedo_map","color_range_image"):
            for e in self.world.findall(".//"+tag):
                self.assertTrue(Path(e.text).is_file(),e.text)
                if Path(e.text).name.startswith("ceiling_roll_"):
                    self.assertEqual(Path(e.text).parent,ASSETS)
        before=len(self.world.findall(".//particle_emitter"))
        apply_fire_effects(self.world,self.out)
        self.assertEqual(len(self.world.findall(".//particle_emitter")),before)
        self.assertEqual(len([m for m in self.world.findall("model") if m.get("name")=="office_fire_cabinet_papers"]),1)

if __name__=="__main__":unittest.main()
