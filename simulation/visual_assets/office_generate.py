"""Authored office surface textures. Only NumPy from the bundled ROS environment."""
from pathlib import Path
import hashlib,json,struct,zlib
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'simulation/visual_assets/office_textures'
N=512
rng=np.random.default_rng(20261012)
Y,X=np.mgrid[:N,:N]/N
def png(path,array):
    a=np.ascontiguousarray(np.clip(array*255,0,255).astype(np.uint8))
    if a.ndim==2:a=np.repeat(a[:,:,None],3,axis=2)
    h,w,c=a.shape
    def chunk(tag,data):
        return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    raw=b''.join(b'\0'+row.tobytes() for row in a)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2 if c==3 else 6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,7))+chunk(b'IEND',b''))
def save(name,color,height,rough,strength=2):
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))*strength
    dy=(np.roll(height,-1,0)-np.roll(height,1,0))*strength
    normal=np.stack((-dx,-dy,np.ones_like(dx)),axis=-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    png(OUT/(name+'_albedo.png'),color)
    png(OUT/(name+'_normal.png'),(normal+1)/2)
    png(OUT/(name+'_roughness.png'),np.ones((N,N))*rough)
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    fine=rng.normal(0,1,(N,N))
    pores=rng.random((N,N))
    plaster=.80+.007*fine+.003*np.sin(X*37)*np.sin(Y*23)
    save('plaster',plaster[:,:,None]*np.array([1.015,1.01,.985]),fine*.0017,.92,1.5)
    # 600 mm ceiling panels, subtle pinholes and a slim shadow at each grid edge.
    edge=np.minimum.reduce([X,1-X,Y,1-Y])
    joint=np.clip((.009-edge)/.006,0,1)
    dots=np.where(pores<.012,-.045,0)
    ceiling=(.76+.004*fine+dots)*(1-joint)+.40*joint
    save('ceiling',ceiling[:,:,None]*np.array([1.01,1.01,1]),.006*fine-.08*joint,.96,2)
    # Commercial gray striped loop-pile carpet tiles: small fibres, no stone seams.
    tilex=(X*2).astype(int);tiley=(Y*2).astype(int)
    direction=(tilex+tiley)%2
    stripes=np.where(direction==0,np.sin(X*N*.45),np.sin(Y*N*.45))
    weave=np.sin(X*N*1.12)*np.sin(Y*N*1.27)
    carpet=.285+.016*stripes+.009*weave+.012*fine+.008*np.sin(X*87+Y*13)
    join=np.minimum.reduce([(X*2)%1,1-(X*2)%1,(Y*2)%1,1-(Y*2)%1])
    carpet-=.018*np.clip((.005-join)/.005,0,1)
    save('carpet',carpet[:,:,None]*np.array([1.025,1.01,.97]),.006*weave+.003*fine,.99,2)
    # LCD content is an original generic office layout, containing no real content.
    screen=np.zeros((N,N,3))+.018
    screen[25:482,20:492]=[.76,.81,.82]
    screen[25:64,20:492]=[.07,.21,.27]
    screen[70:482,20:92]=[.12,.18,.21]
    for yy in range(100,440,28):
        screen[yy:yy+5,116:428]=[.38,.46,.48]
        screen[yy+9:yy+12,116:320]=[.54,.60,.61]
    png(OUT/'screen.png',screen)
    files=sorted(OUT.glob('*.png'))
    (ROOT/'simulation/visual_assets/office_manifest.json').write_text(json.dumps({
      'source':'Project-authored geometry and deterministic procedural textures',
      'reference':'User-supplied office walkthrough; no video frames used as texture assets',
      'third_party_assets':[],'generator':'simulation/visual_assets/office_generate.py',
      'seed':20261012,'resolution':[N,N],
      'files':[{'path':str(f.relative_to(ROOT)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in files]
    },indent=2)+'\n')
    print(json.dumps({'textures':len(files),'bytes':sum(f.stat().st_size for f in files)}))
if __name__=='__main__':main()
