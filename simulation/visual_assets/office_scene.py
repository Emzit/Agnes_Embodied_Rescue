"""Office interiors based on a user supplied schematic and office walkthrough.

Rendering is procedural, with actual static furniture collisions. Fire particles
are a visual demonstration: not combustion, temperature or smoke-flow physics.
"""
from pathlib import Path
import json,math
import xml.etree.ElementTree as ET
from simulation.visual_assets.scene_style import box_mesh,collada,set_mesh,replace_material
from simulation.visual_assets.fire_scene import child
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'simulation/visual_assets/office_textures'
PREFIX='office_'
WORKSTATIONS=[(x,y) for y in (-4.5,-1.9,.7) for x in (-6.6,-4.4)]
OFFICE_OBSTACLES=[
    {'id':f'office_workstation_{i+1}',
     'bounds':{'min_x':round(x-.9,3),'max_x':round(x+.9,3),
               'min_y':round(y-1.12,3),'max_y':round(y+.43,3)}}
    for i,(x,y) in enumerate(WORKSTATIONS)
]
def solid(color,rough=.82,emissive=None):
    m=ET.Element('material')
    child(m,'ambient',' '.join(str(v) for v in color)+' 1')
    child(m,'diffuse',' '.join(str(v) for v in color)+' 1')
    child(m,'specular','.04 .04 .04 1')
    metal=ET.SubElement(ET.SubElement(m,'pbr'),'metal')
    child(metal,'metalness','0')
    child(metal,'roughness',rough)
    if emissive is not None:child(m,'emissive',' '.join(str(v) for v in emissive)+' 1')
    return m
def textured(kind):
    m=solid((1,1,1),.96)
    metal=m.find('pbr/metal')
    for tag,suffix in [('albedo_map','albedo'),('normal_map','normal'),('roughness_map','roughness')]:
        path=ASSETS/f'{kind}_{suffix}.png'
        if not path.is_file():raise FileNotFoundError(path)
        child(metal,tag,str(path))
    return m
def box(link,name,pose,size,color=(.75,.75,.75),collision=False,mat=None,shadows=True):
    v=ET.SubElement(link,'visual',{'name':name})
    child(v,'pose',' '.join(str(x) for x in pose))
    child(v,'cast_shadows',str(shadows).lower())
    child(ET.SubElement(ET.SubElement(v,'geometry'),'box'),'size',' '.join(str(x) for x in size))
    v.append(solid(color) if mat is None else mat)
    if collision:
        c=ET.SubElement(link,'collision',{'name':name+'_collision'})
        child(c,'pose',' '.join(str(x) for x in pose))
        child(ET.SubElement(ET.SubElement(c,'geometry'),'box'),'size',' '.join(str(x) for x in size))
    return v
def cylinder(link,name,pose,radius,length,color,collision=False):
    v=ET.SubElement(link,'visual',{'name':name})
    child(v,'pose',' '.join(str(x) for x in pose))
    child(v,'cast_shadows','true')
    g=ET.SubElement(ET.SubElement(v,'geometry'),'cylinder')
    child(g,'radius',radius);child(g,'length',length);v.append(solid(color,.65))
    if collision:
        c=ET.SubElement(link,'collision',{'name':name+'_collision'})
        child(c,'pose',' '.join(str(x) for x in pose))
        cg=ET.SubElement(ET.SubElement(c,'geometry'),'cylinder')
        child(cg,'radius',radius);child(cg,'length',length)
    return v
def model(world,name,pose=(0,0,0,0,0,0)):
    m=ET.SubElement(world,'model',{'name':name})
    child(m,'static','true');child(m,'pose',' '.join(str(v) for v in pose))
    return ET.SubElement(m,'link',{'name':'structure'})
