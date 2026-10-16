"""Deterministic world-space heat/soot PBR atlas baker, NumPy + standard library.

No external media, model calls, transparent decals, or baked black holes.
Each pixel samples its actual world point on the existing surface.
"""
from pathlib import Path
import argparse, hashlib, json, math, struct, zlib
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
SEED=20261013
_TEXTURES={}
def png(path,array):
    a=np.ascontiguousarray(np.rint(np.clip(array,0,1)*255).astype(np.uint8))
    if a.ndim==2:a=np.repeat(a[:,:,None],3,axis=2)
    h,w,c=a.shape
    assert c==3
    def chunk(tag,data):return struct.pack(">I",len(data))+tag+data+struct.pack(">I",zlib.crc32(tag+data)&0xffffffff)
    raw=b"".join(b"\0"+row.tobytes() for row in a)
    path.write_bytes(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw,6))+chunk(b"IEND",b""))
def read_png(path):
    key=str(path)
    if key in _TEXTURES:return _TEXTURES[key]
    data=Path(path).read_bytes();assert data[:8]==b"\x89PNG\r\n\x1a\n"
    offset=8;packed=b""
    while offset<len(data):
        n=struct.unpack(">I",data[offset:offset+4])[0];tag=data[offset+4:offset+8];payload=data[offset+8:offset+8+n];offset+=12+n
        if tag==b"IHDR":w,h,depth,color,comp,filt,inter=struct.unpack(">IIBBBBB",payload)
        if tag==b"IDAT":packed+=payload
    assert depth==8 and color in (2,6) and inter==0
    channels=3 if color==2 else 4;stride=w*channels
    raw=zlib.decompress(packed);rows=np.empty((h,stride),dtype=np.uint8)
    for y in range(h):
        f=raw[y*(stride+1)];row=np.frombuffer(raw[y*(stride+1)+1:(y+1)*(stride+1)],dtype=np.uint8).copy()
        previous=rows[y-1] if y else np.zeros(stride,dtype=np.uint8)
        if f==2:row=(row.astype(np.uint16)+previous)%256
        elif f!=0:
            for x in range(stride):
                a=int(row[x-channels]) if x>=channels else 0;b=int(previous[x]);c=int(previous[x-channels]) if x>=channels else 0
                if f==1:predict=a
                elif f==3:predict=(a+b)//2
                elif f==4:
                    q=a+b-c;pa,pb,pc=abs(q-a),abs(q-b),abs(q-c);predict=a if pa<=pb and pa<=pc else b if pb<=pc else c
                else:raise ValueError("UNSUPPORTED_PNG_FILTER")
                row[x]=(int(row[x])+predict)%256
        rows[y]=row
    result=rows.reshape(h,w,channels)[:,:,:3].astype(np.float32)/255
    _TEXTURES[key]=result;return result
def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def turbulence(x,y,z):
    # Incommensurate world wavelengths avoid identical rectangular repeat patches.
    return (np.sin(x*2.13+y*.74+z*1.91)+.57*np.sin(x*5.71-y*3.29+z*4.7)
      +.29*np.sin(x*12.3+y*9.81-z*7.17)+.14*np.sin(x*27.7-y*19.4+z*11.3))/2
