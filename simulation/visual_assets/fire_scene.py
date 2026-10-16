"""Lightweight visual fire dressing for the Lotus demonstration map.

These are artistic particle effects, not combustion/heat/smoke transport physics.
All added models are visual-only; scatter ratio 0 preserves laser navigation.
"""
from pathlib import Path
import json
import math
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'simulation/visual_assets/fire_textures'
PREFIX = 'rescue_fire_'
# Kept against walls, leaving the 4 m B_Main centre lane unobstructed.
# The first two fires are visible from the default camera at (0,-8), yaw pi/2.
SOURCES = [
    {'name':'near_east','x':1.68,'y':-4.42,'scale':.90,'wall_x':1.943},
    {'name':'middle_west','x':-1.66,'y':-3.56,'scale':.72,'wall_x':-1.943},
    {'name':'far_east','x':1.67,'y':3.12,'scale':1.0,'wall_x':1.943},
]

def child(parent, tag, text, attrs=None):
    e=ET.SubElement(parent,tag,attrs or {})
    e.text=str(text)
    return e

def texture_material(texture, emissive=False):
    m=ET.Element('material')
    child(m,'ambient','1 1 1 1')
    child(m,'diffuse','1 1 1 1')
    child(m,'specular','0 0 0 1')
    child(m,'lighting','false' if emissive else 'true')
    child(m,'double_sided','true')
    if emissive:
        child(m,'emissive','1 .66 .28 1')
    metal=ET.SubElement(ET.SubElement(m,'pbr'),'metal')
    child(metal,'metalness','0')
    child(metal,'roughness','.96')
    path=ASSETS/texture
    if not path.is_file():
        raise FileNotFoundError(f'{path}: run fire_generate.py with the project ROS Python')
    child(metal,'albedo_map',str(path))
    if texture=='charcoal.png':
        child(metal,'normal_map',str(ASSETS/'charcoal_normal.png'))
        child(metal,'emissive_map',str(ASSETS/'embers.png'))
    return m

def emitter(link, name, z, size, rate, lifetime, vmin, vmax, growth, texture, life, scale=1):
    e=ET.SubElement(link,'particle_emitter',{'name':name,'type':'box'})
    # Ogre/Gazebo emit along +X: -pi/2 pitch turns that direction upward.
    child(e,'pose',f'0 0 {z:.4f} 0 {-math.pi/2} 0')
    child(e,'emitting','true')
    child(e,'duration','0')
    child(e,'size',f'.055 {0.26*scale:.4f} {0.32*scale:.4f}')
    child(e,'particle_size',' '.join(f'{x*scale:.4f}' for x in size))
    child(e,'rate',rate)
    child(e,'lifetime',lifetime)
    child(e,'min_velocity',vmin*scale)
    child(e,'max_velocity',vmax*scale)
    child(e,'scale_rate',growth*scale)
    child(e,'particle_scatter_ratio','0')
    e.append(texture_material(texture,emissive=texture!='smoke.png'))
    child(e,'color_range_image',str(ASSETS/life))
    return e

def quad_mesh(path):
    """UV quad on XY, normal up. A 1 m authored asset, scaled per decal."""
    path.write_text('''<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><author>Agnes Embodied Rescue project</author></contributor><created>2026-10-12T00:00:00Z</created><modified>2026-10-12T00:00:00Z</modified><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_geometries><geometry id="mesh"><mesh>
<source id="pos"><float_array id="pos-array" count="12">-.5 -.5 0 .5 -.5 0 .5 .5 0 -.5 .5 0</float_array><technique_common><accessor source="#pos-array" count="4" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="norm"><float_array id="norm-array" count="12">0 0 1 0 0 1 0 0 1 0 0 1</float_array><technique_common><accessor source="#norm-array" count="4" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="uv"><float_array id="uv-array" count="8">0 0 1 0 1 1 0 1</float_array><technique_common><accessor source="#uv-array" count="4" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<vertices id="vertices"><input semantic="POSITION" source="#pos"/></vertices>
<triangles count="2"><input semantic="VERTEX" source="#vertices" offset="0"/><input semantic="NORMAL" source="#norm" offset="1"/><input semantic="TEXCOORD" source="#uv" offset="2" set="0"/><p>0 0 0 1 1 1 2 2 2 0 0 0 2 2 2 3 3 3</p></triangles>
</mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="scene"><node id="node"><instance_geometry url="#mesh"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>''')

def decal(link,name,mesh,pose,scale):
    v=ET.SubElement(link,'visual',{'name':name})
    child(v,'pose',' '.join(str(x) for x in pose))
    child(v,'cast_shadows','false')
    geom=ET.SubElement(ET.SubElement(v,'geometry'),'mesh')
    child(geom,'uri',str(mesh))
    child(geom,'scale',' '.join(str(x) for x in scale))
    v.append(texture_material('soot.png'))
    return v