def light(world,name,xyz,color,radius=6):
    l=ET.SubElement(world,'light',{'name':name,'type':'point'})
    child(l,'pose',' '.join(str(x) for x in xyz)+' 0 0 0')
    child(l,'diffuse',' '.join(str(x) for x in color)+' 1')
    child(l,'specular','0 0 0 1');child(l,'cast_shadows','false')
    a=ET.SubElement(l,'attenuation')
    for tag,value in [('range',radius),('constant',.55),('linear',.20),('quadratic',.055)]:
        child(a,tag,value)
    return l
def _furniture(world,meshdir):
    dark=(.036,.043,.048);white=(.72,.72,.68);metal=(.24,.27,.28)
    screen_mesh=meshdir/'office_screen.dae'
    # Screen faces -Y, towards seated employee / the spawn end of the office.
    collada(screen_mesh,[(-.25,0,-.145),(.25,0,-.145),(.25,0,.145),(-.25,0,.145)],
            [(0,-1,0)]*4,[(0,0),(1,0),(1,1),(0,1)],[(0,1,2),(0,2,3)])
    for i,(x,y) in enumerate(WORKSTATIONS,1):
        l=model(world,f'office_workstation_{i}',(x,y,0,0,0,0))
        box(l,'white_desk',(0,0,.72,0,0,0),(1.6,.75,.045),white,True)
        for xx in (-.70,.70):
            for yy in (-.27,.27):
                box(l,f'leg_{xx}_{yy}',(xx,yy,.352,0,0,0),(.045,.045,.70),(.53,.54,.53),True)
        box(l,'desk_crossbar',(0,.24,.51,0,0,0),(1.42,.035,.055),metal)
        box(l,'green_divider',(0,.335,.97,0,0,0),(1.58,.032,.46),(.33,.47,.09),True)
        box(l,'drawer_cabinet',(.52,.01,.32,0,0,0),(.35,.55,.63),(.66,.67,.64),True)
        for z in (.22,.42,.60):
            box(l,f'drawer_line_{z}',(.52,-.269,z,0,0,0),(.325,.004,.005),(.28,.29,.28))
            box(l,f'drawer_handle_{z}',(.52,-.28,z-.035,0,0,0),(.085,.025,.012),metal)
        box(l,'monitor_base',(-.13,.06,.754,0,0,0),(.25,.17,.018),dark)
        box(l,'monitor_stem',(-.13,.10,.88,0,0,0),(.039,.035,.23),dark)
        box(l,'monitor_bezel',(-.13,.10,1.032,0,0,0),(.54,.035,.33),dark,True)
        v=ET.SubElement(l,'visual',{'name':'lcd_display'})
        child(v,'pose','-.13 .080 1.032 0 0 0');set_mesh(v,screen_mesh)
        screen=solid((1,1,1),.40,(.20,.25,.25))
        child(screen.find('pbr/metal'),'albedo_map',str(ASSETS/'screen.png'))
        v.append(screen);child(v,'cast_shadows','false')
        box(l,'keyboard',(-.13,-.19,.755,0,0,0),(.39,.135,.018),(.075,.08,.078))
        for k in range(4):
            box(l,f'keyboard_row_{k}',(-.13,-.231+k*.024,.766,0,0,0),(.355,.008,.004),(.21,.23,.22))
        box(l,'mouse',(.18,-.2,.757,0,0,0),(.055,.085,.025),dark)
        # Chair and casters all stay within the declared conservative footprint.
        cy=-.75
        box(l,'chair_seat',(0,cy,.435,0,0,0),(.47,.44,.055),dark,True)
        box(l,'chair_back',(0,cy-.20,.70,-.07,0,0),(.46,.055,.48),dark,True)
        cylinder(l,'chair_piston',(0,cy,.26,0,0,0),.038,.33,metal,True)
        for side in (-1,1):
            box(l,f'armrest_{side}',(side*.27,cy,.63,0,0,0),(.045,.37,.04),dark)
            box(l,f'arm_support_{side}',(side*.255,cy+.06,.535,0,0,0),(.028,.03,.19),dark)
        for c in range(5):
            angle=c*2*math.pi/5
            xx=.14*math.cos(angle);yy=cy+.14*math.sin(angle)
            box(l,f'chair_spoke_{c}',(xx,yy,.09,0,0,angle),(.29,.03,.028),metal)
            cylinder(l,f'caster_{c}',(.28*math.cos(angle),cy+.28*math.sin(angle),.049,math.pi/2,0,angle),.042,.043,dark,True)
