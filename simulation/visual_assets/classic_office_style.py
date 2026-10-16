"""Share office plaster/carpet PBR finishes with the canonical classic layout.
Only render meshes, materials and shadow flags change. The office person model
is already shared by dynamic_scenario.person_links in every layout.
"""
from pathlib import Path
import json,hashlib,xml.etree.ElementTree as ET
from simulation.visual_assets.scene_style import ROOT,box_mesh,collada,set_mesh,replace_material
from simulation.visual_assets.office_scene import textured

def apply_classic_office_finishes(world,out):
 out=Path(out).resolve()
 if not out.is_relative_to(ROOT):raise ValueError('MATERIAL_OUTPUT_OUTSIDE_PROJECT')
 meshes=out/'office-finish-meshes';meshes.mkdir(parents=True,exist_ok=True);changed=[]
 for model in world.findall('model'):
  name=model.get('name','')
  if name=='ground':
   mesh=meshes/'office_carpet.dae'
   collada(mesh,[(-50,-50,.002),(50,-50,.002),(50,50,.002),(-50,50,.002)],[(0,0,1)]*4,[(0,0),(100/1.2,0),(100/1.2,100/1.2),(0,100/1.2)],[(0,1,2),(0,2,3)])
   kind='carpet'
  elif name.startswith('wall_'):
   size=list(map(float,model.findtext('link/collision/geometry/box/size').split()));mesh=meshes/(name+'.dae');box_mesh(mesh,size,tile=1.2);kind='plaster'
  else:continue
  for visual in model.findall('./link/visual'):
   set_mesh(visual,mesh)
   for node in visual.findall('cast_shadows'):visual.remove(node)
   replace_material(visual,textured(kind));changed.append({'model':name,'material':kind,'mesh':str(mesh.relative_to(ROOT))})
 scene=world.find('scene')
 if scene is not None:
  node=scene.find('shadows')
  if node is None:node=ET.SubElement(scene,'shadows')
  node.text='true'
 sun=world.find("light[@name='sun']")
 if sun is not None:
  node=sun.find('cast_shadows')
  if node is None:node=ET.SubElement(sun,'cast_shadows')
  node.text='true'
 if not any(x['model']=='ground'for x in changed)or not any(x['model'].startswith('wall_')for x in changed):raise ValueError('CLASSIC_GROUND_AND_WALLS_REQUIRED')
 textures=[]
 for kind in ['plaster','carpet']:
  for suffix in ['albedo','normal','roughness']:
   path=ROOT/'simulation/visual_assets/office_textures'/f'{kind}_{suffix}.png';textures.append({'path':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
 return {'materials':'Exact shared office plaster/carpet PBR maps','changed_visuals':changed,'textures':textures,'person_materials':'Existing shared person_links()','collision_changes':False,'navigation_map_changes':False,'geometry_layout_changes':False,'third_party_assets':[]}

if __name__=='__main__':
 assert Path.cwd()==ROOT
 target=ROOT/'simulation/scenarios/layout_c/world.sdf';tree=ET.parse(target);report=apply_classic_office_finishes(tree.getroot().find('world'),target.parent)
 temporary=target.with_suffix('.sdf.tmp');temporary.write_text(ET.tostring(tree.getroot(),encoding='unicode'));temporary.replace(target)
 report['world_sha256']=hashlib.sha256(target.read_bytes()).hexdigest();(target.parent/'office-finish-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'styled_visuals':len(report['changed_visuals']),'shared_textures':len(report['textures'])}))
