from pathlib import Path
import json, math, argparse, subprocess, hashlib, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT=Path("/data-ssd/zhongchengkai/agnes")
OUT=ROOT/"artifacts/demo-project-film-20261014/revision-light-v3"
W,H=1438,1080
FONT=ROOT/"artifacts/demo-video-20261013/assets/fonts/NotoSansCJKsc-Regular.otf"
FF=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg"
BG="#F5F6F7"; PANEL="#FFFFFF"; WHITE="#1C1F23"; MUTED="#74797F"; BLUE="#F4772D"; ORANGE="#F4772D"; LINE="#D8DCE0"
fonts={}
latin_fonts={}
INTER=OUT/"fonts/InterVariable-locked.ttf"
def font(n,latin=False):
 if latin and INTER.exists():
  if n not in latin_fonts:latin_fonts[n]=ImageFont.truetype(str(INTER),n)
  return latin_fonts[n]
 if n not in fonts:fonts[n]=ImageFont.truetype(str(FONT),n)
 return fonts[n]
def text(d,xy,s,size=24,fill=WHITE):
 x,y=xy
 if not s:return
 runs=[];cur=s[0];latin=ord(s[0])<128
 for c in s[1:]:
  kind=ord(c)<128
  if kind==latin:cur+=c
  else:runs.append((cur,latin));cur=c;latin=kind
 runs.append((cur,latin))
 for run,kind in runs:
  f=font(size,kind)
  # Same baseline for Inter and CJK; ascender metrics differ.
  d.text((x,y+size*1.14),run,font=f,fill=fill,anchor="ls")
  x+=d.textlength(run,font=f)
def rr(d,box,r=24,fill=PANEL,outline=None,width=2):
 x0,y0,x1,y1=box
 if fill is not None and fill in [PANEL,"#FFF7F1"] and x1-x0>150 and y1-y0>65:
  # Subtle stacked shadow with a soft neutral falloff; no glow.
  for shift,col in [(8,"#EEF0F2"),(5,"#ECEFF1"),(2,"#E9ECEF")]:
   d.rounded_rectangle((x0-1,y0+shift,x1+1,y1+shift),r+1,fill=col)
 d.rounded_rectangle(box,r,fill=fill,outline=outline,width=min(width,2))
def center(d,xy,s,size=24,fill=WHITE):
 width=sum(d.textlength(run,font=font(size,kind)) for run,kind in split_runs(s))
 text(d,(xy[0]-width/2,xy[1]),s,size,fill)
def split_runs(s):
 if not s:return []
 runs=[];cur=s[0];latin=ord(s[0])<128
 for c in s[1:]:
  kind=ord(c)<128
  if kind==latin:cur+=c
  else:runs.append((cur,latin));cur=c;latin=kind
 runs.append((cur,latin));return runs
def ease(a): a=max(0,min(1,a));return a*a*(3-2*a)
def arrow(d,a,b,fill=BLUE,width=3):
 d.line((a,b),fill=fill,width=width)
 q=math.atan2(b[1]-a[1],b[0]-a[0])
 pts=[b,(b[0]-13*math.cos(q-.42),b[1]-13*math.sin(q-.42)),(b[0]-13*math.cos(q+.42),b[1]-13*math.sin(q+.42))]
 d.polygon(pts,fill=fill)
def dotflow(d,a,b,t,fill=BLUE):
 arrow(d,a,b,LINE,2)
 for k in range(2):
  phase=(t*.055+k/2)%1
  p=ease(phase);x=a[0]+(b[0]-a[0])*p;y=a[1]+(b[1]-a[1])*p
  d.ellipse((x-3,y-3,x+3,y+3),fill=fill)
def node(d,box,title,lines,active=False,color=BLUE):
 rr(d,box,26,fill=PANEL,outline=LINE,width=1)
 if active:
  d.line((box[0]+23,box[1]+12,box[0]+68,box[1]+12),fill=ORANGE,width=3)
 text(d,(box[0]+20,box[1]+18),title,29,WHITE)
 for i,line in enumerate(lines):text(d,(box[0]+20,box[1]+65+i*34),line,22,MUTED)
