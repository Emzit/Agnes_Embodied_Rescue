"""Read-only preview of the canonical classic SDF walls and semantic room registry."""
from pathlib import Path
import json,math,hashlib,xml.etree.ElementTree as ET
R=Path('/data-ssd/zhongchengkai/agnes');F=R/'simulation/scenarios/layout_c';world=F/'world.sdf';registry=F/'world_registry.json'
def geometry():
 locations=json.loads(registry.read_text())['locations'];walls=[];xs=[];ys=[]
 for model in ET.parse(world).getroot().find('world').findall('model'):
  if not model.get('name','').startswith('wall_'):continue
  pose=list(map(float,model.findtext('pose','0 0 0 0 0 0').split()));size=list(map(float,model.findtext('link/collision/geometry/box/size').split()));x,y=pose[:2];yaw=pose[5];theta=yaw+(math.pi/2 if size[1]>size[0]else 0);length=max(size[:2]);thickness=min(size[:2]);dx,dy=math.cos(theta)*length/2,math.sin(theta)*length/2
  walls.append({'id':model.get('name'),'a':[x-dx,y-dy],'b':[x+dx,y+dy],'thickness':thickness,'height':size[2]})
  for sx in [-1,1]:
   for sy in [-1,1]:xs.append(x+sx*size[0]/2*math.cos(yaw)-sy*size[1]/2*math.sin(yaw));ys.append(y+sx*size[0]/2*math.sin(yaw)+sy*size[1]/2*math.cos(yaw))
 rooms=[];corridors=[];starts=[]
 for loc in locations:
  b=loc['bounds'];xs.extend([b['min_x'],b['max_x']]);ys.extend([b['min_y'],b['max_y']])
  area={'id':loc['id'],'name':loc['name'],'bounds':b}
  if loc['type']=='room':rooms.append(area)
  elif loc['type']=='corridor':corridors.append(area)
  elif loc['type']=='start':starts.append({'id':loc['id'],**{k:loc['pose'][k]for k in ['x','y','yaw']}});corridors.append({**area,'name':'起点'})
 assert walls and rooms and starts
 return {'boundary':{'min_x':min(xs)-.3,'max_x':max(xs)+.3,'min_y':min(ys)-.3,'max_y':max(ys)+.3},'walls':walls,'rooms':rooms,'corridors':corridors,'doors':[],'start_poses':starts,'static_obstacles':[]}
if __name__=='__main__':print(json.dumps({'geometry':geometry(),'metadata':{'id':'layout_c','source':'canonical classic world.sdf and world_registry.json','world_sha256':hashlib.sha256(world.read_bytes()).hexdigest(),'registry_sha256':hashlib.sha256(registry.read_bytes()).hexdigest()}},ensure_ascii=False))
