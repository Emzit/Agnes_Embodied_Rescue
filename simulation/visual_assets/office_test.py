"""Office rendering, geometry/occupancy and bounded smoke/fire regressions."""
import copy,hashlib,json,math,struct,unittest,uuid,zlib
from pathlib import Path
import xml.etree.ElementTree as ET
from simulation.visual_assets.office_scene import ROOT,ASSETS,OFFICE_OBSTACLES,apply_office_style
from simulation.visual_assets.door_geometry import door_elements
class OfficeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out=ROOT/'artifacts/indoor-fire-20261012/office-tests'/str(uuid.uuid4())
        cls.world=ET.fromstring('<world name="office"><scene/><light type="directional" name="sun"/><model name="ground"><link name="body"><collision name="floor"><geometry><plane><normal>0 0 1</normal><size>100 100</size></plane></geometry></collision><visual name="floor"><geometry><box><size>18 16 .1</size></box></geometry></visual></link></model><model name="wall_1"><pose>0 3.8 1.4 0 0 0</pose><link name="body"><collision name="wall"><geometry><box><size>18 .18 2.8</size></box></geometry></collision><visual name="wall"><geometry><box><size>18 .18 2.8</size></box></geometry></visual></link></model></world>')
        for e in door_elements({'id':'test_door','at':[4.5,-1.75],'width':1.25,'height':2.2,'orientation':math.pi/2}):cls.world.append(e)
        cls.before=copy.deepcopy(cls.world)
        cls.skeleton={'boundary':{'min_x':-9,'max_x':9,'min_y':-8,'max_y':8},'static_obstacles':copy.deepcopy(OFFICE_OBSTACLES),'doors':[{'id':f'door_{i}','at':[4.5,-5+i*3],'width':1.25,'height':2.15,'orientation':math.pi/2} for i in range(4)]}
        cls.metadata=apply_office_style(cls.world,cls.out,cls.skeleton)
        cls.effects=json.loads((cls.out/'office-fire-effects.json').read_text())
        cls.runtime=json.loads((cls.out/'office-fire-runtime-config.json').read_text())
    def test_all_door_lintels_close_gap_below_ceiling(self):
        lintels=[m for m in self.world.findall('model') if m.get('name','').startswith('office_lintel_')]
        self.assertEqual(len(lintels),4)
        for door in self.skeleton['doors']:
            m=self.world.find(f"model[@name='office_lintel_{door['id']}']")
            pose=list(map(float,m.findtext('pose').split()))
            size=list(map(float,m.findtext('link/collision/geometry/box/size').split()))
            self.assertGreaterEqual(pose[2]-size[2]/2,2.15)
            self.assertAlmostEqual(pose[2]-size[2]/2,2.18)
            self.assertAlmostEqual(pose[2]+size[2]/2,2.8)
            self.assertEqual(size[:2],[1.25,.15])
            self.assertEqual(pose[:2],door['at'])
            self.assertAlmostEqual(pose[5],door['orientation'])
            self.assertIn('plaster',m.findtext('link/visual/material/pbr/metal/albedo_map'))
    def test_existing_collisions_and_hinges_preserved(self):
        for old in self.before.findall('model'):
            new=self.world.find(f"model[@name='{old.get('name')}']")
            self.assertEqual([ET.tostring(c) for c in old.findall('.//collision')],[ET.tostring(c) for c in new.findall('.//collision')])
            self.assertEqual([ET.tostring(c) for c in old.findall('.//joint')],[ET.tostring(c) for c in new.findall('.//joint')])
            self.assertEqual([ET.tostring(c) for c in old.findall('.//link/pose')],[ET.tostring(c) for c in new.findall('.//link/pose')])
        self.assertEqual([ET.tostring(j) for j in self.before.findall('joint')],[ET.tostring(j) for j in self.world.findall('joint')])
    def test_enclosed_ceiling_and_indoor_finishes(self):
        c=self.world.find("model[@name='office_ceiling']")
        self.assertEqual(float(c.findtext('pose').split()[2]),2.84)
        self.assertEqual(float(c.findtext('link/collision/geometry/box/size').split()[2]),.08)
        self.assertAlmostEqual(2.84-.08/2,2.8)
        self.assertIn('carpet',self.world.findtext("model[@name='ground']/link/visual/material/pbr/metal/albedo_map"))
        wall=self.world.find("model[@name='wall_1']/link/visual")
        self.assertIsNotNone(wall.find('geometry/mesh'))
        self.assertEqual(Path(wall.findtext('material/pbr/metal/albedo_map')).parent.name,'office-damage-assets')
        baked=json.loads((self.out/'office-damage-surfaces.json').read_text())
        self.assertTrue(any(s['model']=='wall_1' and s['kind']=='plaster' for s in baked['surfaces']))
        self.assertEqual(self.metadata['damage']['black_overlay_planes'],0)
        self.assertEqual(self.metadata['damage']['new_collision_count'],0)
        self.assertIsNone(self.world.find("light[@name='sun']"))
    def test_volume_fire_fuel_and_lights_stay_within_render_budget(self):
        ps=self.world.findall('.//particle_emitter')
        self.assertEqual(len(ps),self.effects['particle_emitters'])
        self.assertEqual(len(ps),20)
        budget=sum(float(p.findtext('rate'))*float(p.findtext('lifetime')) for p in ps)
        self.assertLessEqual(budget,550)
        self.assertAlmostEqual(budget,self.effects['max_live_particle_budget'],places=2)
        lights=self.world.findall("light[@type='point']")
        self.assertEqual(len(lights),self.metadata['point_lights'])
        self.assertLessEqual(len(lights),7)
        shadow_lights=[l for l in self.world.findall('light') if l.findtext('cast_shadows')=='true']
        self.assertEqual(len(shadow_lights),1)
        self.assertEqual(shadow_lights[0].get('type'),'spot')
        self.assertTrue(all(p.findtext('particle_scatter_ratio')=='0' for p in ps))
        self.assertTrue(all(l.findtext('cast_shadows')=='false' for l in lights))
        fuel_names=set(self.effects['fuel_models'])
        for m in self.world.findall('model'):
            if not m.get('name','').startswith('office_fire_'):continue
            self.assertFalse(m.findall('.//collision'))
            # Actual fuel geometry is allowed; old burn-hole mesh overlays are not.
            visuals=m.findall('.//visual')
            if visuals:
                self.assertIn(m.get('name'),fuel_names)
                self.assertTrue(all(v.find('geometry/box') is not None for v in visuals))
            self.assertFalse(any(v.get('name','') in ('burnt_wall','burnt_ceiling') for v in visuals))
            for e in m.findall('.//particle_emitter'):
                self.assertGreater(float(e.findtext('pose').split()[2]),.4)
                self.assertNotIn('soot.png',e.findtext('material/pbr/metal/albedo_map'))
        self.assertEqual(self.metadata['scorch_overlay_meshes'],0)
        self.assertEqual(self.metadata['ground_fire_piles'],0)
        self.assertEqual(self.metadata['realism_version'],4)
        self.assertEqual(self.effects['flame_billboards'],0)
        self.assertEqual(len(self.effects['volumes']),6)
        self.assertIsNone(self.world.find("model[@name='office_workstation_6']/link/visual[@name='drawer_cabinet']"))
        self.assertIsNotNone(self.world.find("model[@name='office_workstation_6']/link/collision[@name='drawer_cabinet_collision']"))

    def test_dynamic_config_controls_real_existing_emitters_with_bounded_values(self):
        self.assertEqual(len(self.runtime['lights']),self.metadata['dynamic_light_count'])
        self.assertEqual(len(self.runtime['emitters']),self.metadata['dynamic_emitter_count'])
        self.assertEqual(self.runtime['emitters'],[])
        for config in self.runtime['emitters']:
            e=self.world.find("model[@name='"+config['model']+"']/link[@name='"+config['link']+"']/particle_emitter[@name='"+config['emitter']+"']")
            self.assertIsNotNone(e)
            self.assertEqual(e.findtext('topic'),config['topic'])
            self.assertAlmostEqual(float(e.findtext('rate')),config['rate'])
            self.assertEqual(config['rate_max_factor'],1)
            self.assertEqual(config['particle_size_mode'],'static')
            self.assertEqual(list(map(float,e.findtext('particle_size').split())),config['particle_size'])
        for config in self.runtime['lights']:
            l=self.world.find("light[@name='"+config['name']+"']")
            self.assertIsNotNone(l)
            self.assertEqual(l.findtext('cast_shadows'),'false')

    def test_flame_motion_and_layered_smoke_full_lifetime_stay_below_roof(self):
        for e in self.world.findall('.//particle_emitter'):
            pose=list(map(float,e.findtext('pose').split()))
            pitch=pose[4]
            size=list(map(float,e.findtext('particle_size').split()))
            nozzle=list(map(float,e.findtext('size').split()))
            life=float(e.findtext('lifetime'))
            up=-math.sin(pitch)
            nozzle_half=(abs(math.sin(pitch))*nozzle[0]+abs(math.cos(pitch))*nozzle[2])/2
            growth=float(e.findtext('scale_rate'))*life
            top=pose[2]+nozzle_half+max(up,0)*float(e.findtext('max_velocity'))*life+size[1]/2+growth
            low=pose[2]-nozzle_half+min(up,0)*float(e.findtext('max_velocity'))*life-size[1]/2-growth
            self.assertLess(top,2.8,(e.get('name'),top))
            if e.get('name') in ('rollover','curl','upper_smoke','lower_wisp'):
                self.assertAlmostEqual(up,0)
                self.assertLessEqual(size[1],.50)
            else:
                self.assertGreater(up,.99)
            if e.get('name') in ('upper_smoke','lower_wisp'):
                self.assertGreaterEqual(low,2.15,(e.get('name'),low))
                self.assertLessEqual(top,2.65,(e.get('name'),top))
        flames=[e for e in self.world.findall('.//particle_emitter')
                if not Path(e.findtext('material/pbr/metal/albedo_map')).name.startswith('smoke') and e.get('name')!='embers']
        self.assertEqual(flames, [], 'No whole-flame sprites may remain')

    def test_wall_fuel_and_fire_remain_outside_door_apertures(self):
        # Entire native proxy volumes remain clear of the adjacent doorways.
        specs={v['name']:v for v in self.effects['volumes']}
        for name,axis,minimum,maximum in [('front_records',0,-3.275,0),('right_cable',1,-1.125,0)]:
            v=specs[name]
            self.assertGreater(v['center'][axis]-v['size'][axis]/2,minimum)
            self.assertLess(v['center'][axis]+v['size'][axis]/2,maximum)
        for name,axis,minimum,maximum in [('wall_records',0,-3.275,0),('wall_cables',1,-1.125,0)]:
            model=self.world.find("model[@name='office_fire_"+name+"']")
            for v in model.findall('.//visual'):
                pose=list(map(float,v.findtext('pose').split()))
                size=list(map(float,v.findtext('geometry/box/size').split()))
                # Bounds including the slight sideways tilt of paper folders.
                half=(size[0]*abs(math.cos(pose[4]))+size[2]*abs(math.sin(pose[4])))/2 if axis==0 else size[1]/2
                self.assertGreater(pose[axis]-half,minimum)
                self.assertLess(pose[axis]+half,maximum)

    def test_ceiling_rolls_connect_to_visible_burning_sources(self):
        volumes=self.effects['volumes']
        self.assertEqual({v['source'] for v in volumes},{'front_records','right_cable','workstation'})
        for source in {v['source'] for v in volumes}:
            plume=next(v for v in volumes if v['source']==source and v['kind']==0)
            ceiling=next(v for v in volumes if v['source']==source and v['kind']==1)
            self.assertAlmostEqual(plume['center'][2]+plume['size'][2]/2,
                                   ceiling['center'][2]-ceiling['size'][2]/2)
            self.assertEqual(plume['direction'],[0,0,1])
            self.assertEqual(ceiling['direction'][2],0)
            for axis in (0,1):
                self.assertLess(abs(plume['center'][axis]-ceiling['center'][axis]),
                                (plume['size'][axis]+ceiling['size'][axis])/2)
        fuel_anchors={
            'front_records':[(-1.8,3.662,1.27)],
            'right_cable':[(4.395,-.52,1.04)],
            'workstation':[(-3.88,.44,.49),(-4.4,-.235,.79),(-4.62,.52,1.15)],
        }
        for name,anchors in fuel_anchors.items():
            body=next(v for v in volumes if v['name']==name)
            for anchor in anchors:
                for k in range(3):
                    self.assertLess(abs(anchor[k]-body['center'][k]),body['size'][k]/2,
                                    (name,anchor,'Visible fuel must lie within the fire density domain'))
        for i,a in enumerate(volumes):
            self.assertLess(a['center'][2]+a['size'][2]/2,2.8)
            for b in volumes[i+1:]:
                overlaps=[min(a['center'][k]+a['size'][k]/2,b['center'][k]+b['size'][k]/2)
                          -max(a['center'][k]-a['size'][k]/2,b['center'][k]-b['size'][k]/2)
                          for k in range(3)]
                self.assertLessEqual(min(overlaps),1e-6,'Volume proxies must not double-integrate overlapping fire')
        # The main burning cabinet is within the forward 74.5-degree view from
        # the 1.35m-high camera at spawn, making the real fuel visible at startup.
        angle=abs(math.atan2(-3.88,.44+6.45))
        self.assertLess(angle,math.radians(74.5/2))
    def test_furniture_collision_bounding_boxes_match_map(self):
        def rotation(roll,pitch,yaw):
            cr,sr,cp,sp,cy,sy=math.cos(roll),math.sin(roll),math.cos(pitch),math.sin(pitch),math.cos(yaw),math.sin(yaw)
            return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr],[sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr],[-sp,cp*sr,cp*cr]]
        for obstacle in OFFICE_OBSTACLES:
            model=self.world.find(f"model[@name='{obstacle['id']}']")
            self.assertIsNotNone(model)
            origin=list(map(float,model.findtext('pose').split()))[:3]
            for col in model.findall('.//collision'):
                pose=list(map(float,col.findtext('pose').split()));matrix=rotation(*pose[3:])
                box=col.find('geometry/box')
                if box is not None:half=[float(v)/2 for v in box.findtext('size').split()]
                else:
                    cylinder=col.find('geometry/cylinder');r=float(cylinder.findtext('radius'))
                    half=[r,r,float(cylinder.findtext('length'))/2]
                extents=[sum(abs(matrix[a][b])*half[b] for b in range(3)) for a in range(3)]
                for axis,a in [('x',0),('y',1)]:
                    lo,hi=origin[a]+pose[a]-extents[a],origin[a]+pose[a]+extents[a]
                    self.assertGreaterEqual(lo,obstacle['bounds']['min_'+axis]-.00001,(obstacle['id'],col.get('name')))
                    self.assertLessEqual(hi,obstacle['bounds']['max_'+axis]+.00001,(obstacle['id'],col.get('name')))
    def test_mismatched_static_map_rejected(self):
        bad=copy.deepcopy(self.skeleton);bad['static_obstacles'][0]['bounds']['min_x']+=.2
        with self.assertRaisesRegex(ValueError,'OFFICE_FURNITURE_MAP_MISMATCH'):
            apply_office_style(copy.deepcopy(self.before),self.out/'bad',bad)
    def test_real_png_and_manifest_integrity(self):
        meta=json.loads((ASSETS.parent/'office_manifest.json').read_text());self.assertEqual(meta['third_party_assets'],[])
        for f in meta['files']:
            data=(ROOT/f['path']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(),f['sha256'])
            self.assertEqual(data[:8],b'\x89PNG\r\n\x1a\n')
            off=8;compressed=b'';width=height=kind=None
            while off<len(data):
                length=struct.unpack('>I',data[off:off+4])[0];tag=data[off+4:off+8];payload=data[off+8:off+8+length]
                self.assertEqual(zlib.crc32(tag+payload)&0xffffffff,struct.unpack('>I',data[off+8+length:off+12+length])[0])
                if tag==b'IHDR':width,height,_,kind,_,_,_=struct.unpack('>IIBBBBB',payload)
                elif tag==b'IDAT':compressed+=payload
                off+=12+length
            self.assertEqual((width,height),(512,512))
            self.assertEqual(len(zlib.decompress(compressed)),height*(1+width*(3 if kind==2 else 4)))
    def test_office_door_is_glazed_but_physically_closed(self):
        p=self.world.find("model[@name='door_test_door']/link[@name='panel']")
        self.assertIsNotNone(p.find("visual[@name='office_glazing']"))
        self.assertIsNotNone(p.find("visual[@name='office_blue_band_1']"))
        self.assertIsNotNone(p.find("collision[@name='panel_collision']"))
        self.assertIsNone(p.find("visual[@name='recess_1_0']"))
    def test_all_texture_and_mesh_references_resolve(self):
        for tag in ['uri','albedo_map','normal_map','roughness_map','color_range_image']:
            for node in self.world.findall('.//'+tag):
                self.assertTrue(Path(node.text).is_file(),node.text)
                self.assertTrue(Path(node.text).is_relative_to(ROOT))
        self.assertEqual(json.loads((self.out/'office-scene.json').read_text())['visual_fire_only'],True)
if __name__=='__main__':unittest.main()
