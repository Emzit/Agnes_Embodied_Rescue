"""Architectural cutaway FILM map only; no simulator or live UI operations."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
ROOT=Path("/data-ssd/zhongchengkai/agnes")
GEOMETRY_FILE=ROOT/"artifacts/demo-project-film-20261014/revision-opening-v2/office-intro-geometry.json"
OFFICE=json.loads(GEOMETRY_FILE.read_text())
INK=(28,31,35,255); ORANGE=(244,119,45,255)
FONT_FILE=ROOT/"artifacts/demo-project-film-20261014/revision-light-v3/fonts/InterVariable-locked.ttf"
_CACHE={};_FONTS={}
CUTAWAY_HEIGHT=.24;FOREGROUND_CUTAWAY_HEIGHT=.24;NEAR_FOREGROUND_CUTAWAY_HEIGHT=.24;SHEAR=.09;DEPTH=.88
def ease(t):
 t=max(0.0,min(1.0,t));return t*t*(3-2*t)
def font(n):
 n=max(8,round(n))
 if n not in _FONTS:_FONTS[n]=ImageFont.truetype(str(FONT_FILE),n)
 return _FONTS[n]
def projection(box):
 x0,y0,x1,y1=box;w,h=x1-x0,y1-y0
 pad=max(13,min(w,h)*.062)
 scale=min((w-2*pad)/(18+16*SHEAR+.3),(h-2*pad)/(16*DEPTH+CUTAWAY_HEIGHT+.3))
 cx=(x0+x1)/2;cy=(y0+y1)/2+CUTAWAY_HEIGHT*scale*.30
 def p(x,y,z=0):return (cx+(x+SHEAR*y)*scale,cy-y*DEPTH*scale-z*scale)
 return p,scale,CUTAWAY_HEIGHT
def wall_segments():
 out=[]
 for wall in OFFICE["geometry"]["walls"]:
  a=wall["a"];b=wall["b"];vx=b[0]-a[0];vy=b[1]-a[1];L=math.hypot(vx,vy)
  ux,uy=vx/L,vy/L;holes=[]
  for door in OFFICE["geometry"]["doors"]:
   c=door["at"];u=(c[0]-a[0])*ux+(c[1]-a[1])*uy
   if abs(vx*(c[1]-a[1])-vy*(c[0]-a[0]))<1e-8 and 0<=u<=L:
    holes.append((max(0,u-door["width"]/2),min(L,u+door["width"]/2)))
  at=0.0
  for lo,hi in sorted(holes):
   if lo>at:out.append(dict(id=wall["id"],a=(a[0]+at*ux,a[1]+at*uy),b=(a[0]+lo*ux,a[1]+lo*uy),thickness=wall["thickness"]))
   at=max(at,hi)
  if at<L:out.append(dict(id=wall["id"],a=(a[0]+at*ux,a[1]+at*uy),b=tuple(b),thickness=wall["thickness"]))
 return out
WALLS=wall_segments()
def wall_cutaway_height(seg):
 # One presentation cut plane for every wall; simulation heights are unchanged.
 return CUTAWAY_HEIGHT

PATH=[tuple(v) for v in OFFICE["path_world_coordinates"]]
def path_interp(points,progress):
 lengths=[math.dist(a,b) for a,b in zip(points,points[1:])]
 distance=sum(lengths)*max(0,min(1,progress))
 for a,b,L in zip(points,points[1:],lengths):
  if distance<=L:
   q=distance/L if L else 0
   return (a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
  distance-=L
 return tuple(points[-1])
def robot_world(tm):
 if tm<=3:return PATH[0]
 if tm<13:return path_interp(PATH[:4],ease((tm-3)/10))
 if tm<19.5:return PATH[3]
 if tm<26:return path_interp(PATH[3:],ease((tm-19.5)/6.5))
 return PATH[-1]
def robot_heading(tm):
 if tm<3:return math.pi/2
 if tm>=13:return 0.0
 a=robot_world(max(3,tm-.025));b=robot_world(tm+.025)
 if math.dist(a,b)<1e-7:return 0.0
 return math.atan2(b[1]-a[1],b[0]-a[0])
def near_leaf(tm):
 opening=ease((tm-16)/3);hinge=(4.5,-6.625)
 return hinge,(hinge[0]+1.25*math.sin(opening*math.pi/2),hinge[1]+1.25*math.cos(opening*math.pi/2))
def footprint(a,b,thickness):
 dx=b[0]-a[0];dy=b[1]-a[1];L=math.hypot(dx,dy)
 if L<1e-9:return []
 nx=-dy/L*thickness/2;ny=dx/L*thickness/2
 return [(a[0]+nx,a[1]+ny),(b[0]+nx,b[1]+ny),(b[0]-nx,b[1]-ny),(a[0]-nx,a[1]-ny)]
def draw_prism(im,p,poly,height,top=INK,side=(209,214,219,255)):
 d=ImageDraw.Draw(im);ground=[p(x,y,0) for x,y in poly];roof=[p(x,y,height) for x,y in poly]
 faces=[((ground[i][1]+ground[(i+1)%4][1])/2,i,(i+1)%4) for i in range(4)]
 for _,i,j in sorted(faces):
  dx=poly[j][0]-poly[i][0];dy=poly[j][1]-poly[i][1]
  col=side if abs(dx)>abs(dy) else (233,235,238,255)
  d.polygon([ground[i],ground[j],roof[j],roof[i]],fill=col)
  d.line([ground[i],ground[j]],fill=(185,191,197,160),width=1)
  if top==INK:
   # A dark upper side band makes the physical wall read as a solid
   # architectural cutaway, while leaving the actual plan footprint intact.
   band=min(.18,height*.24)
   low_i=p(*poly[i],height-band);low_j=p(*poly[j],height-band)
   cap_side=(49,53,58,255) if abs(dx)>abs(dy) else (67,72,78,255)
   d.polygon([low_i,low_j,roof[j],roof[i]],fill=cap_side)
 d.polygon(roof,fill=top)
 edge=max(range(4),key=lambda i:(roof[i][1]+roof[(i+1)%4][1])/2)
 d.line([roof[edge],roof[(edge+1)%4]],fill=(74,78,82,255),width=1)
def union_wall_cells():
 """Exact union of the axis-aligned wall footprints, with actual door holes.
 Shared internal edges are removed before drawing sides or roof outlines.
 """
 rects=[]
 for seg in WALLS:
  poly=footprint(seg['a'],seg['b'],seg['thickness'])
  rects.append((min(p[0]for p in poly),min(p[1]for p in poly),max(p[0]for p in poly),max(p[1]for p in poly)))
 xs=sorted(set(round(q,9)for r in rects for q in [r[0],r[2]]));ys=sorted(set(round(q,9)for r in rects for q in [r[1],r[3]]))
 cells=set()
 for i in range(len(xs)-1):
  for j in range(len(ys)-1):
   x=(xs[i]+xs[i+1])/2;y=(ys[j]+ys[j+1])/2
   if any(a-1e-8<x<b+1e-8 and c-1e-8<y<e+1e-8 for a,c,b,e in rects):cells.add((i,j))
 boundaries=[];polys=[]
 for i,j in cells:
  x0,x1=xs[i:i+2];y0,y1=ys[j:j+2]
  poly=[(x0,y0),(x1,y0),(x1,y1),(x0,y1)];polys.append(poly)
  for delta,a,b in [((0,-1),poly[0],poly[1]),((1,0),poly[1],poly[2]),((0,1),poly[2],poly[3]),((-1,0),poly[3],poly[0])]:
   if (i+delta[0],j+delta[1])not in cells:boundaries.append((a,b))
 return polys,boundaries
UNION_CELLS,UNION_EDGES=union_wall_cells()
def draw_unified_walls(im,p):
 d=ImageDraw.Draw(im);z=CUTAWAY_HEIGHT;band=min(.18,z*.24)
 # All faces belong to a single joined solid, rather than overlapping prisms.
 for a,b in sorted(UNION_EDGES,key=lambda edge:sum(p(*q)[1]for q in edge)/2):
  ga,gb=p(*a),p(*b);ta,tb=p(*a,z),p(*b,z)
  col=(210,215,220,255)if abs(a[0]-b[0])>abs(a[1]-b[1])else(231,234,237,255)
  d.polygon([ga,gb,tb,ta],fill=col)
  d.polygon([p(*a,z-band),p(*b,z-band),tb,ta],fill=(61,65,70,255))
 # Union roof mask paints the cap once; no interior junction/seam is stroked.
 roof=Image.new('L',im.size);rd=ImageDraw.Draw(roof)
 for poly in UNION_CELLS:rd.polygon([p(x,y,z)for x,y in poly],fill=255)
 solid=Image.new('RGBA',im.size,INK);solid.putalpha(roof);im.alpha_composite(solid)
 for a,b in UNION_EDGES:
  if abs(a[0]-b[0])>abs(a[1]-b[1]) and b[0]>a[0]:d.line([p(*a,z),p(*b,z)],fill=(75,80,85,255),width=1)

def _bounds_polygon(b):
 return [(b["min_x"],b["min_y"]),(b["max_x"],b["min_y"]),(b["max_x"],b["max_y"]),(b["min_x"],b["max_y"])]
def _base(w,h,variant=0):
 key=(w,h,variant)
 if key in _CACHE:return _CACHE[key].copy()
 im=Image.new("RGBA",(w,h),(0,0,0,0));p,s,z=projection((0,0,w,h))
 def transform(x,y):return ((-x if variant else x),y)
 def pp(x,y,z=0):return p(*transform(x,y),z)
 floor=_bounds_polygon(OFFICE["geometry"]["boundary"]);slab=[pp(x,y,-.13) for x,y in floor]
 sh=Image.new("RGBA",(w,h));sd=ImageDraw.Draw(sh)
 sd.polygon([(x+4,y+7) for x,y in slab],fill=(40,47,54,38))
 im=Image.alpha_composite(im,sh.filter(ImageFilter.GaussianBlur(max(2,s*.18))));d=ImageDraw.Draw(im)
 ground=[pp(x,y) for x,y in floor]
 d.polygon(slab,fill=(218,223,227,255));d.polygon(ground,fill=(249,250,251,255))
 mask=Image.new("L",(w,h));ImageDraw.Draw(mask).polygon(ground,fill=255)
 grad=Image.new("RGBA",(w,h));gd=ImageDraw.Draw(grad)
 for y in range(h):
  shade=253-round(6*y/max(1,h));gd.line((0,y,w,y),fill=(shade,min(255,shade+1),min(255,shade+2),255))
 grad.putalpha(mask);im=Image.alpha_composite(im,grad);d=ImageDraw.Draw(im)
 for room in OFFICE["geometry"]["rooms"]:d.polygon([pp(x,y) for x,y in _bounds_polygon(room["bounds"])],fill=(245,247,248,255))
 sh=Image.new("RGBA",(w,h));sd=ImageDraw.Draw(sh)
 for seg in WALLS:
  poly=footprint(seg["a"],seg["b"],seg["thickness"])
  shadow_ratio=wall_cutaway_height(seg)/CUTAWAY_HEIGHT
  sd.polygon([(pp(x,y)[0]+s*.12*shadow_ratio,pp(x,y)[1]+s*.18*shadow_ratio) for x,y in poly],fill=(38,45,53,68))
 sh=sh.filter(ImageFilter.GaussianBlur(max(1,s*.13)))
 sh.putalpha(ImageChops.multiply(sh.getchannel("A"),mask));im=Image.alpha_composite(im,sh)
 draw_unified_walls(im,pp)

 d=ImageDraw.Draw(im)
 if w>500:
  for i,xy in enumerate([(-6.0,6.0),(7.0,-4.8),(7.0,-1.45),(7.0,6.0)]):
   x,y=pp(*xy);d.text((x,y),"R"+str(i+1),font=font(max(10,s*.39)),fill=(145,151,158,255),anchor="mm")
 if w>450:
  x=w-max(18,w*.035);y=max(17,h*.065)
  d.text((x,y-6),"N",font=font(10),fill=(149,156,163,255),anchor="mm")
  d.polygon([(x,y+6),(x-3.7,y+16),(x,y+13),(x+3.7,y+16)],fill=(165,171,178,255))
 _CACHE[key]=im.copy();return im
def _smooth_route(points,r=.16):
 samples=[points[0]]
 for i in range(1,len(points)-1):
  a,b,c=points[i-1:i+2];la=math.dist(a,b);lb=math.dist(b,c)
  if la<1e-9 or lb<1e-9:continue
  rr=min(r,la*.22,lb*.22)
  q0=(b[0]+(a[0]-b[0])*rr/la,b[1]+(a[1]-b[1])*rr/la)
  q1=(b[0]+(c[0]-b[0])*rr/lb,b[1]+(c[1]-b[1])*rr/lb)
  samples.append(q0)
  for j in range(1,9):
   t=j/8;u=1-t;samples.append((u*u*q0[0]+2*u*t*b[0]+t*t*q1[0],u*u*q0[1]+2*u*t*b[1]+t*t*q1[1]))
 samples.append(points[-1]);return samples
def _route_to_position(wp):
 # Stop the saturated trail at the exact current progress, including the
 # vertical turn. Do not select points by x alone.
 best=None
 for i,(a,b) in enumerate(zip(PATH,PATH[1:])):
  dx=b[0]-a[0];dy=b[1]-a[1];L2=dx*dx+dy*dy
  q=max(0,min(1,((wp[0]-a[0])*dx+(wp[1]-a[1])*dy)/L2))
  at=(a[0]+q*dx,a[1]+q*dy);err=math.dist(at,wp)
  if best is None or err<best[0]:best=(err,i)
 points=PATH[:best[1]+1]+[wp]
 if math.dist(points[-2],points[-1])<1e-8:points=points[:-1]
 return _smooth_route(points) if len(points)>1 else points
def robot_polygon(tm,box):
 # Navigation arrow has a maximum radius of .37 world metres.
 p,s,_=projection(box);x,y=robot_world(tm);yaw=robot_heading(tm)
 u=(math.cos(yaw),math.sin(yaw));v=(-u[1],u[0])
 return [p(x+a*u[0]+b*v[0],y+a*u[1]+b*v[1],.018) for a,b in [(.37,0),(-.25,.23),(-.14,0),(-.25,-.23)]]
def draw_office(im,box,tm):
 # No card or header. Geometry exactly matches frozen actual office.
 x0,y0,x1,y1=box;w=round(x1-x0);h=round(y1-y0)
 layer=_base(w,h);p,s,z=projection((0,0,w,h))
 for door in OFFICE["geometry"]["doors"]:
  if door["id"]=="Right_Near_Door":a,b=near_leaf(tm)
  else:
   x,y=door["at"];dx=math.cos(door["orientation"])*door["width"]/2;dy=math.sin(door["orientation"])*door["width"]/2
   a=(x-dx,y-dy);b=(x+dx,y+dy)
  draw_prism(layer,p,footprint(a,b,.055),CUTAWAY_HEIGHT,top=(194,199,204,255),side=(234,236,239,255))
  if door["id"]=="Right_Near_Door" and tm>=16:
   ImageDraw.Draw(layer).line([p(*a,CUTAWAY_HEIGHT+.01),p(*b,CUTAWAY_HEIGHT+.01)],fill=ORANGE,width=max(1,round(s*.04)))
 d=ImageDraw.Draw(layer);wp=robot_world(tm)
 visible=_smooth_route(PATH if tm>=19 else PATH[:4])
 d.line([p(x,y,.015) for x,y in visible],fill=(245,188,152,220),width=max(1,round(s*.045)),joint="curve")
 travelled=_route_to_position(wp)
 if len(travelled)>1:d.line([p(x,y,.02) for x,y in travelled],fill=ORANGE,width=max(1,round(s*.055)),joint="curve")
 sx,sy=p(*PATH[0],.02)
 d.ellipse((sx-3,sy-3,sx+3,sy+3),fill=(255,255,255,255),outline=(190,196,202,255),width=1)
 bx,by=p(*wp,.025);scan=.32+.12*ease((tm/3.6)%1);rx=s*scan;ry=s*scan*DEPTH
 d.ellipse((bx-rx,by-ry,bx+rx,by+ry),outline=(248,179,135,220),width=1)
 nav=robot_polygon(tm,(0,0,w,h));shadow=Image.new("RGBA",(w,h));sd=ImageDraw.Draw(shadow)
 sd.polygon([(x+1,y+2) for x,y in nav],fill=(101,58,26,40))
 layer=Image.alpha_composite(layer,shadow.filter(ImageFilter.GaussianBlur(1.5)));d=ImageDraw.Draw(layer)
 d.polygon(nav,fill=ORANGE);d.line(nav+[nav[0]],fill=(255,251,248,255),width=1,joint="curve")
 if im.mode=="RGBA":im.alpha_composite(layer,(round(x0),round(y0)))
 else:im.paste(layer,(round(x0),round(y0)),layer)
 return {"geometry":str(GEOMETRY_FILE),"scale":s,"cutaway_height_world":z,"foreground_cutaway_height_world":FOREGROUND_CUTAWAY_HEIGHT,"near_foreground_cutaway_height_world":NEAR_FOREGROUND_CUTAWAY_HEIGHT,"projection":{"x_shear":SHEAR,"y_depth":DEPTH,"z_axis":"screen-up"},"robot_world":list(wp),"robot_polygon":[[x+x0,y+y0] for x,y in nav],"door":dict(zip(["hinge","tip"],near_leaf(tm)))}
def draw_generic(im,box,variant=0,tm=0):
 # 0=canonical;1=reflected illustrative import layout, never the live opener.
 x0,y0,x1,y1=box;w=round(x1-x0);h=round(y1-y0)
 layer=_base(w,h,int(bool(variant)));p,s,z=projection((0,0,w,h));d=ImageDraw.Draw(layer)
 for door in OFFICE["geometry"]["doors"]:
  x,y=door["at"];x=-x if variant else x
  dx=math.cos(door["orientation"])*door["width"]/2;dy=math.sin(door["orientation"])*door["width"]/2
  d.line([p(x-dx,y-dy),p(x+dx,y+dy)],fill=(197,204,210,255),width=1)
 if im.mode=="RGBA":im.alpha_composite(layer,(round(x0),round(y0)))
 else:im.paste(layer,(round(x0),round(y0)),layer)
 return {"variant":"illustrative-reflected" if variant else "canonical-office","scale":s}
def main():
 out=ROOT/"artifacts/demo-project-film-20261014/revision-opening-walls-v7/map-previews";out.mkdir(parents=True,exist_ok=True)
 records=[]
 for t in [0,10,16,18,19.5,22.6,26]:
  im=Image.new("RGB",(1438,1080),"#F5F6F7");d=ImageDraw.Draw(im)
  for x in range(0,1438,64):d.line((x,0,x,1080),fill="#EEF0F2")
  for y in range(0,1080,64):d.line((0,y,1438,y),fill="#EEF0F2")
  d.rounded_rectangle((483,235,1378,829),radius=28,fill="white")
  d.text((510,253),"MAP / TF",font=font(21),fill="#1C1F23")
  d.line((497,255,497,276),fill="#F4772D",width=3)
  meta=draw_office(im,(510,292,1350,789),t)
  path=out/f"office-{str(t).replace('.','p')}.png";im.save(path);records.append({"seconds":t,"file":str(path),"metadata":meta})
 for variant in [0,1]:
  im=Image.new("RGB",(1438,1080),"#F5F6F7");d=ImageDraw.Draw(im);d.rounded_rectangle((65,242,575,650),24,fill="white")
  draw_generic(im,(89,286,550,614),variant,0);im.save(out/f"generic-{variant}.png")
 (out/"geometry-metadata.json").write_text(json.dumps({"wall_segments":WALLS,"frames":records,"path":PATH,"near_door_clear_width":1.25,"max_arrow_radius_world":.37,"max_scan_radius_world":.44},ensure_ascii=False,indent=2))
 print(json.dumps({"previews":str(out),"module":str(Path(__file__))},ensure_ascii=False))
if __name__=="__main__":main()