def _architecture(world,out,boundary):
    meshdir=out/'office-meshes';meshdir.mkdir(parents=True,exist_ok=True)
    x0,x1=boundary['min_x'],boundary['max_x'];y0,y1=boundary['min_y'],boundary['max_y']
    for m in world.findall('model'):
        name=m.get('name','')
        if name=='ground':
            mesh=meshdir/'office_floor.dae'
            collada(mesh,[(x0-.1,y0-.1,.002),(x1+.1,y0-.1,.002),(x1+.1,y1+.1,.002),(x0-.1,y1+.1,.002)],
                    [(0,0,1)]*4,[(0,0),((x1-x0+.2)/1.2,0),((x1-x0+.2)/1.2,(y1-y0+.2)/1.2),(0,(y1-y0+.2)/1.2)],[(0,1,2),(0,2,3)])
            for v in m.findall('./link/visual'):
                set_mesh(v,mesh);replace_material(v,textured('carpet'))
        elif name.startswith('wall_'):
            for v in m.findall('./link/visual'):replace_material(v,textured('plaster'))
    l=model(world,'office_ceiling',((x0+x1)/2,(y0+y1)/2,2.84,0,0,0))
    mesh=meshdir/'office_ceiling.dae';box_mesh(mesh,(x1-x0+.2,y1-y0+.2,.08),tile=.6)
    v=box(l,'acoustic_tiles',(0,0,0,0,0,0),(x1-x0+.2,y1-y0+.2,.08),collision=True,mat=textured('ceiling'))
    set_mesh(v,mesh)
    trim=model(world,'office_skirt_boards')
    for idx,wall in enumerate(world.findall("model")):
        if not wall.get('name','').startswith('wall_'):continue
        c=wall.find('./link/collision/geometry/box/size')
        if c is None:continue
        pose=[float(v) for v in wall.findtext('pose','0 0 0 0 0 0').split()]
        sizes=[float(v) for v in c.text.split()]
        # Baseboards follow actual wall segment geometry; a small added width only.
        box(trim,f'baseboard_{idx}',(pose[0],pose[1],.06,0,0,pose[5]),(sizes[0]+.018,sizes[1]+.018,.12),(.26,.27,.265))
    fixtures=model(world,'office_ceiling_fixtures')
    for i,x in enumerate((-6.6,-2.4,1.8,6.3)):
        for j,y in enumerate((-5.2,-1.1,3.0,6.6)):
            box(fixtures,f'fixture_{i}_{j}',(x,y,2.78,0,0,0),(.66,.66,.032),(.23,.24,.23),shadows=False)
            # Several circuits are dark near the fire, with emergency light
            # keeping the floor and door silhouettes readable.
            working=(i,j) in {(0,0),(0,3),(1,0),(2,1),(2,3),(3,0),(3,3)}
            panel=solid((.68,.68,.63),.8,(.64,.65,.57)) if working else solid((.19,.18,.16),.94)
            box(fixtures,f'light_panel_{i}_{j}',(x,y,2.760,0,0,0),(.585,.585,.010),mat=panel,shadows=False)
    _furniture(world,meshdir)
    return meshdir