def fields(points,normal,kind,zones):
    x,y,z=points
    noise=turbulence(x,y,z)
    heat=np.zeros_like(x);soot=np.zeros_like(x)
    for zone in zones:
        cx,cy,cz=zone["center"];rx,ry,rz=zone["radius"]
        if zone["surface"]=="north_wall":
            facing=max(0,-normal[1])
            along=(x-cx+.09*np.sin(z*4.7))/rx
            distance=(y-3.725)/.19
            upper=smooth(.5,2.65,z)
            local=np.exp(-1.8*(along**2+distance**2+((z-cz)/rz)**2))*facing
            plume=np.exp(-((x-cx)/(.50+.31*np.maximum(z-.65,0)))**2-distance**2)*smooth(.6,1.6,z)*facing
        elif zone["surface"]=="east_wall":
            facing=max(0,-normal[0])
            along=(y-cy+.045*np.sin(z*5.1))/ry
            distance=(x-4.425)/.19
            local=np.exp(-1.8*(along**2+distance**2+((z-cz)/rz)**2))*facing
            plume=np.exp(-((y-cy)/(.22+.10*np.maximum(z-.7,0)))**2-distance**2)*smooth(.7,1.8,z)*facing
        else:
            if kind not in ("furniture","screen"):continue
            local=np.exp(-1.4*(((x-cx)/rx)**2+((y-cy)/ry)**2+((z-cz)/rz)**2))
            plume=local*.55
        heat=np.maximum(heat,local)
        soot=np.maximum(soot,plume)
    if kind in ("ceiling","fixture"):
        # Ceiling surface is continuous; smoke fronts are soft horizontal streaks.
        seeds=[(-1.8,3.32,.90,1.1),(-1.72,2.60,.85,1.0),(-1.57,1.88,.72,.90),
               (4.08,-.46,.95,.62),(3.3,-.38,1.0,.64),
               (-4.4,.75,1.0,.85),(-3.7,1.05,.98,.8),(-3,1.35,.82,.67)]
        facing=max(0,-normal[2]) if kind=="ceiling" else 1
        for cx,cy,rx,ry in seeds:
            local=np.exp(-1.8*(((x-cx+.10*noise)/rx)**2+((y-cy)/ry)**2))*facing
            heat=np.maximum(heat,.88*local)
            soot=np.maximum(soot,np.exp(-.5*(((x-cx)/(rx*1.35))**2+((y-cy)/(ry*1.4))**2))*facing)
        soot=np.clip(soot*.86,0,1)
    # Broad upper staining is deliberately gray-brown and gradual, never a hole.
    if kind=="plaster":
        upper=smooth(1.72,2.78,z)
        warm_zone=np.maximum(np.exp(-((x+1.8)**2+(y-3.7)**2)/14),np.exp(-((x-4.35)**2+(y+.5)**2)/11))
        soot=np.maximum(soot,.38*upper*warm_zone)
    heat=np.clip(heat*(.9+.14*noise),0,1)
    soot=np.clip(soot*(.94+.08*noise),0,1)
    return heat,soot,noise
def fracture(u,v):
    # Warped Voronoi boundaries create a non-repeating fine crack/peel network.
    u=u*17+.18*np.sin(v*11);v=v*17+.15*np.sin(u*.7)
    ix=np.floor(u);iy=np.floor(v)
    first=np.full_like(u,1e9);second=np.full_like(u,1e9)
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            cx=ix+dx;cy=iy+dy
            hx=np.mod(np.sin(cx*127.1+cy*311.7+SEED)*43758.5453,1)
            hy=np.mod(np.sin(cx*269.5+cy*183.3+SEED*.3)*32719.174,1)
            d=(cx+hx-u)**2+(cy+hy-v)**2
            second=np.minimum(second,np.maximum(first,d));first=np.minimum(first,d)
    edge=np.sqrt(second)-np.sqrt(first)
    return 1-smooth(.014,.05,edge),smooth(.06,.24,np.sqrt(first))