def apply_fire_style(world,out):
    """Add deterministic animated fire effects; return render-only manifest.

    Caller decides which maps use the style. Existing collisions, sensors,
    semantic names, placement seeds and all navigation files are left intact.
    """
    out=Path(out).resolve()
    if not out.is_relative_to(ROOT):
        raise ValueError('Fire assets must stay inside the project workspace')
    out.mkdir(parents=True,exist_ok=True)
    mesh=out/'fire_scorch_quad.dae'
    quad_mesh(mesh)
    # Idempotent when called twice by an importer or a validation harness.
    for node in list(world):
        if node.get('name','').startswith(PREFIX):
            world.remove(node)
    if not any(p.get('name')=='gz::sim::systems::ParticleEmitter' for p in world.findall('plugin')):
        ET.SubElement(world,'plugin',{'filename':'gz-sim-particle-emitter-system','name':'gz::sim::systems::ParticleEmitter'})
    scene=world.find('scene')
    if scene is None:
        scene=ET.SubElement(world,'scene')
    for tag,value in [('ambient','.22 .20 .18 1'),('background','.18 .19 .20 1'),('shadows','true')]:
        e=scene.find(tag)
        if e is None:e=ET.SubElement(scene,tag)
        e.text=value
    # Slight distant haze keeps the nearby camera image and floor readable.
    fog=scene.find('fog')
    if fog is None:fog=ET.SubElement(scene,'fog')
    fog.attrib.pop('type',None)
    for tag,value in [('type','linear'),('color','.27 .26 .25 1'),('density','.008'),('start','10'),('end','42')]:
        e=fog.find(tag)
        if e is None:e=ET.SubElement(fog,tag)
        e.text=value
    sun=world.find("./light[@name='sun']")
    if sun is not None:
        for tag,value in [('diffuse','.40 .40 .38 1'),('specular','.08 .07 .06 1')]:
            e=sun.find(tag)
            if e is None:e=ET.SubElement(sun,tag)
            e.text=value
    for source in SOURCES:
        name=PREFIX+source['name'];s=source['scale']
        m=ET.SubElement(world,'model',{'name':name})
        child(m,'static','true')
        child(m,'pose',f"{source['x']} {source['y']} 0 0 0 0")
        link=ET.SubElement(m,'link',{'name':'visual_effect'})
        emitter(link,'flame',.10,(.40,.64,.40),38,.86,.82,1.45,.10,'flame.png','flame_life.png',s)
        emitter(link,'hot_core',.09,(.23,.38,.23),24,.49,.50,.91,.04,'flame.png','flame_life.png',s)
        emitter(link,'smoke',.58,(.68,.72,.68),7,4.5,.42,.76,.19,'smoke.png','smoke_life.png',s)
        emitter(link,'embers',.21,(.035,.075,.035),5,1.50,.90,1.75,0,'spark.png','spark_life.png',s)
        decal(link,'floor_scorch',mesh,(0,0,.007,0,0,.35),(1.18*s,1.42*s,1))
        wall_dx=source['wall_x']-source['x']
        # XY quad rotates into the wall plane; the feathered alpha hides edges.
        decal(link,'wall_soot',mesh,(wall_dx,0,1.10,0,math.pi/2,0),(2.1,1.25*s,1))
        for i,(x,y,z,yaw,length) in enumerate([
            (-.10,-.04,.065,.34,.62),(.08,.07,.095,-.42,.55),
            (-.03,.12,.125,1.15,.46),(.07,-.09,.15,.18,.50)]):
            visual=ET.SubElement(link,'visual',{'name':f'charred_timber_{i}'})
            child(visual,'pose',f'{x*s} {y*s} {z*s} 0 .05 {yaw}')
            child(visual,'cast_shadows','true')
            box=ET.SubElement(ET.SubElement(visual,'geometry'),'box')
            child(box,'size',f'{length*s} {.105*s} {.10*s}')
            visual.append(texture_material('charcoal.png'))
        light=ET.SubElement(world,'light',{'name':name+'_glow','type':'point'})
        child(light,'pose',f"{source['x']-.10} {source['y']} .72 0 0 0")
        child(light,'diffuse','1 .30 .035 1')
        child(light,'specular','.8 .21 .02 1')
        child(light,'cast_shadows','false')
        att=ET.SubElement(light,'attenuation')
        for tag,value in [('range','4.5'),('constant','.20'),('linear','.38'),('quadratic','.18')]:
            child(att,tag,value)
    metadata={
        'schema':'agnes.visual-fire.v1','source':'project-authored deterministic procedural assets',
        'mode':'VISUAL_DEMONSTRATION_ONLY','physical_fire_solver':False,
        'heat_or_smoke_transport_truth':False,'adds_collision':False,
        'particle_scatter_ratio':0,'sources':SOURCES,'particle_emitters':len(SOURCES)*4,
        'approx_steady_live_particles':round(len(SOURCES)*(38*.86+24*.49+7*4.5+5*1.5)),
        'point_lights':len(SOURCES),
        'engine':'Gazebo Sim 8 ParticleEmitter / Ogre2',
        'documentation':'https://gazebosim.org/api/sim/8/particle_emitter.html',
        'limitation':'Particle animation and lit scenery approximate a fire visually, not measured fire dynamics, thermal hazard, visibility certification, or safe evacuation behavior.'
    }
    (out/'fire-scene.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return metadata