def robot(d,x,y,r=30,col=BLUE):
 d.ellipse((x-r,y-r,x+r,y+r),fill="#FFFFFF",outline=col,width=3)
 rr(d,(x-r*.7,y-r*.4,x+r*.7,y+r*.45),8,fill=col)
 d.ellipse((x-r*.35-4,y-4,x-r*.35+4,y+4),fill=BG)
 d.ellipse((x+r*.35-4,y-4,x+r*.35+4,y+4),fill=BG)
 d.line((x,y-r*.4,x,y-r*.8),fill=col,width=3);d.ellipse((x-4,y-r*.85-4,x+4,y-r*.85+4),fill=col)
def scan_ring(d,x,y,r,tm):
 size=r+9*ease((tm/5)%1)
 d.ellipse((x-size,y-size,x+size,y+size),outline="#FCE4D3",width=2)
 angle=(tm*12)%360
 d.arc((x-size,y-size,x+size,y+size),start=angle,end=angle+62,fill=ORANGE,width=2)
def person(d,x,y,s=1,col=ORANGE):
 d.ellipse((x-10*s,y-33*s,x+10*s,y-13*s),fill=col)
 d.line((x,y-10*s,x,y+22*s),fill=col,width=max(2,int(7*s)))
 d.line((x-20*s,y+6*s,x,y-8*s,x+20*s,y+6*s),fill=col,width=max(2,int(6*s)))
 d.line((x-16*s,y+48*s,x,y+19*s,x+16*s,y+48*s),fill=col,width=max(2,int(6*s)))
def flame(d,x,y,s=1,tm=0):
 sw=math.sin(tm*3+x)*8*s
 poly=[(x-19*s,y+15*s),(x-24*s,y-9*s),(x-10*s,y-40*s),(x-1*s+sw,y-66*s),(x+11*s,y-22*s),(x+22*s,y-10*s),(x+17*s,y+15*s)]
 d.polygon(poly,fill="#F4772D")
 d.polygon([(x-10*s,y+12*s),(x-11*s,y-7*s),(x+sw*.3,y-28*s),(x+10*s,y-1*s),(x+9*s,y+12*s)],fill=ORANGE)
def mapdraw(d,box,variant=0,tm=0,fire=False,bot=True):
 x0,y0,x1,y1=box
 rr(d,box,22,fill="#FFFFFF",outline=LINE)
 def p(x,y):return (x0+25+x*(x1-x0-50),y0+25+y*(y1-y0-50))
 segments=[((0,0),(1,0)),((1,0),(1,1)),((1,1),(0,1)),((0,1),(0,0))]
 if variant==0:
  segments += [((.62,0),(.62,.23)),((.62,.35),(.62,.42)),((.62,.42),(1,.42)),((.62,.42),(.62,.60)),((.62,.73),(.62,1)),((.62,.76),(1,.76)),((0,.32),(.41,.32)),((.55,.32),(.62,.32))]
 else:
  segments += [((.50,0),(.50,.18)),((.5,.31),(.5,.5)),((.5,.5),(1,.5)),((.5,.5),(.5,.67)),((.5,.80),(.5,1)),((0,.37),(.29,.37)),((.41,.37),(.5,.37))]
 for a,b in segments:d.line((p(*a),p(*b)),fill="#858B91",width=6)
 if fire:
  for a,b in [(.10,.13),(.77,.67),(.88,.17)]:flame(d,*p(a,b),s=.6,tm=tm)
 if bot:robot(d,*p(.40,.87),r=19)
def base(title,k,small="AGNES / EMBODIED RESCUE"):
 im=Image.new("RGB",(W,H),BG);d=ImageDraw.Draw(im)
 for x in range(0,W,80):
  d.line((x,0,x,930),fill="#EFF1F3",width=1)
 for y in range(0,940,80):d.line((0,y,W,y),fill="#EFF1F3",width=1)
 text(d,(60,37),small,18,MUTED);text(d,(60,80),title,43,WHITE)
 rr(d,(60,155,1378,158),2,fill=LINE)
 text(d,(61,939),"目标 · 观测 · 行动 · 反馈",19,MUTED)
 text(d,(1185,937),"原理示意",19,MUTED)
 return im