def surface_maps(spec,zones):
    _,_,w,h=spec["atlas_rect"]
    uu=np.linspace(0,1,w,dtype=np.float32)[None,:]
    vv=np.linspace(1,0,h,dtype=np.float32)[:,None]
    origin=np.array(spec["origin"],np.float32);uvec=np.array(spec["u"],np.float32);vvec=np.array(spec["v"],np.float32)
    points=[origin[i]+uvec[i]*uu+vvec[i]*vv for i in range(3)]
    points=[np.broadcast_to(q,(h,w)) for q in points]
    x,y,z=points;normal=np.array(spec["normal"])
    heat,soot,noise=fields(points,normal,spec["kind"],zones)
    if spec.get("base_texture"):
        texture=read_png(spec["base_texture"])
        # Existing tile material uses physically sized UVs; damage itself never repeats.
        worldu=(x if abs(normal[2])>=.7 else x+.37*y);worldv=z if abs(normal[2])<.7 else y
        tx=np.floor(np.mod(worldu/spec["material_scale_m"],1)*texture.shape[1]).astype(int)
        ty=np.floor(np.mod(-worldv/spec["material_scale_m"],1)*texture.shape[0]).astype(int)
        base=texture[ty,tx].copy()
    else:base=np.ones((h,w,3),np.float32)*np.array(spec["base_color"],np.float32)
    if spec["kind"]=="ceiling":
        # Pixel coverage keeps 600 mm grid lines consistent at room-size resolution.
        du=max(np.linalg.norm(uvec)/(w-1),1e-5);dv=max(np.linalg.norm(vvec)/(h-1),1e-5)
        footprint=max(du,dv)
        edge=np.minimum(np.minimum(np.mod(x,.6),.6-np.mod(x,.6)),np.minimum(np.mod(y,.6),.6-np.mod(y,.6)))
        coverage=np.clip((footprint*.5+.003-edge)/footprint,0,1)
        base=np.ones((h,w,3),np.float32)*np.array([.769,.769,.762])
        base-=coverage[...,None]*.21
        base+=noise[...,None]*.002
    if spec["kind"]=="screen":
        base[:]=[.063,.067,.067]
    heat_tint=np.array([.49,.375,.235],np.float32)
    ash=np.array([.275,.25,.213],np.float32)
    char=np.array([.15,.133,.112],np.float32)
    # Several overlapping material changes, rather than multiplying by a black mask.
    rgb=base*(1-heat[...,None]*.38)+heat_tint*heat[...,None]*.38
    smoke_weight=np.clip(soot*.76,0,.78)
    rgb=rgb*(1-smoke_weight[...,None])+ash*smoke_weight[...,None]
    char_weight=smooth(.34,.88,heat)*(.30 if spec["kind"]=="ceiling" else .62)
    rgb=rgb*(1-char_weight[...,None])+char*char_weight[...,None]
    grain=np.mod(np.sin(x*121.1+y*311.7+z*74.7)*43758.5453,1)*2-1
    rgb+=grain[...,None]*(.003+.01*heat[...,None])
    su=x+.63*y+.27*z;sv=z+.33*x+.91*y
    crack,blister=fracture(su,sv)
    peel=smooth(.30,.76,heat)
    peeled=peel*blister*(.35+.15*np.sin(su*35+sv*27))
    # Lighter exposed plaster/ash within burned regions still shows surface structure.
    rgb+=peeled[...,None]*np.array([.11,.104,.092])
    rgb-=crack[...,None]*peel[...,None]*.041
    height=(grain*.000035+peeled*.0016-crack*peel*.00085)
    if spec["kind"]=="screen":
        damaged_line=crack*smooth(.1,.7,heat)
        rgb+=damaged_line[...,None]*.06;height-=damaged_line*.0005
    du=max(np.linalg.norm(uvec)/(w-1),1e-5);dv=max(np.linalg.norm(vvec)/(h-1),1e-5)
    gy,gx=np.gradient(height,dv,du)
    n=np.stack((-gx,gy,np.ones_like(gx)),axis=-1);n/=np.linalg.norm(n,axis=-1,keepdims=True)
    rough=np.clip(.86+.11*soot+.02*grain-.04*peeled,.74,.995)
    return np.clip(rgb,.018,.96),(n+1)/2,rough
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--spec",required=True);parser.add_argument("--out",required=True);args=parser.parse_args()
    specfile=Path(args.spec).resolve();out=Path(args.out).resolve()
    if not specfile.is_relative_to(ROOT) or not out.is_relative_to(ROOT):raise ValueError("DAMAGE_PATH_OUTSIDE_PROJECT")
    spec=json.loads(specfile.read_text());out.mkdir(parents=True,exist_ok=True)
    surfaces={s["id"]:s for s in spec["surfaces"]};files=[]
    for atlas in spec["atlases"]:
        w,h=atlas["size"]
        channels=[np.ones((h,w,3),np.float32)*[.75,.74,.72],
                  np.ones((h,w,3),np.float32)*[.5,.5,1],
                  np.ones((h,w),np.float32)*.95]
        for ident in atlas["faces"]:
            surf=surfaces[ident];x,y,fw,fh=surf["atlas_rect"]
            rendered=surface_maps(surf,spec["zones"])
            for canvas,patch in zip(channels,rendered):
                # Two-pixel duplicated gutters prevent sampling neighboring faces.
                pad=((2,2),(2,2))+(((0,0),) if patch.ndim==3 else ())
                canvas[y-2:y+fh+2,x-2:x+fw+2]=np.pad(patch,pad,mode="edge")
        for suffix,array in zip(("albedo","normal","roughness"),channels):
            path=out/(atlas["id"]+"_"+suffix+".png");png(path,array)
            files.append({"path":str(path),"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"bytes":path.stat().st_size,"width":w,"height":h})
    manifest={"source":"Project-authored procedural PBR; sampled existing project office textures; no third-party or model-generated assets",
      "generator":"simulation/visual_assets/office_damage_generate.py","seed":SEED,"opaque_rgb_only":True,
      "world_coordinate_damage":True,"spec_sha256":hashlib.sha256(specfile.read_bytes()).hexdigest(),
      "atlas_count":len(spec["atlases"]),"files":files}
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"atlases":len(spec["atlases"]),"textures":len(files),"bytes":sum(f["bytes"] for f in files)}))
if __name__=="__main__":main()
