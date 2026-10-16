from pathlib import Path
import json, math, argparse, subprocess, hashlib, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT=Path("/data-ssd/zhongchengkai/agnes")
OUT=ROOT/"artifacts/demo-project-film-20261014"
W,H=1438,1080
FONT=ROOT/"artifacts/demo-video-20261013/assets/fonts/NotoSansCJKsc-Regular.otf"
FF=ROOT/"runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg"
BG="#101c2b"; PANEL="#192a3d"; WHITE="#eef5f7"; MUTED="#9fb3c5"; BLUE="#63d9dd"; ORANGE="#ffad73"; LINE="#36536b"
fonts={}
def font(n):
 if n not in fonts: fonts[n]=ImageFont.truetype(str(FONT),n)
 return fonts[n]
def text(d,xy,s,size=24,fill=WHITE):
 d.text(xy,s,font=font(size),fill=fill)
def rr(d,box,r=20,fill=PANEL,outline=None,width=2):
 d.rounded_rectangle(box,r,fill=fill,outline=outline,width=width)
def center(d,xy,s,size=24,fill=WHITE):
 b=d.textbbox((0,0),s,font=font(size));text(d,(xy[0]-(b[2]-b[0])/2,xy[1]),s,size,fill)
def ease(a): a=max(0,min(1,a));return a*a*(3-2*a)
def arrow(d,a,b,fill=BLUE,width=3):
 d.line((a,b),fill=fill,width=width)
 q=math.atan2(b[1]-a[1],b[0]-a[0])
 pts=[b,(b[0]-13*math.cos(q-.42),b[1]-13*math.sin(q-.42)),(b[0]-13*math.cos(q+.42),b[1]-13*math.sin(q+.42))]
 d.polygon(pts,fill=fill)
def dotflow(d,a,b,t,fill=BLUE):
 arrow(d,a,b,LINE,3)
 for k in range(3):
  p=(t*.22+k/3)%1
  x=a[0]+(b[0]-a[0])*p;y=a[1]+(b[1]-a[1])*p
  d.ellipse((x-5,y-5,x+5,y+5),fill=fill)
def node(d,box,title,lines,active=False,color=BLUE):
 rr(d,box,22,fill="#21394b" if active else PANEL,outline=color if active else LINE,width=3)
 text(d,(box[0]+20,box[1]+16),title,29,color)
 for i,s in enumerate(lines):text(d,(box[0]+20,box[1]+65+i*34),s,22,WHITE if active else MUTED)
def robot(d,x,y,r=30,col=BLUE):
 d.ellipse((x-r,y-r,x+r,y+r),fill="#294753",outline=col,width=3)
 rr(d,(x-r*.7,y-r*.4,x+r*.7,y+r*.45),8,fill=col)
 d.ellipse((x-r*.35-4,y-4,x-r*.35+4,y+4),fill=BG)
 d.ellipse((x+r*.35-4,y-4,x+r*.35+4,y+4),fill=BG)
 d.line((x,y-r*.4,x,y-r*.8),fill=col,width=3);d.ellipse((x-4,y-r*.85-4,x+4,y-r*.85+4),fill=col)
def person(d,x,y,s=1,col=ORANGE):
 d.ellipse((x-10*s,y-33*s,x+10*s,y-13*s),fill=col)
 d.line((x,y-10*s,x,y+22*s),fill=col,width=max(2,int(7*s)))
 d.line((x-20*s,y+6*s,x,y-8*s,x+20*s,y+6*s),fill=col,width=max(2,int(6*s)))
 d.line((x-16*s,y+48*s,x,y+19*s,x+16*s,y+48*s),fill=col,width=max(2,int(6*s)))
def flame(d,x,y,s=1,tm=0):
 sw=math.sin(tm*3+x)*8*s
 poly=[(x-19*s,y+15*s),(x-24*s,y-9*s),(x-10*s,y-40*s),(x-1*s+sw,y-66*s),(x+11*s,y-22*s),(x+22*s,y-10*s),(x+17*s,y+15*s)]
 d.polygon(poly,fill="#d96a4a")
 d.polygon([(x-10*s,y+12*s),(x-11*s,y-7*s),(x+sw*.3,y-28*s),(x+10*s,y-1*s),(x+9*s,y+12*s)],fill=ORANGE)
