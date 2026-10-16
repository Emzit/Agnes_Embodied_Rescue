"""Project-authored fuel fire and layered smoke sprites; no downloaded pixels."""
from pathlib import Path
import hashlib,json
import numpy as np
from simulation.visual_assets.office_fire_generate import png,noise,edge,rgba_fire,ceiling,X,Y,XX,YY
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'simulation/visual_assets/office_fire_v3_textures'
SEED=2026101303

def smooth(value):
    value=np.clip(value,0,1)
    return value*value*(3-2*value)

def soften_fire(pixels,seed,ceiling_roll=False):
    """Feather the silhouette and remove luminous RGB from transparent texels.

    A broad warped envelope prevents a dense group of billboards from revealing
    a straight sprite edge. Black transparent guard texels also keep filtered
    emissive samples from leaking a rectangular glow around the fire.
    """
    rng=np.random.default_rng(seed+700)
    coarse,detail=noise(rng,5),noise(rng,13)
    guard=.028
    widths=.125+.023*np.sin(Y*11+seed)+.012*detail
    left=smooth((X-guard-.012*np.sin(Y*9+seed))/widths)
    right=smooth((1-X-guard-.012*np.sin(Y*12+seed*.7))/widths)
    top=smooth((Y-guard-.011*np.sin(X*13+seed))/.12)
    bottom=smooth((1-Y-guard-.011*np.sin(X*11+seed*.3))/.13)
    envelope=left*right*top*bottom
    if ceiling_roll:
        # An uneven rounded roll, rather than horizontal ribbons cut by a box.
        radius=np.sqrt(((XX+.035*detail)/1.02)**2+
                       ((YY+.055*coarse)/1.10)**2)
        envelope*=smooth((1.14-radius)/.32)
    # Guaranteed transparent padding is wide enough to survive minification.
    envelope=np.where(np.minimum.reduce([X,1-X,Y,1-Y])<.016,0,envelope)
    result=pixels.copy()
    result[:,:,3]*=envelope
    alpha=result[:,:,3]
    # Keep the hot body unchanged; extinguish color in almost transparent gaps.
    result[:,:,:3]*=smooth(alpha/.18)[:,:,None]
    result[alpha<1/255]=0
    return result

def flame(seed,core=False):
    rng=np.random.default_rng(seed)
    low,mid,fine=noise(rng,5),noise(rng,19),noise(rng,59)
    h=1-Y
    body=np.zeros_like(X);hot=np.zeros_like(X)
    for cx in np.linspace(-.51,.51,4):
        top=rng.uniform(.65,.97)
        t=h/top
        center=cx+.12*np.sin(7*t+rng.uniform(0,6))*(.25+t)+.04*mid
        width=rng.uniform(.13,.20)*np.maximum(1-t,0)**.52+.012
        d=(XX-center)/width
        gate=np.clip((1-t)*14,0,1)*np.clip(h*23,0,1)
        turbulent=np.clip(.88+.22*low+.18*mid+.05*fine,.28,1.2)
        body+=np.exp(-d*d*.88)*gate*turbulent
        hot+=np.exp(-d*d*4.1)*gate*np.clip(1.2-t+.10*mid,0,1)
    if core:
        body+=.7*np.exp(-(XX**2*5+(h-.15)**2*30))
    alpha=(1-np.exp(-body*1.7))*.92
    heat=np.clip(.31+hot*.65+body*.13,0,1)
    return soften_fire(rgba_fire(alpha,heat),seed)

def smoke(seed,lower=False):
    rng=np.random.default_rng(seed)
    low,mid,fine=noise(rng,5),noise(rng,17),noise(rng,47)
    # Broad billow with a torn uneven underside; no solid dark circular center.
    center=.40+.085*np.sin(X*9+seed)+.055*mid
    radius=((XX+.07*mid)/.98)**2+((Y-center)/(.34 if lower else .43))**2
    soft=np.clip(1-radius,0,1)**1.7
    torn=np.clip(.6+.18*low+.1*mid,.16,1)
    alpha=soft*torn*(.31 if lower else .42)*edge()
    shade=np.clip(.40+.09*low+.035*mid+.018*fine,.20,.69)
    return np.stack([shade*1.05,shade,shade*.92,alpha],axis=-1)

def ramp(name,stops):
    t=np.linspace(0,1,256)
    a=np.stack([np.interp(t,[s[0] for s in stops],[s[1][c] for s in stops]) for c in range(4)],axis=-1)
    png(OUT/name,a[None,:,:])

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for i,c in enumerate("abc"):png(OUT/("flame_"+c+".png"),flame(SEED+i*19))
    png(OUT/"flame_core.png",flame(SEED+71,True))
    for i,c in enumerate("ab"):
        seed=SEED+200+i*29
        png(OUT/("ceiling_roll_"+c+".png"),soften_fire(ceiling(seed),seed,True))
    for i,c in enumerate("ab"):png(OUT/("smoke_upper_"+c+".png"),smoke(SEED+90+i*17))
    png(OUT/"smoke_wisp.png",smoke(SEED+139,True))
    ramp("life_fast.png",[(0,(1,1,.9,0)),(.07,(1,1,.95,.95)),(.25,(1,.97,.77,.98)),(.57,(1,.79,.35,.83)),(.85,(1,.48,.04,.35)),(1,(1,.25,.01,0))])
    ramp("life_long.png",[(0,(1,1,.9,0)),(.13,(1,.97,.78,.78)),(.39,(1,.84,.40,.88)),(.68,(1,.60,.10,.66)),(.90,(1,.36,.02,.21)),(1,(1,.2,.01,0))])
    ramp("smoke_life.png",[(0,(.93,.91,.86,0)),(.16,(.93,.91,.86,.65)),(.46,(.96,.94,.89,.56)),(.78,(1,.98,.94,.30)),(1,(1,1,1,0))])
    files=sorted(OUT.glob("*.png"))
    meta={"schema":"agnes.office-fire-v3-assets.v1","source":"Project-authored deterministic NumPy procedural assets; user reference images guide form only","models_called":[],"third_party_assets":[],"seed":SEED,"fire_edges":"Irregular broad alpha feather; black transparent RGB guard; independently shaped ceiling rolls","generator":str(Path(__file__).relative_to(ROOT)),"files":[{"path":str(p.relative_to(ROOT)),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    (OUT.parent/"office_fire_v3_manifest.json").write_text(json.dumps(meta,indent=2)+"\n")
    print(json.dumps({"files":len(files),"bytes":sum(p.stat().st_size for p in files)}))
if __name__=="__main__":main()
