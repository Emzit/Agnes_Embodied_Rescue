"""Reproducible project-authored fire sprites; no downloaded or AI-generated assets.
Run with the project's NumPy environment, then normal map compilation is stdlib-only.
"""
from pathlib import Path
import json, struct, zlib, hashlib
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'simulation/visual_assets/fire_textures'
SEED = 2026101207
N = 512
rng = np.random.default_rng(SEED)

def png(path, pixels):
    a = np.ascontiguousarray(np.clip(pixels * 255, 0, 255).astype(np.uint8))
    h, w, channels = a.shape
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = b''.join(b'\0' + row.tobytes() for row in a)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if channels == 4 else 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 8)) + chunk(b'IEND', b''))

def noise(cells):
    grid = rng.normal(size=(cells, cells))
    f = np.arange(N) / N * cells
    i = f.astype(int)
    t = f - i
    t = t*t*(3-2*t)
    a = grid[i[:, None] % cells, i[None, :] % cells]
    b = grid[(i[:, None]+1) % cells, i[None, :] % cells]
    c = grid[i[:, None] % cells, (i[None, :]+1) % cells]
    d = grid[(i[:, None]+1) % cells, (i[None, :]+1) % cells]
    return (a*(1-t[:, None])+b*t[:, None])*(1-t[None, :]) + (c*(1-t[:, None])+d*t[:, None])*t[None, :]

def build():
    OUT.mkdir(exist_ok=True)
    yy, xx = np.mgrid[0:N, 0:N] / (N-1)
    x = xx*2-1
    y = yy*2-1
    coarse, medium, fine = noise(5), noise(18), noise(70)
    field = .65*coarse + .25*medium + .10*fine
    # Soft turbulent tongues, transparent at every edge; white/yellow hot core.
    # Billboards move continuously in Gazebo rather than swapping recorded video.
    h = 1-yy
    center = .11*np.sin(9*h) + .07*np.sin(21*h) + .04*medium
    width = .12 + .55*(1-h)**.7
    body = np.clip(1 - np.abs(x-center)/width + .20*field, 0, 1)
    alpha = body**1.5 * np.clip(h*18,0,1) * np.clip((1-h)*10,0,1)
    heat = np.clip(body*.85 + (1-h)*.30,0,1)
    red = np.ones_like(x)
    green = np.clip(.12 + heat*.82,0,1)
    blue = np.clip((heat-.58)*1.55,0,.56)
    png(OUT/'flame.png', np.stack([red,green,blue,alpha],axis=-1))
    # Multifrequency billows with a feathered edge, not a solid opaque sphere.
    radius = np.sqrt((x+.08*medium)**2+(y+.08*coarse)**2)
    edge = np.clip((1-radius)/.43,0,1)
    alpha = np.clip(edge**1.4*(.48+.18*coarse+.12*medium+.055*fine),0,.82)
    shade = np.clip(.38 + .065*coarse + .045*medium + .014*fine,.15,.61)
    png(OUT/'smoke.png',np.stack([shade*1.02,shade,shade*.97,alpha],axis=-1))
    spark = np.exp(-(x*x*28+y*y*7))*np.clip((1-np.maximum(abs(x),abs(y)))*7,0,1)
    png(OUT/'spark.png',np.stack([np.ones_like(x),np.ones_like(x)*.65,np.ones_like(x)*.17,spark],axis=-1))
    soot_alpha = np.clip((1-radius)*2.2+.14*field,0,1)*np.clip((1-radius)*8,0,1)
    soot = np.clip(.044+.022*field,.015,.12)
    png(OUT/'soot.png',np.stack([soot*1.15,soot,soot*.83,soot_alpha*.90],axis=-1))
    # Opaque charcoal for burnt timber. Narrow fissures glow at the hot fire base.
    grain = np.sin(xx*84+coarse*1.4) + .40*np.sin(xx*230+medium*2)
    cracks = np.clip((grain-1.04)*2.8,0,1)*np.clip(.8+.35*medium,0,1)
    char = np.clip(.045+.018*coarse+.014*medium+.004*fine,.01,.11)
    png(OUT/'charcoal.png',np.stack([char*1.16,char,char*.80],axis=-1))
    png(OUT/'embers.png',np.stack([cracks*.88,cracks*.21,cracks*.016],axis=-1))
    dx=np.roll(char,-1,axis=1)-np.roll(char,1,axis=1)
    dy=np.roll(char,-1,axis=0)-np.roll(char,1,axis=0)
    normal=np.stack([-dx*8,-dy*8,np.ones_like(x)],axis=-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    png(OUT/'charcoal_normal.png',(normal+1)/2)
    # Color/opacity evolves along life, sampled left to right by Gazebo.
    def ramp(name, stops):
        t=np.linspace(0,1,256)
        values=np.stack([np.interp(t,[p[0] for p in stops],[p[1][c] for p in stops]) for c in range(4)],axis=-1)
        png(OUT/name,values[None,:,:])
    ramp('flame_life.png',[(0,(1,1,.80,0)),(.10,(1,1,.88,.92)),(.45,(1,.83,.53,.82)),(.78,(1,.32,.05,.45)),(1,(.40,.04,0,0))])
    ramp('smoke_life.png',[(0,(.30,.28,.26,0)),(.12,(.35,.32,.30,.60)),(.5,(.65,.64,.63,.46)),(.82,(.8,.8,.8,.20)),(1,(.85,.85,.85,0))])
    ramp('spark_life.png',[(0,(1,1,.8,0)),(.08,(1,.9,.45,1)),(.5,(1,.55,.1,.8)),(1,(.4,.06,.01,0))])
    files=sorted(OUT.glob('*.png'))
    manifest={'source':'Project-authored deterministic procedural fire textures','generator':'simulation/visual_assets/fire_generate.py','seed':SEED,'third_party_assets':[],'models_called':[],'license':'Same license as this project; no external visual asset restrictions','files':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    (OUT.parent/'fire_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'generated':len(files),'bytes':sum(p.stat().st_size for p in files)}))

if __name__ == '__main__':
    build()
