"""Offline checks only; does not start Gazebo or change the active scenario."""
from pathlib import Path
import hashlib
import json
import os
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from simulation.visual_assets.fire_scene import apply_fire_style

def check():
    original=ET.parse(ROOT/'simulation/final_rescue/world.sdf')
    world=original.getroot().find('world')
    def protected(m):
        return {
            'pose':m.findtext('pose'),
            'collisions':[ET.tostring(c).decode() for c in m.findall('.//collision')],
            'sensors':[ET.tostring(c).decode() for c in m.findall('.//sensor')],
        }
    old={m.get('name'):protected(m) for m in world.findall('model')}
    out=ROOT/'simulation/visual_assets/fire_checks'
    out.mkdir(exist_ok=True)
    meta=apply_fire_style(world,out)
    for model in world.findall('model'):
        name=model.get('name')
        if name in old:
            assert old[name]==protected(model),name
        else:
            assert not model.findall('.//collision') and not model.findall('.//sensor'),name
    particles=world.findall('.//particle_emitter')
    assert len(particles)==12
    assert all(p.findtext('particle_scatter_ratio')=='0' for p in particles)
    for tag in ['albedo_map','emissive_map','normal_map','color_range_image','uri']:
        for node in world.findall('.//'+tag):
            if node.text and str(ROOT) in node.text:
                assert Path(node.text).is_file(),node.text
    nmodels=len(world.findall('model'))
    apply_fire_style(world,out)
    assert nmodels==len(world.findall('model'))
    assert len(world.findall('.//particle_emitter'))==12
    manifest=json.loads((ROOT/'simulation/visual_assets/fire_manifest.json').read_text())
    assert manifest['models_called']==[] and manifest['third_party_assets']==[]
    for item in manifest['files']:
        data=(ROOT/item['path']).read_bytes()
        assert hashlib.sha256(data).hexdigest()==item['sha256']
        assert data[:8]==b'\x89PNG\r\n\x1a\n'
        w,h=struct.unpack('>II',data[16:24])
        assert (w,h) in [(512,512),(256,1)]
    original.write(out/'fire_check_world.sdf',encoding='unicode',xml_declaration=True)
    env=os.environ.copy()
    base=ROOT/'runtime/ros2-jazzy/.pixi/envs/default'
    env['PATH']=str(base/'bin')+':'+env['PATH']
    env['LD_LIBRARY_PATH']=str(base/'lib')+':'+env.get('LD_LIBRARY_PATH','')
    result=subprocess.run([str(base/'bin/gz'),'sdf','-k',str(out/'fire_check_world.sdf')],env=env,capture_output=True,text=True,timeout=30)
    (out/'sdf-validation.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0 and 'Valid.' in result.stdout,result.stdout+result.stderr
    # The robot baseline has two known gz_frame_id extension warnings. The
    # fire implementation must not add its own unknown SDF element warnings.
    assert 'fog' not in result.stderr and 'particle' not in result.stderr,result.stderr
    report={'original_models_preserved':len(old),'added_visual_models':len(world.findall('model'))-len(old),'particle_emitters':len(particles),'particle_scatter_ratio':0,'collision_sensor_pose_unchanged':True,'idempotent':True,'manifest_sha256_checked':True,'sdf_valid':True,'sdf_warnings':'pre-existing robot sensor gz_frame_id extensions only','metadata':meta,'runtime_image_validated':False}
    (out/'check.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':
    check()