def mapdraw(d,box,variant=0,tm=0,fire=False,bot=True):
 x0,y0,x1,y1=box
 rr(d,box,22,fill="#20364a",outline=LINE)
 def p(x,y):return (x0+25+x*(x1-x0-50),y0+25+y*(y1-y0-50))
 segments=[((0,0),(1,0)),((1,0),(1,1)),((1,1),(0,1)),((0,1),(0,0))]
 if variant==0:
  segments += [((.62,0),(.62,.23)),((.62,.35),(.62,.42)),((.62,.42),(1,.42)),((.62,.42),(.62,.60)),((.62,.73),(.62,1)),((.62,.76),(1,.76)),((0,.32),(.41,.32)),((.55,.32),(.62,.32))]
 else:
  segments += [((.50,0),(.50,.18)),((.5,.31),(.5,.5)),((.5,.5),(1,.5)),((.5,.5),(.5,.67)),((.5,.80),(.5,1)),((0,.37),(.29,.37)),((.41,.37),(.5,.37))]
 for a,b in segments:d.line((p(*a),p(*b)),fill="#8cbecb",width=6)
 if fire:
  for a,b in [(.10,.13),(.77,.67),(.88,.17)]:flame(d,*p(a,b),s=.6,tm=tm)
 if bot:robot(d,*p(.40,.87),r=19)
def base(title,k,small="AGNES / EMBODIED RESCUE"):
 im=Image.new("RGB",(W,H),BG);d=ImageDraw.Draw(im)
 for x in range(0,W,38):
  for y in range(0,940,38):d.ellipse((x,y,x+1,y+1),fill="#1b3042")
 text(d,(60,37),small,19,BLUE);text(d,(60,80),title,43)
 rr(d,(60,155,1378,158),2,fill=LINE)
 text(d,(61,939),"目标 · 观测 · 行动 · 反馈",19,MUTED)
 text(d,(1185,937),"原理示意",19,MUTED)
 return im
titles=["让机器人先进入危险空间","从一句话到机器人动作","让图像理解与定位各司其职","在环境反馈中完成动作","换一套骨架，沿用同一套能力"]
bases=[base(t,i) for i,t in enumerate(titles)]
def intro(tm):
 im=bases[0].copy();d=ImageDraw.Draw(im)
 mapdraw(d,(65,235,875,750),0,tm,True)
 text(d,(95,765),"已知室内骨架",31,BLUE)
 text(d,(95,812),"房间 · 墙体 · 门 · 起点",25,MUTED)
 rr(d,(942,250,1372,484),24,fill=PANEL,outline=LINE)
 text(d,(969,272),"远程任务",28,BLUE)
 text(d,(969,323),"请找到待救援人员",29)
 text(d,(969,384),"Agnes 原生对话",24,MUTED)
 dotflow(d,(930,520),(824,563),tm,ORANGE)
 robot(d,1000,586,37);text(d,(1060,562),"机器人执行",28);text(d,(1060,608),"进入 · 观察 · 回报",22,MUTED)
 for j,(label,s) in enumerate([("环境观察","相机图像"),("房门操作","导航与开门"),("人员确认","多视角复核")]):
  box=(943,687+j*68,1372,741+j*68);rr(d,box,13,fill=PANEL,outline=BLUE if int(tm/5)%3==j else LINE)
  text(d,(962,699+j*68),label,23,BLUE);text(d,(1115,699+j*68),s,21,MUTED)
 progress=ease((tm-3)/20)
 a=(399,650);b=(660,575)
 for j in range(16):
  q=j/15
  d.ellipse((a[0]+(b[0]-a[0])*q-3,a[1]+(b[1]-a[1])*q-3,a[0]+(b[0]-a[0])*q+3,a[1]+(b[1]-a[1])*q+3),fill=ORANGE if q<progress else LINE)
 robot(d,a[0]+(b[0]-a[0])*progress,a[1]+(b[1]-a[1])*progress,r=27,col=ORANGE)
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
  rr(d,(73,235,493,633),22,fill="#243949",outline=LINE)
  d.line((95,550,95,280,450,280,450,550),fill="#9eb9c6",width=9)
  rr(d,(323,305,435,556),4,fill="#2b4b5b",outline="#9eb9c6")
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
  robot(d,479,524,54);center(d,(479,592),"具身执行闭环",28,WHITE)
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
   text(d,(744,257+j*180),title,22,BLUE)
   for k,line in enumerate(lines):text(d,(744,309+j*180+k*27),line,19,MUTED)
  rr(d,(75,760,885,863),20,fill=PANEL,outline=LINE)
  steps=["空闲检查","可达性校验","切换场景","TF / 相机复验"]
  for j,s in enumerate(steps):
   text(d,(95+j*197,795),s,22,BLUE if int(tm/8)%4==j else MUTED)
  node(d,(950,576,1374,842),"适配目标",["当前：结构化骨架导入","当前：场景编译与切换","下一步：更多布局与真机"],True)
 return im