titles=["焰境智巡 · EmberScout","从一句话到机器人动作","让图像理解与定位各司其职","在环境反馈中完成动作","换一套骨架，沿用同一套能力"]
bases=[base(t,i) for i,t in enumerate(titles)]
OFFICE=json.loads((ROOT/"artifacts/demo-project-film-20261014/revision-opening-v2/office-intro-geometry.json").read_text())
def office_projection(box=(65,235,875,750)):
 b=OFFICE["geometry"]["boundary"];x0,y0,x1,y1=box
 scale=min((x1-x0-50)/(b["max_x"]-b["min_x"]),(y1-y0-50)/(b["max_y"]-b["min_y"]))
 left=x0+(x1-x0-(b["max_x"]-b["min_x"])*scale)/2
 top=y0+(y1-y0-(b["max_y"]-b["min_y"])*scale)/2
 def p(x,y):return (left+(x-b["min_x"])*scale,top+(b["max_y"]-y)*scale)
 return p,scale
def office_wall_segments():
 g=OFFICE["geometry"];out=[]
 for wall in g["walls"]:
  a=np.array(wall["a"],dtype=float);b=np.array(wall["b"],dtype=float);v=b-a
  length=float(np.linalg.norm(v));unit=v/length;holes=[]
  for door in g["doors"]:
   c=np.array(door["at"],dtype=float);u=float(np.dot(c-a,unit))
   if abs(float(v[0]*(c-a)[1]-v[1]*(c-a)[0]))<1e-8 and 0<=u<=length:
    holes.append((max(0,u-door["width"]/2),min(length,u+door["width"]/2)))
  at=0.0
  for lo,hi in sorted(holes):
   if lo>at:out.append({"id":wall["id"],"a":(a+at*unit).tolist(),"b":(a+lo*unit).tolist(),"thickness":wall["thickness"]})
   at=max(at,hi)
  if at<length:out.append({"id":wall["id"],"a":(a+at*unit).tolist(),"b":b.tolist(),"thickness":wall["thickness"]})
 return out
