"""Opaque world-space office damage baked into existing surface geometry.

No decals, transparent holes, physics changes, door changes or ground clutter.
Each existing visual retains one mesh and one compact texture atlas.
The bundled NumPy generator runs only while compiling a scene.
"""
from pathlib import Path
import copy, hashlib, json, math, subprocess
import xml.etree.ElementTree as ET
from simulation.visual_assets.scene_style import collada, set_mesh

ROOT=Path(__file__).resolve().parents[2]
GENERATOR=ROOT/"simulation/visual_assets/office_damage_generate.py"
PYTHON=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/python"
BURN_ZONES=[
 {"name":"front_wall","center":[-1.8,3.685,1.55],"surface":"north_wall","radius":[.82,.15,1.20]},
 {"name":"right_cable","center":[4.335,-.50,1.65],"surface":"east_wall","radius":[.17,.40,1.12]},
 {"name":"workstation_6_cabinet","center":[-3.88,.43,.48],"surface":"furniture","radius":[.25,.27,.36]},
 {"name":"workstation_6_desk","center":[-4.55,.67,.79],"surface":"furniture","radius":[.76,.54,.30]},
 {"name":"workstation_6_divider","center":[-4.45,1.01,1.0],"surface":"furniture","radius":[.73,.20,.40]},
 {"name":"workstation_6_chair","center":[-4.4,-.25,.70],"surface":"furniture","radius":[.30,.20,.35]},
]
def _child(parent,tag,text):
    n=ET.SubElement(parent,tag);n.text=str(text);return n
def _pose(element):
    values=[float(v) for v in element.findtext("pose","0 0 0 0 0 0").split()]
    if len(values)!=6:raise ValueError("DAMAGE_REQUIRES_EULER_POSE")
    return values
def _rotation(p):
    r,pitch,y=p[3:];cr,sr=math.cos(r),math.sin(r);cp,sp=math.cos(pitch),math.sin(pitch);cy,sy=math.cos(y),math.sin(y)
    return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr],[sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr],[-sp,cp*sr,cp*cr]]
def _transform(point,poses,vector=False):
    xyz=list(point)
    for p in reversed(poses):
        rot=_rotation(p)
        xyz=[sum(rot[i][j]*xyz[j] for j in range(3))+(0 if vector else p[i]) for i in range(3)]
    return xyz
