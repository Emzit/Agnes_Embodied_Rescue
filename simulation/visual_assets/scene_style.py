"""Project-authored render assets. Appearance never supplies navigation truth."""
from pathlib import Path
import math
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'simulation/visual_assets'

def collada(path, positions, normals, uvs, triangles):
    """Write explicit normals and metre-scaled UVs; no opaque mesh dependency."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    def source(name, data, stride, params):
        text = ' '.join(f'{v:.6f}' for row in data for v in row)
        names = ''.join(f'<param name="{p}" type="float"/>' for p in params)
        return f'<source id="{name}"><float_array id="{name}-array" count="{len(data)*stride}">{text}</float_array><technique_common><accessor source="#{name}-array" count="{len(data)}" stride="{stride}">{names}</accessor></technique_common></source>'
    sources = source('pos', positions, 3, ['X','Y','Z']) + source('norm', normals, 3, ['X','Y','Z']) + source('uv', uvs, 2, ['S','T'])
    indices = ' '.join(f'{i} {i} {i}' for tri in triangles for i in tri)
    path.write_text(f'''<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><contributor><author>Agnes Embodied Rescue project</author></contributor><created>2026-10-12T00:00:00Z</created><modified>2026-10-12T00:00:00Z</modified><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset><library_geometries><geometry id="mesh" name="mesh"><mesh>{sources}<vertices id="vertices"><input semantic="POSITION" source="#pos"/></vertices><triangles count="{len(triangles)}"><input semantic="VERTEX" source="#vertices" offset="0"/><input semantic="NORMAL" source="#norm" offset="1"/><input semantic="TEXCOORD" source="#uv" offset="2" set="0"/><p>{indices}</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="scene"><node id="node"><instance_geometry url="#mesh"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>''')

def box_mesh(path, size, tile=1.2):
    x,y,z = (float(v)/2 for v in size)
    faces = [
        ([(-x,-y,-z),(x,-y,-z),(x,-y,z),(-x,-y,z)],(0,-1,0),2*x,2*z),
        ([(x,y,-z),(-x,y,-z),(-x,y,z),(x,y,z)],(0,1,0),2*x,2*z),
        ([(x,-y,-z),(x,y,-z),(x,y,z),(x,-y,z)],(1,0,0),2*y,2*z),
        ([(-x,y,-z),(-x,-y,-z),(-x,-y,z),(-x,y,z)],(-1,0,0),2*y,2*z),
        ([(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],(0,0,1),2*x,2*y),
        ([(-x,y,-z),(x,y,-z),(x,-y,-z),(-x,-y,-z)],(0,0,-1),2*x,2*y),
    ]
    p,n,uv,t = [],[],[],[]
    for face, normal, width, height in faces:
        base=len(p);p.extend(face);n.extend([normal]*4)
        uv.extend([(0,0),(width/tile,0),(width/tile,height/tile),(0,height/tile)])
        t.extend([(base,base+1,base+2),(base,base+2,base+3)])
    collada(path,p,n,uv,t)

def sphere_mesh(path, rows=20, cols=32):
    p,n,uv,t=[],[],[],[]
    for j in range(rows+1):
        theta=math.pi*j/rows
        for i in range(cols+1):
            phi=2*math.pi*i/cols
            v=(math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi),math.cos(theta))
            p.append(v);n.append(v);uv.append((i/cols,j/rows))
    for j in range(rows):
        for i in range(cols):
            a=j*(cols+1)+i;b=a+cols+1
            if j>0:t.append((a,a+1,b))
            if j<rows-1:t.append((a+1,b+1,b))
    # Parametric theta runs downward, so reverse winding for outward faces.
    t=[(c,b,a) for a,b,c in t]
    collada(path,p,n,uv,t)

def torso_mesh(path):
    rings=[(.0,.09,.14),(.07,.10,.155),(.18,.105,.16),(.32,.12,.215),(.40,.105,.22),(.47,.07,.09)]
    p,n,uv,t=[],[],[],[]
    cols=32
    for j,(z,rx,ry) in enumerate(rings):
        for i in range(cols+1):
            a=2*math.pi*i/cols
            p.append((rx*math.cos(a),ry*math.sin(a),z))
            uv.append((i/cols,z/.47))
    for j in range(len(rings)-1):
        for i in range(cols):
            a=j*(cols+1)+i;b=a+cols+1
            t.extend([(a,a+1,b),(a+1,b+1,b)])
    # Average actual surface normals across the tapered rings. The duplicate
    # UV-seam vertex shares its normal with the first vertex in the same ring.
    # Horizontal ellipse normals would incorrectly shade sloping shoulders as
    # vertical cloth, especially where the shoulder narrows into the neck.
    smooth=[[0.0,0.0,0.0] for _ in range(len(rings)*cols)]
    def seam_index(index):
        ring,column=divmod(index,cols+1)
        return ring*cols+column%cols
    for a,b,c in t:
        ab=[p[b][k]-p[a][k] for k in range(3)]
        ac=[p[c][k]-p[a][k] for k in range(3)]
        face=(ab[1]*ac[2]-ab[2]*ac[1],
              ab[2]*ac[0]-ab[0]*ac[2],
              ab[0]*ac[1]-ab[1]*ac[0])
        for index in (a,b,c):
            accum=smooth[seam_index(index)]
            for k in range(3):accum[k]+=face[k]
    n=[]
    for index in range(len(p)):
        normal=smooth[seam_index(index)]
        length=math.sqrt(sum(value*value for value in normal))
        n.append(tuple(value/length for value in normal))
    collada(path,p,n,uv,t)

def material(kind, color=(1,1,1), roughness=.86):
    mat=ET.Element('material')
    ET.SubElement(mat,'ambient').text=' '.join(str(v*.7) for v in color)+' 1'
    ET.SubElement(mat,'diffuse').text=' '.join(str(v) for v in color)+' 1'
    ET.SubElement(mat,'specular').text='.04 .04 .04 1'
    metal=ET.SubElement(ET.SubElement(mat,'pbr'),'metal')
    ET.SubElement(metal,'metalness').text='0'
    ET.SubElement(metal,'roughness').text=str(roughness)
    for tag,suffix in [('albedo_map','albedo'),('normal_map','normal'),('roughness_map','roughness')]:
        p=ASSETS/'textures'/f'{kind}_{suffix}.png'
        if not p.is_file(): raise FileNotFoundError(p)
        ET.SubElement(metal,tag).text=str(p)
    return mat

def set_mesh(visual, path, scale=None):
    old=visual.find('geometry')
    if old is not None:visual.remove(old)
    mesh=ET.SubElement(ET.SubElement(visual,'geometry'),'mesh')
    ET.SubElement(mesh,'uri').text=str(Path(path).resolve())
    if scale is not None:ET.SubElement(mesh,'scale').text=' '.join(str(x) for x in scale)

def replace_material(visual, mat):
    old=visual.find('material')
    if old is not None:visual.remove(old)
    visual.append(mat)
    ET.SubElement(visual,'cast_shadows').text='true'

def apply_world_style(world, out):
    """Only visual/lighting nodes change; all collision and map geometry stays."""
    meshes=Path(out)/'visual-meshes';meshes.mkdir(exist_ok=True)
    for model in world.findall('model'):
        name=model.get('name','')
        if name=='ground':
            for visual in model.findall('./link/visual'):
                mesh=meshes/'floor.dae'
                collada(mesh,[(-50,-50,0),(50,-50,0),(50,50,0),(-50,50,0)],[(0,0,1)]*4,[(0,0),(100/1.2,0),(100/1.2,100/1.2),(0,100/1.2)],[(0,1,2),(0,2,3)])
                set_mesh(visual,mesh);replace_material(visual,material('floor'))
        elif name.startswith('wall_'):
            for visual in model.findall('./link/visual'):
                size=[float(v) for v in visual.findtext('geometry/box/size').split()]
                mesh=meshes/(name+'.dae');box_mesh(mesh,size)
                set_mesh(visual,mesh);replace_material(visual,material('wall'))
    scene=world.find('scene')
    if scene is None:scene=ET.SubElement(world,'scene')
    for tag,value in [('ambient','.36 .39 .43 1'),('background','.67 .75 .84 1'),('shadows','true')]:
        node=scene.find(tag)
        if node is None:node=ET.SubElement(scene,tag)
        node.text=value
    sun=world.find("./light[@name='sun']")
    if sun is not None:
        for tag,value in [('diffuse','.95 .88 .76 1'),('specular','.18 .18 .18 1'),('direction','-.45 .35 -1'),('cast_shadows','true')]:
            node=sun.find(tag)
            if node is None:node=ET.SubElement(sun,tag)
            node.text=value

def person_links():
    """1.74 m standing adult, smooth clothing, hands, shoes and facial details."""
    link=ET.Element('link',{'name':'body'})
    sphere=ASSETS/'meshes/sphere.dae';torso=ASSETS/'meshes/torso.dae'
    def part(name,pose,scale,kind,color=(1,1,1),mesh=sphere):
        v=ET.SubElement(link,'visual',{'name':name})
        ET.SubElement(v,'pose').text=' '.join(str(x) for x in pose)
        set_mesh(v,mesh,scale);replace_material(v,material(kind,color))
    def oval(name,x,y,z,rx,ry,rz,kind,color=(1,1,1),pitch=0):
        part(name,(x,y,z,0,pitch,0),(rx,ry,rz),kind,color)
    part('jacket',(0,0,.91,0,0,0),(1,1,1),'cloth',mesh=torso)
    oval('pelvis',0,0,.86,.115,.16,.14,'trousers')
    for sign,label in [(-1,'right'),(1,'left')]:
        y=sign*.105
        oval(label+'_thigh',0,y,.64,.08,.085,.24,'trousers')
        oval(label+'_knee',.009,y,.43,.068,.069,.085,'trousers')
        oval(label+'_shin',.012,y,.26,.06,.064,.19,'trousers')
        oval(label+'_shoe',.047,y,.065,.135,.073,.063,'leather')
        oval(label+'_upper_arm',0,sign*.235,1.22,.072,.075,.18,'cloth',pitch=-.05)
        oval(label+'_elbow',.01,sign*.255,1.07,.065,.066,.07,'cloth')
        oval(label+'_forearm',.025,sign*.26,.96,.052,.055,.145,'cloth',pitch=-.08)
        oval(label+'_hand',.04,sign*.26,.795,.046,.036,.079,'skin')
        oval(label+'_ear',-.006,sign*.091,1.59,.024,.018,.043,'skin')
        oval(label+'_eye_white',.091,sign*.039,1.629,.014,.023,.011,'detail',(.91,.88,.81))
        oval(label+'_iris',.104,sign*.039,1.629,.008,.009,.009,'detail',(.09,.07,.05))
        oval(label+'_eyebrow',.095,sign*.04,1.654,.007,.027,.006,'detail',(.12,.08,.05))
    oval('neck',0,0,1.415,.059,.058,.093,'skin')
    oval('head',.006,0,1.594,.099,.086,.137,'skin')
    oval('hair_top',-.009,0,1.706,.1,.087,.037,'detail',(.07,.048,.035))
    oval('hair_back',-.071,0,1.637,.034,.086,.086,'detail',(.07,.048,.035))
    oval('nose',.102,0,1.598,.03,.018,.024,'skin')
    oval('upper_lip',.101,0,1.554,.009,.028,.005,'detail',(.46,.23,.18))
    oval('lower_lip',.10,0,1.547,.009,.027,.005,'detail',(.57,.31,.24))
    # Fine jacket seams and a zipper add readable scale without collision.
    oval('zipper',.109,0,1.105,.004,.005,.169,'detail',(.28,.29,.28))
    for sign in [-1,1]:
        oval('pocket_'+str(sign),.101,sign*.09,1.078,.004,.042,.003,'detail',(.07,.115,.16))
    return ET.tostring(link,encoding='unicode')
