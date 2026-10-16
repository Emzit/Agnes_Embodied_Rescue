"""Deterministic authored PNG textures/meshes; NumPy from the project ROS env.
Run: runtime/ros2-jazzy/.pixi/envs/default/bin/python -B simulation/visual_assets/generate_assets.py
No downloaded assets, third-party models, or generated human identities.
"""
from pathlib import Path
import sys,json,struct,zlib,hashlib
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from simulation.visual_assets.scene_style import sphere_mesh,torso_mesh
OUT=ROOT/'simulation/visual_assets'
N=768
rng=np.random.default_rng(20261012)
def png(path,array):
    a=np.ascontiguousarray(np.clip(array*255,0,255).astype(np.uint8))
    if a.ndim==2:a=np.repeat(a[:,:,None],3,axis=2)
    h,w,c=a.shape
    assert c==3
    def chunk(tag,data):
        return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    raw=b''.join(b'\0'+row.tobytes() for row in a)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,8))+chunk(b'IEND',b''))
def noise(cells):
    grid=rng.normal(size=(cells,cells))
    f=np.arange(N)/N*cells;i=f.astype(int);w=f-i
    # Smooth interpolation makes continuous pores, stains and stone grain.
    w=w*w*(3-2*w)
    a=grid[i[:,None]%cells,i[None,:]%cells]
    b=grid[(i[:,None]+1)%cells,i[None,:]%cells]
    c=grid[i[:,None]%cells,(i[None,:]+1)%cells]
    d=grid[(i[:,None]+1)%cells,(i[None,:]+1)%cells]
    return (a*(1-w[:,None])+b*w[:,None])*(1-w[None,:])+(c*(1-w[:,None])+d*w[:,None])*w[None,:]
Y,X=np.mgrid[0:N,0:N]/N
fine=rng.normal(size=(N,N));cloud=noise(8);grain=noise(96)
def save_maps(name,albedo,height,roughness,strength=4):
    dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*strength
    dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*strength
    normals=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1)
    normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
    png(OUT/'textures'/f'{name}_albedo.png',albedo)
    png(OUT/'textures'/f'{name}_normal.png',(normals+1)/2)
    png(OUT/'textures'/f'{name}_roughness.png',roughness)
(OUT/'textures').mkdir(exist_ok=True)
# Sandstone blocks: 0.6 x 0.3 m, alternating joints, granular/weathered surface.
row=(Y*4).astype(int)
u=(X*2+(row%2)*.5)%1;v=(Y*4)%1
edge=np.minimum.reduce([u,1-u,v,1-v])
grout=np.clip((.018-edge)/.018,0,1)
bevel=np.clip(edge/.04,0,1)
palette=np.array([[.56,.48,.38],[.63,.55,.43],[.58,.51,.42],[.66,.58,.46]])
variation=palette[(row*3+(X*2+(row%2)*.5).astype(int))%4]
mottle=(.029*cloud+.017*grain+.012*fine)[:,:,None]
albedo=variation+mottle
albedo=albedo*(1-grout[:,:,None]) + np.array([.30,.29,.26])*grout[:,:,None]
# Sparse lichen staining remains in the albedo, not geometric obstacles.
stain=np.clip(-cloud-1,.0,.8)*.055
albedo-=stain[:,:,None]*np.array([.8,.5,.9])
save_maps('wall',albedo,.16*bevel+.025*grain+.006*fine,.83+.025*cloud+.025*fine,5)
# Worn stone paving: 0.6 m joints, slight slab tone variation and mineral pores.
u=(X*2)%1;v=(Y*2)%1;edge=np.minimum.reduce([u,1-u,v,1-v])
grout=np.clip((.007-edge)/.007,0,1)
shade=np.array([[.43,.45],[.46,.42]])[(Y*2).astype(int),(X*2).astype(int)]
albedo=shade[:,:,None]*np.array([1.05,1.01,.94])+(.019*cloud+.01*grain+.007*fine)[:,:,None]
albedo=albedo*(1-grout[:,:,None])+np.array([.23,.23,.22])*grout[:,:,None]
save_maps('floor',albedo,.1*np.clip(edge/.024,0,1)+.011*grain+.003*fine,.76+.025*grain,4)
# Cloth/weave, trousers, skin pores, leather and neutral facial detail.
weave=.5*(np.sin(X*N*np.pi/2)*np.sin(Y*N*np.pi/2))
for name,color,rough in [('cloth',[.15,.25,.31],.91),('trousers',[.105,.12,.14],.93),('skin',[.68,.47,.34],.69),('leather',[.065,.055,.045],.71),('detail',[.96,.96,.96],.8)]:
    fabric=name in ['cloth','trousers']
    texture=(.014*weave+.008*grain) if fabric else (.005*fine+.008*cloud)
    albedo=np.array(color)+texture[:,:,None]
    save_maps(name,albedo,.013*weave if fabric else .003*fine,np.ones_like(X)*rough+.012*grain,2)
(OUT/'meshes').mkdir(exist_ok=True)
sphere_mesh(OUT/'meshes/sphere.dae')
torso_mesh(OUT/'meshes/torso.dae')
files=sorted([*OUT.glob('textures/*.png'),*OUT.glob('meshes/*.dae')])
manifest={'asset_source':'Project-authored deterministic geometry and procedural surface textures','generator':'simulation/visual_assets/generate_assets.py','seed':20261012,'third_party_assets':[],'texture_resolution':[N,N],'human_identity':'generic schematic adult; no real person scan or likeness','files':[{'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in files]}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'pass':True,'files':len(files),'bytes':sum(p.stat().st_size for p in files)}))