def _sub(a,b):return [a[i]-b[i] for i in range(3)]
def _norm(a):return math.sqrt(sum(x*x for x in a))
def box_faces(size):
    x,y,z=[v/2 for v in size]
    return [
      ("east",[(x,-y,-z),(x,y,-z),(x,y,z),(x,-y,z)],(1,0,0)),
      ("west",[(-x,y,-z),(-x,-y,-z),(-x,-y,z),(-x,y,z)],(-1,0,0)),
      ("north",[(x,y,-z),(-x,y,-z),(-x,y,z),(x,y,z)],(0,1,0)),
      ("south",[(-x,-y,-z),(x,-y,-z),(x,-y,z),(-x,-y,z)],(0,-1,0)),
      ("top",[(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],(0,0,1)),
      ("bottom",[(-x,y,-z),(x,y,-z),(x,-y,-z),(-x,-y,-z)],(0,0,-1))]
def _material(base):
    m=ET.Element("material")
    for k,v in [("ambient","1 1 1 1"),("diffuse","1 1 1 1"),("specular",".035 .035 .035 1")]:_child(m,k,v)
    metal=ET.SubElement(ET.SubElement(m,"pbr"),"metal")
    _child(metal,"metalness","0");_child(metal,"roughness",".95")
    for tag,suffix in [("albedo_map","albedo"),("normal_map","normal"),("roughness_map","roughness")]:_child(metal,tag,str(base.with_name(base.name+"_"+suffix+".png")))
    return m
def _fingerprint(world,tag):
    return hashlib.sha256(b"".join(ET.tostring(n) for n in world.findall(".//"+tag))).hexdigest()
def _add_box(link,name,pose,size,color):
    v=ET.SubElement(link,"visual",name=name);_child(v,"pose"," ".join(map(str,pose)))
    _child(ET.SubElement(ET.SubElement(v,"geometry"),"box"),"size"," ".join(map(str,size)))
    m=ET.SubElement(v,"material")
    _child(m,"diffuse"," ".join(map(str,color))+" 1")
    _child(m,"ambient"," ".join(map(str,color))+" 1")
    _child(v,"cast_shadows","true")
    return v
def _decorations(world):
    details=ET.SubElement(world,"model",name="office_damage_details")
    _child(details,"static","true");_child(details,"pose","0 0 0 0 0 0")
    link=ET.SubElement(details,"link",name="structure")
    # Slightly sagging sheets overlap the intact roof. No missing roof or new obstacle.
    _add_box(link,"sagging_tile_front",(-2.1,2.7,2.72,.14,-.045,.015),(.565,.565,.016),(.70,.685,.64))
    _add_box(link,"sagging_tile_workstation",(-4.5,.5,2.72,-.11,.08,-.018),(.56,.565,.016),(.64,.625,.575))
    return details

def _next_pow2(value):return 2**math.ceil(math.log2(max(16,value)))
def atlas_layout(faces,kind):
    """Tight shelves with tiny caps and bounded resolution, not six square textures."""
    rectangles=[]
    density=150 if kind in ("furniture","screen","fixture") else 70
    for name,points,normal in faces:
        w,h=_norm(_sub(points[1],points[0])),_norm(_sub(points[3],points[0]))
        scale=min(density,1008/max(w,h))
        if kind=="ceiling" and name!="bottom":scale=min(scale,40/max(w,h))
        rectangles.append([name,max(8,math.ceil(w*scale)),max(8,math.ceil(h*scale))])
    target=min(1024,_next_pow2(max(max(r[1]+4 for r in rectangles),math.sqrt(sum((r[1]+4)*(r[2]+4) for r in rectangles))*1.1)))
    for attempt in range(12):
        x=y=row_height=0;result={}
        for name,w,h in sorted(rectangles,key=lambda r:r[2],reverse=True):
            if x+w+4>target:x=0;y+=row_height;row_height=0
            result[name]=[x+2,y+2,w,h];x+=w+4;row_height=max(row_height,h+4)
        height=_next_pow2(y+row_height)
        if height<=1024:return [target,height],result
        rectangles=[[n,max(8,int(w*.82)),max(8,int(h*.82))] for n,w,h in rectangles]
    raise ValueError("DAMAGE_ATLAS_BUDGET")
def _near_burning_wall(model):
    c=model.find("./link/collision/geometry/box/size")
    if c is None:return False
    points=[_transform(point,[_pose(model)]) for _,face,_ in box_faces(list(map(float,c.text.split()))) for point in face]
    lo=[min(p[i] for p in points) for i in range(3)]
    hi=[max(p[i] for p in points) for i in range(3)]
    return (lo[1]<3.81 and hi[1]>3.68 and lo[0]<-1.8<hi[0] and hi[0]-lo[0]>.5
      or lo[0]<4.5 and hi[0]>4.33 and lo[1]<-.50<hi[1] and hi[1]-lo[1]>.3)

def apply_office_damage(world,out):
    """Apply authored damage after office architecture, glazing and lintels."""
    out=Path(out).resolve()
    if not out.is_relative_to(ROOT):raise ValueError("DAMAGE_OUTPUT_OUTSIDE_WORKSPACE")
    out.mkdir(parents=True,exist_ok=True)
    if world.find("model[@name='office_damage_details']") is not None:
        raise ValueError("OFFICE_DAMAGE_ALREADY_APPLIED")
    before=_fingerprint(world,"collision")
    doors={m.get("name"):ET.tostring(m) for m in world.findall("model") if m.get("name","").startswith("door_")}
    assets=out/"office-damage-assets";assets.mkdir(exist_ok=True)
    meshes=out/"office-damage-meshes";meshes.mkdir(exist_ok=True)
    specs=[];affected=[];atlases=[]
    _decorations(world)
    damaged_fixture_names={"light_panel_1_2","light_panel_0_1"}
    for model in world.findall("model"):
        name=model.get("name","")
        kind=("plaster" if name.startswith("wall_") or name.startswith("office_lintel_") else
              "ceiling" if name in ("office_ceiling","office_damage_details") else
              "furniture" if name=="office_workstation_6" else
              "fixture" if name=="office_ceiling_fixtures" else None)
        if kind is None:continue
        if kind=="plaster" and not _near_burning_wall(model):continue
        for link in model.findall("link"):
            for visual in list(link.findall("visual")):
                vname=visual.get("name","")
                if kind=="furniture" and vname not in {"white_desk","green_divider","chair_seat","chair_back","monitor_bezel","lcd_display"}:continue
                if kind=="fixture" and vname not in damaged_fixture_names:continue
                poses=[_pose(model),_pose(link),_pose(visual)]
                # Failed fixture covers are still attached to their original mount.
                if kind=="fixture" and vname=="light_panel_1_2":
                    poses[-1][2]-=.036;poses[-1][3]=.085
                    node=visual.find("pose");node.text=" ".join(map(str,poses[-1]))
                size=visual.findtext("geometry/box/size")
                if size is None:
                    c=link.find("collision[@name='"+vname+"_collision']/geometry/box/size")
                    if c is None and kind=="plaster":c=link.find("collision/geometry/box/size")
                    if c is not None:size=c.text
                if size is None and vname!="lcd_display":continue
                faces=box_faces([float(v) for v in size.split()]) if size else [
                    ("screen",[(-.25,0,-.145),(.25,0,-.145),(.25,0,.145),(-.25,0,.145)],(0,-1,0))]
                basecolor=[float(v) for v in visual.findtext("material/diffuse",".72 .72 .68 1").split()[:3]]
                basepath=visual.findtext("material/pbr/metal/albedo_map")
                if vname=="lcd_display":basecolor=[.065,.07,.069];basepath=None
                group=name+"__"+vname
                atlas_size,rects=atlas_layout(faces,"screen" if vname=="lcd_display" else kind)
                mesh=meshes/(group+".dae")
                vertices=[];normals=[];uvs=[];triangles=[]
                for fname,points,normal in faces:
                    start=len(vertices);vertices.extend(points);normals.extend([normal]*4)
                    x,y,w,h=rects[fname];aw,ah=atlas_size
                    u0,u1=(x+.5)/aw,(x+w-.5)/aw
                    v0,v1=1-(y+h-.5)/ah,1-(y+.5)/ah
                    uvs.extend([(u0,v0),(u1,v0),(u1,v1),(u0,v1)])
                    triangles.extend([(start,start+1,start+2),(start,start+2,start+3)])
                    worldpoints=[_transform(p,poses) for p in points]
                    specs.append({"id":group+"__"+fname,"atlas":group,"atlas_rect":rects[fname],
                      "kind":"screen" if vname=="lcd_display" else kind,
                      "model":name,"visual":vname,"face":fname,
                      "origin":worldpoints[0],"u":_sub(worldpoints[1],worldpoints[0]),
                      "v":_sub(worldpoints[3],worldpoints[0]),"normal":_transform(normal,poses,True),
                      "base_color":basecolor,"base_texture":basepath,
                      "material_scale_m":.6 if kind=="ceiling" else .8,
                      "mesh":str(mesh),"opaque":True})
                collada(mesh,vertices,normals,uvs,triangles)
                set_mesh(visual,mesh)
                for old in list(visual.findall("material")):visual.remove(old)
                visual.append(_material(assets/group))
                atlases.append({"id":group,"size":atlas_size,"faces":[group+"__"+f[0] for f in faces]})
                affected.append(name+"/"+vname)
    spec={"schema":"agnes.office-damage-bake.v1","zones":BURN_ZONES,"surfaces":specs,"atlases":atlases}
    (out/"office-damage-surfaces.json").write_text(json.dumps(spec,indent=2)+"\n")
    proc=subprocess.run([str(PYTHON),"-B",str(GENERATOR),"--spec",str(out/"office-damage-surfaces.json"),"--out",str(assets)],
      cwd=ROOT,capture_output=True,text=True,timeout=120)
    if proc.returncode:raise RuntimeError("OFFICE_DAMAGE_BAKE_FAILED:"+proc.stderr[-1800:])
    bake=json.loads((assets/"manifest.json").read_text())
    assert before==_fingerprint(world,"collision"),"OFFICE_DAMAGE_CHANGED_COLLISIONS"
    assert all(doors[m.get("name")]==ET.tostring(m) for m in world.findall("model") if m.get("name","").startswith("door_")),"OFFICE_DAMAGE_CHANGED_DOORS"
    manifest={"schema":"agnes.office-damage.v1","source":"Project-authored deterministic procedural PBR; no generated-model or third-party assets",
      "zones":BURN_ZONES,"mapping":"One opaque atlas mesh per existing visual; each face is evaluated in world coordinates. No repeated scorch decal.",
      "affected_original_visuals":affected,"surface_count":len(specs),"atlas_count":len(atlases),"texture_count":len(bake["files"]),
      "estimated_rgba_gpu_bytes":sum(a["size"][0]*a["size"][1]*4*3 for a in atlases),
      "added_visuals":2,
      "collision_sha256_before":before,"collision_sha256_after":_fingerprint(world,"collision"),
      "door_models_unchanged":True,"new_collision_count":0,"ground_debris":0,
      "sagging_ceiling_tiles":2,"minimum_decorative_clearance_m":2.66,"black_overlay_planes":0,
      "materials":["existing plaster/acoustic tile/furniture colors","graded warm-gray soot","local peeling/crack normal","rough ash and char"],
      "asset_manifest":str(assets/"manifest.json"),"generator":"simulation/visual_assets/office_damage_generate.py",
      "source_hashes":{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),GENERATOR]}}
    (out/"office-damage.json").write_text(json.dumps(manifest,indent=2)+"\n")
    return manifest