OFFICE_WALLS=office_wall_segments()
def path_interp(points,progress):
 lens=[math.dist(a,b) for a,b in zip(points,points[1:])]
 distance=sum(lens)*max(0,min(1,progress))
 for a,b,L in zip(points,points[1:],lens):
  if distance<=L:
   q=distance/L if L else 0
   return (a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
  distance-=L
 return tuple(points[-1])
def intro_robot_world(tm):
 path=OFFICE["path_world_coordinates"]
 if tm<=3:return tuple(path[0])
 if tm<13:return path_interp(path[:4],ease((tm-3)/10))
 if tm<19.5:return tuple(path[3])
 if tm<26:return path_interp(path[3:],ease((tm-19.5)/6.5))
 return tuple(path[-1])
def near_leaf(tm):
 opening=ease((tm-16)/3)
 hinge=(4.5,-6.625)
 tip=(hinge[0]+1.25*math.sin(opening*math.pi/2),hinge[1]+1.25*math.cos(opening*math.pi/2))
 return hinge,tip
def office_map(d,tm):
 box=(65,235,875,750);rr(d,box,22,fill="#FFFFFF",outline=LINE)
 p,scale=office_projection(box)
 colors=["#F2F3F4","#F2F3F4","#F2F3F4","#F2F3F4"]
 positions=[(-6.1,6.8),(7.0,-4.25),(7.0,-.85),(7.0,7.0)]
 for j,room in enumerate(OFFICE["geometry"]["rooms"]):
  b=room["bounds"];tl=p(b["min_x"],b["max_y"]);br=p(b["max_x"],b["min_y"])
  d.rectangle((tl,br),fill=colors[j])
  label=p(*positions[j]);rr(d,(label[0]-22,label[1]-14,label[0]+22,label[1]+14),9,fill="#FFFFFF")
  center(d,(label[0],label[1]-12),"R"+str(j+1),17,WHITE)
 for wall in OFFICE_WALLS:d.line((p(*wall["a"]),p(*wall["b"])),fill="#70777E",width=4)
 for door in OFFICE["geometry"]["doors"]:
  if door["id"]=="Right_Near_Door":a,b=near_leaf(tm)
  else:
   x,y=door["at"];theta=door["orientation"];dx=math.cos(theta)*door["width"]/2;dy=math.sin(theta)*door["width"]/2
   a=(x-dx,y-dy);b=(x+dx,y+dy)
  d.line((p(*a),p(*b)),fill=ORANGE,width=3)
 for x,y in [(-7,5),(7.2,4.8),(7.7,-2.1)]:flame(d,*p(x,y),s=.43,tm=tm)
 path=OFFICE["path_world_coordinates"]
 for a,b in zip(path,path[1:]):
  steps=max(2,round(math.dist(a,b)*5))
  for j in range(steps):
   q=j/steps;point=p(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
   d.ellipse((point[0]-2,point[1]-2,point[0]+2,point[1]+2),fill="#C5C9CD")
 spawn=p(*path[0]);d.ellipse((spawn[0]-5,spawn[1]-5,spawn[0]+5,spawn[1]+5),outline=BLUE,width=2)
 text(d,(spawn[0]-20,spawn[1]+16),"起点",15,BLUE)
 moving=p(*intro_robot_world(tm));robot(d,*moving,r=13,col=ORANGE)
 state="沿通道接近门口" if tm<16 else ("先打开房门" if tm<19.5 else "从门洞中心进入")
 text(d,(100,276),"办公室火灾",18,MUTED)
 rr(d,(554,762,875,806),13,fill="#FFFFFF",outline=LINE)
 text(d,(572,770),state,20,ORANGE)
 return p,scale
def intro(tm):
 im=bases[0].copy();d=ImageDraw.Draw(im)
 office_map(d,tm)
 text(d,(95,765),"办公室火灾骨架",31,BLUE)
 text(d,(95,812),"R1 大房间 · R2 近端 · R3 中部 · R4 右前",23,MUTED)
 rr(d,(942,250,1372,484),24,fill=PANEL,outline=LINE)
 text(d,(969,272),"远程任务",28,BLUE)
 text(d,(969,323),"请找到待救援人员",29)
 text(d,(969,384),"Agnes 原生对话",24,MUTED)
 dotflow(d,(930,520),(824,563),tm,ORANGE)
 scan_ring(d,1000,586,45,tm);robot(d,1000,586,37);text(d,(1060,562),"机器人执行",28);text(d,(1060,608),"进入 · 观察 · 回报",22,MUTED)
 for j,(label,line) in enumerate([("环境观察","相机图像"),("房门操作","导航与开门"),("人员确认","多视角复核")]):
  box=(943,687+j*68,1372,741+j*68);rr(d,box,13,fill=PANEL,outline=BLUE if int(tm/5)%3==j else LINE)
  text(d,(962,699+j*68),label,23,BLUE);text(d,(1115,699+j*68),line,21,MUTED)
 return im

def pipframe(im,fr):
 if fr is None:return
 p=fr.crop((14,62,1424,802)).resize((422,221),Image.Resampling.LANCZOS)
 im.paste(p,(950,213))
 d=ImageDraw.Draw(im);rr(d,(948,211,1374,436),16,fill=None,outline=BLUE,width=3)
 text(d,(951,177),"现场实录",22,BLUE);text(d,(1210,177),"相机 + 导航",20,MUTED)
def chapter(idx,tm,fr):
 im=bases[idx].copy();d=ImageDraw.Draw(im);pipframe(im,fr)
 if idx==1:
  node(d,(72,210,886,312),"大任务",["找到待救援人员"],True)
  active=int(tm/7)%3
  node(d,(73,370,313,545),"Agnes 任务会话",["结合观测","组织执行步骤"],active==0)
  node(d,(365,370,595,545),"Harness",["参数与权限","操作状态与记录"],active==1)
  node(d,(648,370,886,545),"机器人工具",["MCP 接口","ROS 动作系统"],active==2)
  dotflow(d,(313,456),(365,456),tm);dotflow(d,(595,456),(648,456),tm)
  for j,(a,b) in enumerate([("看环境","获取新观测"),("到门口","导航与识门"),("打开门","检查实际终态")]):
   node(d,(75+j*279,614,321+j*279,769),a,[b],int(tm/5)%3==j,ORANGE)
  d.line((770,785,770,860,193,860,193,787),fill=LINE,width=3)
  dotflow(d,(580,860),(206,860),tm,ORANGE)
  text(d,(266,803),"反馈回到会话，更新下一步",25,ORANGE)
  node(d,(950,576,1374,802),"执行检查",["输入：严格参数","执行：按权限授权","输出：真实操作结果"],True)
 elif idx==2:
  rr(d,(73,235,493,633),22,fill="#FFFFFF",outline=LINE)
  d.line((95,550,95,280,450,280,450,550),fill="#8A9198",width=9)
  rr(d,(323,305,435,556),4,fill="#EEF0F2",outline="#8A9198")
  person(d,208,462,1.1,ORANGE)
  rr(d,(173,405,244,526),10,fill=None,outline=ORANGE,width=3)
  rr(d,(315,297,441,563),10,fill=None,outline=BLUE,width=3)
  text(d,(90,590),"当前相机图片",25,MUTED)
  dotflow(d,(500,437),(544,437),tm)
  node(d,(551,309,886,587),"Agnes 视觉子会话",["人员 / 房门","图像中的位置","置信线索","新的观察结果"],True)
  node(d,(74,710,467,851),"图像语义",["画面里看到了什么"],True,ORANGE)
  node(d,(497,710,888,851),"ROS 定位",["地图上的坐标与朝向"],True)
  node(d,(950,576,1374,839),"两类信息结合",["激光 + 里程计 → AMCL","TF → 连接坐标系","目标区域 → 下一次观察"],True)
 elif idx==3:
  coords=[(72,248,401,423),(548,248,884,423),(548,639,884,814),(72,639,401,814)]
  content=[("观察",["相机获取现场图像"]),("行动",["Nav2 导航 / 房门工具"]),("确认",["门已打开？运动结束？"]),("再观察",["停稳后读取新的图像"])]
  for j,(box,(title,lines)) in enumerate(zip(coords,content)):node(d,box,title,lines,int(tm/6)%4==j,ORANGE if j==2 else BLUE)
  for a,b in [((401,336),(548,336)),((715,423),(715,639)),((548,729),(401,729)),((239,639),(239,423))]:dotflow(d,a,b,tm)
  scan_ring(d,479,524,63,tm);robot(d,479,524,54);center(d,(479,592),"具身执行闭环",28,WHITE)
  node(d,(950,576,1374,839),"世界记忆",["当前位置","最新观察","供后续任务读取"],True)
 else:
  variant=0 if tm<20 else 1
  mapdraw(d,(75,242,392,614),variant,tm,False)
  text(d,(90,627),"结构化骨架 "+("A" if variant==0 else "B"),27,BLUE)
  text(d,(90,674),"房间 / 墙 / 门 / 起点",22,MUTED)
  dotflow(d,(395,427),(454,427),tm)
  node(d,(465,345,684,513),"编译与校验",["空间几何","门口接近点"],True)
  dotflow(d,(686,427),(733,427),tm)
  for j,(title,lines) in enumerate([("Gazebo 场景",["可交互空间"]),("导航地图",["栅格地图","定位参数"]),("房间连接",["工具先验"])]):
   box=(728,239+j*180,914,389+j*180)
   active=int(tm/6)%3==j
   rr(d,box,18,fill=PANEL,outline=BLUE if active else LINE,width=3)
   text(d,(744,257+j*180),title,22,WHITE)
   for k,line in enumerate(lines):text(d,(744,309+j*180+k*27),line,19,MUTED)
  rr(d,(75,760,885,863),20,fill=PANEL,outline=LINE)
  steps=["空闲检查","可达性校验","切换场景","TF / 相机复验"]
  for j,s in enumerate(steps):
   text(d,(95+j*197,795),s,22,BLUE if int(tm/8)%4==j else MUTED)
  node(d,(950,576,1374,842),"适配目标",["当前：结构化骨架导入","当前：场景编译与切换","下一步：更多布局与真机"],True)
 return im
def full(fr,t):
 im=fr.copy();d=ImageDraw.Draw(im)
 rr(d,(W-158,18,W-18,56),15,fill="#FFFFFF")
 text(d,(W-145,24),"画面经剪辑",18,WHITE)
 if t>=285:
  rr(d,(45,770,517,855),18,fill="#FFFFFF",outline=BLUE)
  text(d,(64,789),"人员定位完成 · 保持停止",28,WHITE)
 return im
def captions_from_timeline(path):
 if path is None or not path.exists():return []
 data=json.loads(path.read_text());caps=[]
 for c in data["clips"]:
  speech=c["text"];start=c.get("start",c.get("start_seconds"))
  duration=c.get("duration_seconds")
  if duration is None:
   import wave
   with wave.open(str(ROOT/c["file"])) as w:duration=w.getnframes()/w.getframerate()
  phrases=[];cur=""
  for char in speech:
   cur+=char
   if char in "。，；：？" or len(cur)>=25:phrases.append(cur);cur=""
  if cur:phrases.append(cur)
  total=sum(len(s) for s in phrases)
  p=start
  for s in phrases:
   end=p+duration*len(s)/total
   caps.append({"start":p,"end":end,"text":s.rstrip("，。；：")});p=end
 return caps
def subtitle(im,caps,t):
 for c in caps:
  if c["start"]<=t<c["end"]:
   overlay=Image.new("RGBA",(W,H));d=ImageDraw.Draw(overlay)
   line=c["text"];tw=sum(d.textlength(run,font=font(30,kind)) for run,kind in split_runs(line))
   rr(d,((W-tw)/2-28,982,(W+tw)/2+28,1048),20,fill=(255,255,255,245),outline=(222,225,228,255))
   center(d,(W/2,991),line,30,WHITE)
   return Image.alpha_composite(im.convert("RGBA"),overlay).convert("RGB")
 return im
def srt_time(t):
 ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
 return f"{h:02}:{m:02}:{s:02},{ms:03}"
def moving_pip(im,fr,p):
 p=ease(p)
 x=round(950*p);y=round(213*p)
 w=round(W+(422-W)*p);h=round(H+(221-H)*p)
 roi=(round(14*p),round(62*p),round(W+(1424-W)*p),round(H+(802-H)*p))
 im.paste(fr.crop(roi).resize((w,h),Image.Resampling.BILINEAR),(x,y))
 return im
def light_push(im,tm,seconds):
 amount=1+.006*ease(tm/seconds)
 nw=round(W*amount);nh=round(H*amount)
 z=im.resize((nw,nh),Image.Resampling.BICUBIC)
 return z.crop(((nw-W)//2,(nh-H)//2,(nw+W)//2,(nh+H)//2))
def render_light(t,raw,actual,caps):
 if t<30:
  return subtitle(light_push(intro(t),t,30),caps,t)
 if t<30.5:
  return Image.blend(light_push(intro(29.8),29.8,30),actual,ease((t-30)/.5))
 if t<72 or t>=233:return actual
 if t<73:
  im=light_push(chapter(1,t-72,None),t-72,40)
  return subtitle(moving_pip(im,raw,t-72),caps,t)
 if 232<=t<233:
  im=light_push(chapter(4,39.5,None),39.5,40)
  return subtitle(moving_pip(im,raw,1-(t-232)),caps,t)
 idx=1+int((t-72)//40);tm=t-(72+(idx-1)*40)
 im=light_push(chapter(idx,tm,None),tm,40)
 # Preserve exact original inset image pixels, including existing map/camera colours.
 d=ImageDraw.Draw(im)
 text(d,(950,177),"现场实录",22,WHITE);text(d,(1210,179),"相机 + 导航",19,MUTED)
 rr(d,(948,211,1374,436),16,fill=None,outline=LINE,width=1)
 im.paste(actual.crop((950,213,1372,434)),(950,213))
 return subtitle(im,caps,t)
def main():
 parser=argparse.ArgumentParser();parser.add_argument("--preview",action="store_true");args=parser.parse_args()
 OUT.mkdir(exist_ok=True)
 caps=captions_from_timeline(ROOT/"artifacts/demo-project-film-20261014/narration-cues-reviewed.json")
 active=ROOT/"artifacts/demo-project-film-20261014/final/project-film.mp4"
 rawfile=ROOT/"artifacts/demo-project-film-20261014/film-footage.mp4"
 if args.preview:
  (OUT/"previews").mkdir(exist_ok=True)
  for t in [0,16,23,30.3,38.6,78,88,121,161,206,220,232.5,267]:
   def extract(path,sec):
    data=subprocess.check_output([str(FF),"-v","error","-ss",str(sec),"-i",str(path),"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","-"])
    return Image.frombytes("RGB",(W,H),data)
   actual=extract(active,t)
   raw=extract(rawfile,max(0,t-30)) if t>=30 else None
   render_light(t,raw,actual,caps).save(OUT/"previews"/f"scene-{str(t).replace('.','p')}.jpg",quality=92)
  print(json.dumps({"previews":str(OUT/"previews")}))
  return
 output=OUT/"project-film-light-silent-v3.mp4"
 assert not output.exists()
 original_hash=hashlib.file_digest(active.open("rb"),"sha256").hexdigest()
 original=subprocess.Popen([str(FF),"-nostdin","-v","error","-i",str(active),"-an","-sn","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE,stderr=(OUT/"original-decode.log").open("wb"))
 rawproc=subprocess.Popen([str(FF),"-nostdin","-v","error","-i",str(rawfile),"-an","-sn","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE,stderr=(OUT/"raw-decode.log").open("wb"))
 encoder=subprocess.Popen([str(FF),"-nostdin","-hide_banner","-loglevel","warning","-n","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r","30","-i","-","-an","-c:v","libx264","-preset","fast","-crf","17","-pix_fmt","yuv420p","-movflags","+faststart",str(output)],stdin=subprocess.PIPE,stderr=(OUT/"light-encode.log").open("wb"))
 hashes={"full_source":hashlib.sha256(),"full_input":hashlib.sha256(),"pip_source":hashlib.sha256(),"pip_input":hashlib.sha256()}
 counts={"full_frames":0,"pip_frames":0}
 began=time.time()
 for frame in range(9000):
  t=frame/30
  original_bytes=original.stdout.read(W*H*3);assert len(original_bytes)==W*H*3
  actual=Image.frombytes("RGB",(W,H),original_bytes)
  raw=None
  if frame>=900:
   raw_bytes=rawproc.stdout.read(W*H*3);assert len(raw_bytes)==W*H*3
   raw=Image.frombytes("RGB",(W,H),raw_bytes)
  im=render_light(t,raw,actual,caps)
  data=im.tobytes()
  if (915<=frame<2160) or frame>=6990:
   assert data==original_bytes
   hashes["full_source"].update(frame.to_bytes(4,"big")+original_bytes);hashes["full_input"].update(frame.to_bytes(4,"big")+data);counts["full_frames"]+=1
  elif 2190<=frame<6960:
   a=actual.crop((950,213,1372,434)).tobytes();b=im.crop((950,213,1372,434)).tobytes()
   assert a==b
   hashes["pip_source"].update(frame.to_bytes(4,"big")+a);hashes["pip_input"].update(frame.to_bytes(4,"big")+b);counts["pip_frames"]+=1
  encoder.stdin.write(data)
  if frame%900==0:print(json.dumps({"frame":frame,"seconds":t,"elapsed":round(time.time()-began,1)}),flush=True)
 assert original.stdout.read(1)==b"" and rawproc.stdout.read(1)==b""
 encoder.stdin.close();assert encoder.wait()==0 and original.wait()==0 and rawproc.wait()==0
 report={"source_movie":{"path":str(active.relative_to(ROOT)),"sha256":original_hash},"output_silent":{"path":str(output.relative_to(ROOT)),"sha256":hashlib.file_digest(output.open("rb"),"sha256").hexdigest()},"preservation":{"source_input_rgb_byte_hashes":{k:v.hexdigest() for k,v in hashes.items()},**counts,"full_frame_ranges_seconds":[[30.5,72],[233,300]],"steady_pip_ranges_seconds":[[73,232]],"pip_roi":[950,213,422,221],"exact_input_rgb_match":True},"style":{"background":BG,"cards":PANEL,"ink":WHITE,"accent":ORANGE,"grid":"#EFF1F3","zoom_max":1.006,"animation_only":True},"frames":9000,"duration_seconds":300,"model_or_robot_actions":False}
 (OUT/"render-preservation-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
 audit={"source_active_sha256":original_hash,"full_frame_count":counts["full_frames"],"pip_frame_count":counts["pip_frames"],"full_frame_input_sha256":hashes["full_input"].hexdigest(),"full_frame_reference_sha256":hashes["full_source"].hexdigest(),"pip_input_sha256":hashes["pip_input"].hexdigest(),"pip_reference_sha256":hashes["pip_source"].hexdigest(),"hash_frame_index":"4-byte big endian then RGB pixels"}
 (OUT/"preservation-audit.json").write_text(json.dumps(audit,indent=2)+"\n")
 print(json.dumps(report))
if __name__=="__main__":main()