def full(fr,t):
 im=fr.copy();d=ImageDraw.Draw(im)
 rr(d,(W-158,18,W-18,56),15,fill="#152838")
 text(d,(W-145,24),"画面经剪辑",18,WHITE)
 if t>=285:
  rr(d,(45,770,517,855),18,fill="#152838",outline=BLUE)
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
   s=c["text"];b=d.textbbox((0,0),s,font=font(30));tw=b[2]-b[0]
   rr(d,((W-tw)/2-28,984,(W+tw)/2+28,1048),18,fill=(7,17,28,225))
   center(d,(W/2,991),s,30,WHITE)
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
def render(t,fr,caps):
 if t<30:im=intro(t)
 elif t<30.5:im=Image.blend(intro(29.8),full(fr,t),ease((t-30)/.5))
 elif t<72:im=full(fr,t)
 elif t<73:
  im=chapter(1,t-72,None);im=moving_pip(im,fr,t-72)
 elif 232<=t<233:
  im=chapter(4,39.5,None);im=moving_pip(im,fr,1-(t-232))
 elif t>=233:im=full(fr,t)
 else:
  idx=1+int((t-72)//40);im=chapter(idx,t-(72+(idx-1)*40),fr)
 return subtitle(im,caps,t)
def main():
 a=argparse.ArgumentParser();a.add_argument("--preview",action="store_true");a.add_argument("--timeline");a.add_argument("--footage");a.add_argument("--output",default=str(OUT/"project-film-silent-v1.mp4"));args=a.parse_args()
 caps=captions_from_timeline(Path(args.timeline) if args.timeline else None)
 if args.preview:
  (OUT/"animation-qa").mkdir(exist_ok=True)
  for t in [4,17,28,78,96,117,136,158,179,199,220]:
   im=render(t,Image.new("RGB",(W,H),"#334854"),caps);im.save(OUT/"animation-qa"/f"scene-{t:03}.jpg",quality=92)
  print(json.dumps({"previews":str(OUT/"animation-qa")}))
  return
 footage=Path(args.footage);output=Path(args.output)
 assert footage.exists() and not output.exists()
 decoder=subprocess.Popen([str(FF),"-nostdin","-v","error","-i",str(footage),"-an","-sn","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE,stderr=(OUT/"footage-decode.log").open("wb"))
 encoder=subprocess.Popen([str(FF),"-nostdin","-hide_banner","-loglevel","warning","-n","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r","30","-i","-","-an","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart",str(output)],stdin=subprocess.PIPE,stderr=(OUT/"animation-encode.log").open("wb"))
 started=time.time()
 for frame in range(9000):
  t=frame/30;fr=None
  if frame>=900:
   raw=decoder.stdout.read(W*H*3)
   if len(raw)!=W*H*3:raise RuntimeError(f"source ended at {frame} {len(raw)}")
   fr=Image.frombytes("RGB",(W,H),raw)
  im=render(t,fr,caps)
  encoder.stdin.write(im.tobytes())
  if frame%900==0:print(json.dumps({"frame":frame,"seconds":t,"elapsed":round(time.time()-started,1)}),flush=True)
 assert decoder.stdout.read(1)==b""
 encoder.stdin.close();assert encoder.wait()==0
 assert decoder.wait()==0
 if caps:
  srt=output.with_suffix(".zh-CN.srt")
  srt.write_text("\n\n".join(f'{i+1}\n{srt_time(c["start"])} --> {srt_time(c["end"])}\n{c["text"]}' for i,c in enumerate(caps))+"\n")
  (OUT/"caption-schedule.json").write_text(json.dumps({"kind":"Proportional clause timing across actual voice duration, not forced alignment","cues":caps},ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"output":str(output),"elapsed":round(time.time()-started,1),"frames":9000,"sha256":hashlib.file_digest(output.open("rb"),"sha256").hexdigest()}))
if __name__=="__main__":main()