def _glass_doors(world):
    # Appearance-only office glazing. Collision, hinges, masses and handles stay
    # exactly as the door geometry/controller created them.
    for m in world.findall('model'):
        if not m.get('name','').startswith('door_'):continue
        panel=m.find("link[@name='panel']")
        if panel is None:continue
        geometry=panel.find("collision[@name='panel_collision']/geometry/box/size")
        if geometry is None:continue
        width,thickness,height=[float(v) for v in geometry.text.split()]
        for v in list(panel.findall('visual')):
            if v.get('name','')=='panel_visual' or v.get('name','').startswith('recess_'):panel.remove(v)
        glass=solid((.36,.45,.45),.19)
        child(glass,'double_sided','true')
        v=box(panel,'office_glazing',(0,0,0,0,0,0),(width,thickness,height),mat=glass)
        child(v,'transparency','.48')
        for face in (-1,1):
            yy=face*(thickness/2+.003)
            box(panel,f'office_blue_band_{face}',(0,yy,-.03,0,0,0),(width,.005,.18),(.045,.24,.38))
            for band in range(7):
                z=-.65+band*.057
                box(panel,f'office_privacy_band_{face}_{band}',(0,yy,z,0,0,0),(width,.003,.014),(.58,.62,.59),shadows=False)
        for side in (-1,1):
            box(panel,f'office_edge_{side}',(side*(width/2-.021),0,0,0,0,0),(.042,thickness+.012,height),(.22,.25,.25))
            box(panel,f'office_rail_{side}',(0,0,side*(height/2-.019),0,0,0),(width,thickness+.012,.038),(.22,.25,.25))
def _door_lintels(world,skeleton):
    # The importer leaves a full-height wall opening. Close the space over each
    # hinged leaf without narrowing its side clearance or changing its hinge.
    for door in skeleton.get('doors',[]):
        ident=door['id']
        width=float(door.get('width',1.25))
        leaf_top=float(door.get('height',2.15))+.015
        bottom=leaf_top+.015
        top=2.8
        if bottom>=top:continue
        x,y=map(float,door['at'][:2])
        yaw=float(door.get('orientation',0))
        l=model(world,'office_lintel_'+ident,(x,y,(bottom+top)/2,0,0,yaw))
        box(l,'plaster_header',(0,0,0,0,0,0),(width,.15,top-bottom),collision=True,mat=textured('plaster'))
def _validate_obstacles(skeleton):
    actual={o['id']:o.get('bounds') for o in skeleton.get('static_obstacles',[])}
    for expected in OFFICE_OBSTACLES:
        bounds=actual.get(expected['id'])
        if bounds is None or any(abs(float(bounds.get(k,float('nan')))-v)>1e-6 or not math.isfinite(float(bounds.get(k,float('nan')))) for k,v in expected['bounds'].items()):
            raise ValueError('OFFICE_FURNITURE_MAP_MISMATCH:'+expected['id'])
