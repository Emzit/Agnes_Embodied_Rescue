"""Authored office fire v2 sprites: turbulent tongues and horizontal ceiling rolls.

Uses project NumPy only. Reference images guide shape/color, never copied pixels.
The visuals do not model combustion or thermal/evacuation physics.
"""
from pathlib import Path
import hashlib,json,struct,zlib
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'simulation/visual_assets/office_fire_textures'
SEED=2026101222
N=512
Y,X=np.mgrid[:N,:N]/(N-1)
XX=X*2-1
YY=Y*2-1

def png(path,array):
    a=np.ascontiguousarray(np.clip(array*255,0,255).astype(np.uint8))
    h,w,c=a.shape
    def chunk(tag,data):
        return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    raw=b''.join(b'\0'+row.tobytes() for row in a)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,8))+chunk(b'IEND',b''))

def noise(rng,cells):
    grid=rng.normal(size=(cells+1,cells+1))
    f=np.arange(N)/(N-1)*(cells-.00001)
    i=f.astype(int);t=f-i;t=t*t*(3-2*t)
    return ((grid[i[:,None],i[None,:]]*(1-t[:,None])+grid[i[:,None]+1,i[None,:]]*t[:,None])*(1-t[None,:])
          +(grid[i[:,None],i[None,:]+1]*(1-t[:,None])+grid[i[:,None]+1,i[None,:]+1]*t[:,None])*t[None,:])

def edge():
    return np.clip(np.minimum.reduce([X,1-X,Y,1-Y])*24,0,1)

def rgba_fire(alpha,heat):
    heat=np.clip(heat,0,1)
    return np.stack([np.ones_like(X),.22+.78*heat**.63,.018+.79*heat**3.0,np.clip(alpha,0,.94)*edge()],axis=-1)

def wall(seed):
    rng=np.random.default_rng(seed)
    coarse,mid,fine=noise(rng,6),noise(rng,23),noise(rng,71)
    height=1-Y
    body=np.zeros_like(X);core=np.zeros_like(X)
    for j,cx in enumerate(np.linspace(-.61,.61,7)):
        top=rng.uniform(.52,.95);width=rng.uniform(.065,.14)
        t=height/top
        center=cx+.10*np.sin(t*rng.uniform(7,12)+rng.uniform(0,6))*(.2+t)+.035*mid
        radius=width*np.maximum(1-t,0)**.6+.01
        d=(XX-center)/radius
        gate=np.clip((1-t)*17,0,1)*np.clip(height*23,0,1)
        tongue=np.exp(-d*d*1.45)*gate
        # Narrow light filaments and torn gaps, rather than a solid repeated cone.
        torn=np.clip(.72+.42*coarse+.20*mid+.065*fine,.08,1.2)
        body+=tongue*torn
        core+=np.exp(-d*d*5.8)*gate*np.clip(1.1-.5*t+.28*mid,0,1)
    alpha=(1-np.exp(-body*1.65))*.88
    heat=np.clip(.30+core*.73+body*.12+.05*mid,0,1)
    return rgba_fire(alpha,heat)

def ceiling(seed):
    rng=np.random.default_rng(seed)
    coarse,mid,fine=noise(rng,5),noise(rng,20),noise(rng,65)
    body=np.zeros_like(X);core=np.zeros_like(X)
    # Broken curved ribbons and vortex arcs: oriented laterally under the roof.
    for j in range(5):
        base=rng.uniform(.28,.73);freq=rng.uniform(4.5,9);phase=rng.uniform(0,6)
        center=base+.13*np.sin(X*freq+phase)+.05*np.sin(X*18+phase)+.018*mid
        width=rng.uniform(.032,.080)*(1+.25*coarse)
        d=(Y-center)/np.maximum(width,.015)
        gate=np.clip(1.1-np.abs(XX-rng.uniform(-.2,.2))**2,0,1)
        broken=np.clip(.67+.42*coarse+.24*mid+.065*fine,.04,1.15)
        ribbon=np.exp(-d*d*1.2)*gate*broken
        body+=ribbon
        core+=np.exp(-d*d*5.5)*gate*broken
    for cx,cy,radius in [(-.37,.45,.31),(.36,.54,.25)]:
        dx=XX-cx;dy=(Y-cy)*1.55
        angle=np.arctan2(dy,dx)
        r=np.sqrt(dx*dx+dy*dy)
        curl=np.exp(-((r-radius-.035*np.sin(angle*3))/.035)**2)
        arc=np.clip(.5+.7*np.sin(angle+.4),0,1)
        body+=curl*arc*.6;core+=curl*arc*.18
    alpha=(1-np.exp(-body*.95))*.77
    heat=np.clip(.24+core*.45+body*.21,0,1)
    return rgba_fire(alpha,heat)

def ramp(name,stops):
    t=np.linspace(0,1,256)
    a=np.stack([np.interp(t,[s[0] for s in stops],[s[1][c] for s in stops]) for c in range(4)],axis=-1)
    png(OUT/name,a[None,:,:])

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for i,suffix in enumerate('abc'):png(OUT/f'wall_flame_{suffix}.png',wall(SEED+i*13))
    for i,suffix in enumerate('ab'):png(OUT/f'ceiling_roll_{suffix}.png',ceiling(SEED+100+i*29))
    rng=np.random.default_rng(SEED+500)
    coarse,mid,fine=noise(rng,5),noise(rng,16),noise(rng,48)
    radius=np.sqrt((XX+.09*mid)**2+(YY+.08*coarse)**2)
    soft=np.clip((1-radius)/.7,0,1)**1.7
    alpha=np.clip(soft*(.30+.13*coarse+.07*mid+.02*fine),0,.43)*edge()
    shade=np.clip(.57+.075*coarse+.040*mid+.012*fine,.31,.76)
    png(OUT/'smoke.png',np.stack([shade*1.05,shade,shade*.93,alpha],axis=-1))
    spark=np.exp(-(XX*XX*50+YY*YY*11))*edge()
    png(OUT/'spark.png',np.stack([np.ones_like(X),np.ones_like(X)*.81,np.ones_like(X)*.29,spark],axis=-1))
    ramp('flame_life.png',[(0,(1,1,.95,0)),(.08,(1,1,.96,.80)),(.34,(1,.98,.83,.91)),(.66,(1,.77,.38,.62)),(.9,(1,.46,.07,.18)),(1,(1,.25,.02,0))])
    # Gray/brown low-opacity billows, never an opaque black disk over a fire.
    ramp('smoke_life.png',[(0,(.8,.77,.72,0)),(.18,(.8,.76,.70,.40)),(.52,(.82,.79,.74,.31)),(.84,(.85,.83,.79,.14)),(1,(.9,.88,.84,0))])
    ramp('spark_life.png',[(0,(1,1,.8,0)),(.06,(1,.95,.6,.8)),(.5,(1,.65,.16,.62)),(1,(1,.2,.01,0))])
    files=sorted(OUT.glob('*.png'))
    meta={'schema':'agnes.office-fire-sprites.v2','source':'Project-authored deterministic procedural fire sprites','reference':'Three user-supplied fire reference images: asymmetric wall tongues, ceiling rollover and warm illumination; no reference pixels copied','generator':'simulation/visual_assets/office_fire_generate.py','seed':SEED,'third_party_assets':[],'models_called':[],'alpha':'RGBA with fully transparent borders; no soot/hole decal','files':[{'path':str(f.relative_to(ROOT)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files]}
    (OUT.parent/'office_fire_manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({'files':len(files),'bytes':sum(f.stat().st_size for f in files)}))
if __name__=='__main__':main()