def apply_office_style(world,out,skeleton):
    """Enclose the imported plan, apply indoor finishes, furnish it, add wall/ceiling fire."""
    out=Path(out).resolve()
    if not out.is_relative_to(ROOT):raise ValueError('Office output must stay in project workspace')
    out.mkdir(parents=True,exist_ok=True)
    # Replacement is deterministic; existing room/door/robot collisions untouched.
    for node in list(world):
        if node.get('name','').startswith(PREFIX):world.remove(node)
    boundary=skeleton.get('boundary',{'min_x':-9,'max_x':9,'min_y':-8,'max_y':8})
    _validate_obstacles(skeleton)
    _architecture(world,out,boundary)
    _glass_doors(world)
    _door_lintels(world,skeleton)
    scene=world.find('scene')
    if scene is None:scene=ET.SubElement(world,'scene')
    for tag,value in [('ambient','.24 .23 .215 1'),('background','.07 .065 .06 1'),('shadows','true')]:
        n=scene.find(tag)
        if n is None:n=ET.SubElement(scene,tag)
        n.text=value
    fog=scene.find('fog')
    if fog is None:fog=ET.SubElement(scene,'fog')
    for tag,value in [('type','linear'),('color','.16 .15 .135 1'),('density','.008'),('start','8'),('end','25')]:
        n=fog.find(tag)
        if n is None:n=ET.SubElement(fog,tag)
        n.text=value
    # Daylight must not turn the enclosed office into an outdoor scene.
    sun=world.find("light[@name='sun']")
    if sun is not None:world.remove(sun)
    from simulation.visual_assets.office_damage import apply_office_damage
    from simulation.visual_assets.office_fire_v4 import apply_fire_effects
    damage=apply_office_damage(world,out)
    light(world,'office_ambient_fixture',(0,-3.5,2.63),(.20,.215,.23),10)
    # One shadow map from a broad spot gives contact/depth cues without six
    # cubemap shadow renders for every point firelight.
    key=ET.SubElement(world,'light',name='office_emergency_key',type='spot')
    child(key,'pose','-2.0 -4.4 2.68 0 0 0');child(key,'direction','.15 .32 -1')
    child(key,'diffuse','.40 .44 .47 1');child(key,'specular','.10 .11 .12 1')
    child(key,'cast_shadows','true')
    a=ET.SubElement(key,'attenuation')
    for tag,value in [('range',12),('constant',.65),('linear',.07),('quadratic',.038)]:child(a,tag,value)
    spot=ET.SubElement(key,'spot')
    for tag,value in [('inner_angle',1.05),('outer_angle',2.45),('falloff',.8)]:child(spot,tag,value)
    effects=apply_fire_effects(world,out)
    runtime={'schema':'agnes.office-fire-runtime.v1','lights':effects['lights'],'emitters':effects['dynamic_emitters']}
    for config in runtime['lights']:
        l=light(world,config['name'],config['position'],config['color'],config['range'])
        l.find('specular').text=' '.join(str(v*.22) for v in config['color'])+' 1'
    for config in runtime['emitters']:
        emitter_node=world.find("model[@name='"+config['model']+"']/link[@name='"+config['link']+"']/particle_emitter[@name='"+config['emitter']+"']")
        if emitter_node is None:raise ValueError('MISSING_DYNAMIC_EMITTER:'+config['emitter'])
        topic='/office_fire/'+config['model']+'/'+config['emitter']+'/cmd'
        old_topic=emitter_node.find('topic')
        if old_topic is None:child(emitter_node,'topic',topic)
        else:old_topic.text=topic
        config['topic']=topic
    (out/'office-fire-runtime-config.json').write_text(json.dumps(runtime,indent=2)+'\n')
    particle_count=effects['approx_steady_live_particles']
    metadata={'schema':'agnes.indoor-office-fire.v1','source':'Project-authored procedural assets; architecture and office finishes follow user-supplied references',
      'physical_fire_solver':False,'visual_fire_only':True,'ceiling_height_m':2.8,'enclosed_indoor':True,
      'furniture_obstacles':OFFICE_OBSTACLES,'furniture_count':len(WORKSTATIONS),
      'fire_attached_to':['furniture','papers','cables','walls','ceiling'],'ground_fire_piles':0,
      'particle_scatter_ratio':0,'approx_steady_live_particles':particle_count,
      'point_lights':len(world.findall("light[@type='point']")),'shadow_lights':1,
      'fire_motion':'native three-dimensional advected flame density with horizontal ceiling flow','scorch_overlay_meshes':0,
      'realism_version':4,'flame_renderer':effects['renderer'],'flame_billboards':effects['flame_billboards'],'volume_count':effects['volume_count'],'burning_sources':effects['burn_zones'],'damage':damage,
      'dynamic_light_count':len(runtime['lights']),'dynamic_emitter_count':len(runtime['emitters']),
      'working_ceiling_panels':7,'dark_ceiling_panels':9,
      'navigation_note':'Furniture uses physical collisions; map static_obstacles must include the conservative footprints. Visual smoke has no laser scatter.',
      'limitations':'The walkthrough supplies appearance only. Dimensions follow the supplied schematic interpretation, not a measured survey. Flames and smoke do not compute heat, fire growth or toxic gas.'}
    (out/'office-scene.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return metadata
