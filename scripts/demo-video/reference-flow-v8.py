"""Code-native reconstruction of the four user diagrams; no raster reference editing.
All labels are locked verbatim. Only connector topology, moving data dots and card emphasis animate.
"""
from pathlib import Path
import importlib.util, math, json
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path('/data-ssd/zhongchengkai/agnes')
spec=importlib.util.spec_from_file_location('film_base_v5',ROOT/'scripts/demo-video/render-project-film-map25d-v5.py')
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
CW,CH=1448,1086
ORANGE='#FF651C';INK='#101317';GRAY='#667086';BG='#F5F7F8';GRID='#EDF1F3'
TEXT=[]
def txt(d,x,y,s,size=26,col=GRAY):
 TEXT.append(s);B.text(d,(x,y),s,size,col)
def fit_txt(d,x,y,s,size,width,col=GRAY):
 while size>12 and sum(d.textlength(run,font=B.font(size,kind)) for run,kind in B.split_runs(s))>width:size-=1
 txt(d,x,y,s,size,col)
def line(d,points,col=ORANGE,width=2):d.line(points,fill=col,width=width,joint='curve')
def disk(d,x,y,r=4,col=ORANGE):d.ellipse((x-r,y-r,x+r,y+r),fill=col)
def rounded_path(points,r=15):
 out=[points[0]]
 for a,b,c in zip(points,points[1:],points[2:]):
  la=math.dist(a,b);lb=math.dist(b,c);rad=min(r,la/2,lb/2)
  if not la or not lb:continue
  p=(b[0]+(a[0]-b[0])*rad/la,b[1]+(a[1]-b[1])*rad/la)
  q=(b[0]+(c[0]-b[0])*rad/lb,b[1]+(c[1]-b[1])*rad/lb)
  out.append(p)
  for i in range(1,11):
   u=i/10;out.append(((1-u)**2*p[0]+2*(1-u)*u*b[0]+u*u*q[0],(1-u)**2*p[1]+2*(1-u)*u*b[1]+u*u*q[1]))
 out.append(points[-1]);return out
def point_at(points,p):
 lengths=[math.dist(a,b)for a,b in zip(points,points[1:])];dist=sum(lengths)*max(0,min(1,p))
 for a,b,l in zip(points,points[1:],lengths):
  if dist<=l:return (a[0]+(b[0]-a[0])*dist/l,a[1]+(b[1]-a[1])*dist/l)
  dist-=l
 return points[-1]
def connection(d,points,dashed=False):
 pts=rounded_path(points);length=sum(math.dist(a,b)for a,b in zip(pts,pts[1:]))
 if dashed:
  for j in range(int(length/12)+1):
   a=point_at(pts,j*12/length);b=point_at(pts,min(1,(j*12+6)/length));line(d,[a,b],width=2)
 else:line(d,pts,width=2)
 disk(d,*points[0],4);disk(d,*points[-1],4)
 return pts
def transfer(d,pts,progress):
 if not 0<=progress<=1:return
 x,y=point_at(pts,B.ease(progress));disk(d,x,y,9,'#FFFFFF');disk(d,x,y,5,ORANGE)
@lru_cache(maxsize=32)
def shadow(w,h):
 im=Image.new('RGBA',(w+60,h+60));d=ImageDraw.Draw(im);d.rounded_rectangle((30,37,w+30,h+37),24,fill=(42,53,62,14));return im.filter(ImageFilter.GaussianBlur(13))
ALIGNMENT_CARDS=[];ALIGNMENT_ICONS=[]
def card(im,box,accent_x=None):
 x0,y0,x1,y1=box;sh=shadow(x1-x0,y1-y0);im.paste(sh,(x0-30,y0-30),sh)
 d=ImageDraw.Draw(im);d.rounded_rectangle(box,24,fill='#FFFFFF')
 cx=x0+48.5 if accent_x is None else accent_x
 if accent_x is not None:ALIGNMENT_CARDS.append({'bounds':list(box),'accent_center_x':cx,'accent_bounds':[cx-24.5,y0+9,cx+24.5,y0+15]})
 line(d,[(cx-24.5,y0+12),(cx+24.5,y0+12)],width=6)
def header(title,subtitle,index):
 im=Image.new('RGB',(CW,CH),BG);d=ImageDraw.Draw(im)
 for x in range(0,CW,35):line(d,[(x,0),(x,CH)],GRID,1)
 for y in range(0,CH,35):line(d,[(0,y),(CW,y)],GRID,1)
 txt(d,58,25,'AGNES / EMBODIED RESCUE',15,GRAY)
 txt(d,58,67,'Agnes',94,INK);line(d,[(367,74),(367,175)],'#8C94A1',1)
 txt(d,404,82,title,44,INK);txt(d,404,147,subtitle,24)
 line(d,[(57,1019),(1392,1019)],ORANGE,1)
 return im
def icon(d,kind,x,y,s=1,col=INK):
 def p(a,b):return x+a*s,y+b*s
 def l(v,w=3):line(d,[p(a,b)for a,b in v],col,max(1,round(w*s)))
 def e(a,b,c,f,fill=None):d.ellipse((*p(a,b),*p(c,f)),outline=col,width=max(1,round(3*s)),fill=fill)
 def rr(a,b,c,f,r=4):d.rounded_rectangle((*p(a,b),*p(c,f)),r*s,outline=col,width=max(1,round(3*s)))
 if kind=='user':
  e(-7,-18,7,-4);rr(-12,-4,12,14,7)
 elif kind=='brain':
  # Symmetric lobes and folds, matching the supplied brain glyph.
  for sx in [-1,1]:
   l([(sx*2,-22),(sx*11,-23),(sx*15,-16),(sx*21,-12),(sx*22,-3),(sx*17,3),(sx*21,11),(sx*17,20),(sx*8,22),(sx*2,16)])
   l([(sx*6,-12),(sx*11,-7),(sx*7,-1),(sx*11,7),(sx*8,13)])
  l([(0,-22),(0,20)])
 elif kind=='puzzle':
  l([(-19,-14),(-6,-14),(-6,-20),(-2,-24),(5,-24),(9,-19),(9,-14),(19,-14),(19,-2),(25,-2),(29,3),(25,9),(19,9),(19,21),(5,21),(5,14),(0,10),(-5,14),(-5,21),(-19,21),(-19,8),(-12,8),(-8,3),(-12,-2),(-19,-2),(-19,-14)])
 elif kind=='robot':
  rr(-18,-15,18,18,7);l([(0,-15),(0,-25)]);e(-4,-33,4,-25);e(-10,-7,-4,-1);e(4,-7,10,-1);l([(-8,9),(8,9)]);l([(-25,-1),(-20,-1)]);l([(20,-1),(25,-1)])
 elif kind=='door':
  l([(-14,-25),(15,-25),(15,25),(-14,25),(-14,-25)]);l([(-10,-23),(9,-18),(9,24)]);e(3,0,5,3)
 elif kind=='database':
  e(-18,-23,18,-8);l([(-18,-16),(-18,17)]);l([(18,-16),(18,17)])
  for yy in [-3,10,17]:d.arc((*p(-18,yy-7),*p(18,yy+7)),0,180,fill=col,width=max(1,round(3*s)))
 elif kind=='cube':
  l([(0,-25),(23,-13),(0,0),(-23,-13),(0,-25)]);l([(-23,-13),(-23,14),(0,27),(23,14),(23,-13)]);l([(0,0),(0,27)])
 elif kind=='camera':
  rr(-28,-16,28,23,5);l([(-12,-16),(-8,-26),(11,-26),(16,-16)]);e(-12,-9,12,15);disk(d,*p(20,-6),2,col)
 elif kind=='pin':
  e(-14,-22,14,6);d.polygon([p(-12,1),p(12,1),p(0,22)],fill='#FFFFFF',outline=col);e(-4,-13,4,-5)
 elif kind=='nav':
  l([(-17,-1),(18,-20),(6,20),(-1,5),(-17,-1)])
 elif kind=='link':
  d.arc((*p(-25,-2),*p(4,26)),30,220,fill=col,width=5);d.arc((*p(-4,-26),*p(25,2)),210,400,fill=col,width=5);l([(-9,9),(11,-11)],5)
 elif kind=='target':
  e(-20,-20,20,20);e(-5,-5,5,5)
  for a,b in [[(-28,0),(-18,0)],[(18,0),(28,0)],[(0,-28),(0,-18)],[(0,18),(0,28)]]:l([a,b],4)
 elif kind=='scan':
  for radius in [15,26,37]:d.arc((*p(-radius,-radius),*p(radius,radius)),205,335,fill=col,width=3)
  disk(d,*p(0,12),5,col)
 elif kind=='file':
  l([(-7,-12),(3,-12),(9,-6),(9,12),(-7,12),(-7,-12)]);l([(3,-12),(3,-6),(9,-6)]);l([(-3,0),(5,0)]);l([(-3,5),(5,5)])
_ICON_CELLS={}
def icon_cell(d,kind,x,y,size=44):
 # Equal 44px glyph bounds and 56px layout cells align artwork and card columns.
 if (kind,size)not in _ICON_CELLS:
  asset=Image.new('RGBA',(256,256));ad=ImageDraw.Draw(asset);icon(ad,kind,128,128,2)
  asset=asset.crop(asset.getbbox())
  if kind=='user':asset.thumbnail((size,size),Image.Resampling.LANCZOS)
  else:asset=asset.resize((size,size),Image.Resampling.LANCZOS)
  _ICON_CELLS[kind,size]=asset
 glyph=_ICON_CELLS[kind,size];left=round(x-glyph.width/2);top=round(y-glyph.height/2)
 ALIGNMENT_ICONS.append({'kind':kind,'center':[x,y],'layout_bounds':[x-28,y-28,x+28,y+28],'art_bounds':[left,top,left+glyph.width,top+glyph.height]})
 d._image.paste(glyph,(left,top),glyph)
def badge(d,kind,x,y,r=54):
 d.ellipse((x-r,y-r,x+r,y+r),fill='#FFF2EC');icon(d,kind,x,y,1,ORANGE)
def architecture():
 im=header('系统架构与任务执行','原生会话组织决策，MCP 连接执行与观测',1)
 for box,cx in [((501,201,947,269),591),((63,291,1385,496),None),((82,389,614,483),159),((831,389,1366,483),909),((82,562,614,668),159),((831,562,1366,668),909),((82,705,614,869),159),((82,901,1366,989),159)]:card(im,box,cx)
 d=ImageDraw.Draw(im);icon_cell(d,'user',591,239,36);txt(d,630,219,'用户 · 原生 Web Chat',28,INK)
 txt(d,95,309,'Agnes Harness',34,INK);txt(d,96,352,'会话运行 · 模型调用 · 工具权限',22)
 icon_cell(d,'brain',159,437);txt(d,213,403,'Session / Agent',29,INK);txt(d,213,442,'理解任务 · 选择工具 · 处理结果',22)
 icon_cell(d,'puzzle',909,437);txt(d,960,403,'Rescue Plugin',29,INK);txt(d,960,442,'Skills · MissionState · WorldMemory',22)
 txt(d,659,400,'方法与状态工具',19)
 icon_cell(d,'robot',159,615);txt(d,213,573,'Robot MCP · 8 个工具',29,INK);txt(d,213,611,'机器人状态与导航动作',22);txt(d,213,638,'现场观察与主动复检',22)
 icon_cell(d,'door',909,612);txt(d,960,575,'环境交互 MCP',29,INK);txt(d,960,613,'地图先验 · 房门检查与操作',22)
 txt(d,619,502,'MCP 工具调用 / 结果返回',20)
 icon_cell(d,'database',159,746);txt(d,213,714,'ROS2 执行与观测',29,INK)
 d.rounded_rectangle((213,760,585,829),15,fill='#F8FAFC',outline='#E6ECF2',width=2)
 icon(d,'pin',266,797,1,GRAY);txt(d,313,768,'Nav2 导航',24);txt(d,313,797,'NavigateToPose Action',21)
 txt(d,212,835,'TF / Camera / LiDAR：位姿与传感器',21)
 txt(d,361,674,'JSONL / rclpy',21);txt(d,366,868,'ros_gz_bridge',21)
 txt(d,744,737,'读取位姿与相机',19);txt(d,1118,749,'Gazebo Transport',21);txt(d,1118,780,'关节控制 / 状态验证',20)
 icon_cell(d,'cube',159,950);txt(d,213,915,'Gazebo 仿真世界',29,INK);txt(d,213,953,'机器人动力学 · Camera · LiDAR · 房门',21)
 txt(d,538,983,'工具结果回到 Agent，支持后续决策与最终报告',18)
 paths=[connection(d,[(723,272),(723,287)]),connection(d,[(620,435),(823,435)],True),connection(d,[(348,489),(348,558)]),connection(d,[(348,531),(1099,531),(1099,558)]),connection(d,[(348,674),(348,700)]),connection(d,[(348,874),(348,896)]),connection(d,[(1099,674),(1099,897)]),connection(d,[(974,674),(974,774),(620,774)],True)]
 return im,paths,[(82,389,614,483),(831,389,1366,483),(82,562,614,668),(831,562,1366,668),(82,705,614,869),(82,901,1366,989)]
def perception():
 im=header('现场感知与机器人定位','视觉提供目标线索，定位提供地图坐标',2)
 for box in [(63,232,710,700),(736,232,1387,700),(63,783,1387,941)]:card(im,box)
 d=ImageDraw.Draw(im);txt(d,87,268,'视觉感知',39,INK);txt(d,762,268,'地图定位',39,INK)
 badge(d,'camera',145,406,58);txt(d,238,361,'实时识别',29,INK);txt(d,239,402,'当前 Camera 帧输入 Agnes 视觉模型',26);txt(d,239,439,'识别人员、房门与物体线索',26)
 badge(d,'scan',143,548,61);badge(d,'target',143,620,55);txt(d,238,522,'主动观察',29,INK);txt(d,239,565,'原地环视扩大观察范围',26);txt(d,239,603,'针对可疑目标获取新视角并复检',26)
 x0,y0=768,356
 for points in [[(0,170),(0,0),(29,0)],[(62,0),(105,0)],[(142,0),(196,0),(196,108),(182,108),(182,170)],[(0,207),(0,276),(69,276)],[(105,275),(135,275),(135,305),(196,305),(196,177),(162,177)],[(78,0),(78,78),(70,78)],[(163,0),(163,33),(193,33)],[(0,179),(38,179),(38,217)],[(70,232),(193,232)]]:line(d,[(x0+x,y0+y)for x,y in points],'#ADB3BE',7)
 d.polygon([(815,457),(865,540),(915,457)],fill='#FDE6D8');d.ellipse((829,507,903,581),outline=ORANGE,width=1)
 for st in range(0,360,30):d.arc((829,507,903,581),st,st+18,fill=ORANGE,width=2)
 d.polygon([(865,530),(852,561),(865,555),(878,561)],fill=ORANGE)
 badge(d,'pin',1029,402,39);txt(d,1087,379,'办公室场景',29,INK);fit_txt(d,1087,425,'激光雷达与里程计支持 AMCL 定位',20,277)
 badge(d,'nav',1029,578,39);txt(d,1087,553,'坐标与朝向',29,INK);fit_txt(d,1087,600,'TF 提供机器人在地图中的位姿',20,277)
 badge(d,'link',155,863,61);txt(d,249,819,'联合使用',35,INK);txt(d,250,875,'结合视觉线索、语义区域和当前位姿，选择下一处搜索位置。',26)
 txt(d,356,964,'图像位置不直接等于地图坐标；当前视角未见目标，不代表区域无人。',24,ORANGE)
 paths=[connection(d,[(383,703),(383,739),(724,739),(724,780)]),connection(d,[(1064,703),(1064,739),(724,739),(724,780)])]
 return im,paths,[(63,232,710,700),(736,232,1387,700),(63,783,1387,941)]
def closed_loop():
 im=header('任务闭环与结果验证','行动读取实际结果，新证据写回任务记忆',3)
 boxes=[(107,236,579,456),(870,236,1342,456),(870,604,1342,825),(107,604,579,825)]
 for box in boxes:card(im,box)
 d=ImageDraw.Draw(im)
 items=[('01','观察与决策',['读取位姿、图像和任务记忆','选择搜索区域或交互动作']),('02','执行与等待',['跟踪同一个操作编号','等待终态，避免重复下发']),('03','结果验证',['导航检查实际终态','开门检查门扇状态与新图像']),('04','记忆与报告',['记录区域、线索和失败原因','证据不足时复检或报告限制'])]
 for box,(n,title,body)in zip(boxes,items):
  x,y,_,_=box;txt(d,x+26,y+38,n,45,ORANGE);txt(d,x+106,y+43,title,38,INK)
  for k,s in enumerate(body):fit_txt(d,x+106,y+106+k*43,s,27,346)
 for rad,c in [(113,'#FFF5EE'),(96,'#FFE1D0'),(73,'#FFF2EA')]:d.ellipse((724-rad,518-rad,724+rad,518+rad),fill=c,outline='#FFFFFF',width=1)
 d.ellipse((611,405,837,631),outline=ORANGE,width=1)
 txt(d,666,501,'任务闭环',29,ORANGE)
 for x,y in [(724,405),(837,518),(724,631),(611,518)]:disk(d,x,y,5)
 for a,b in [[(724,349),(724,399)],[(844,518),(895,518)],[(724,638),(724,686)],[(555,518),(604,518)]]:line(d,[a,b],'#FBDCCA',1)
 paths=[connection(d,[(589,320),(605,303),(847,303)]),connection(d,[(1111,467),(1111,590)]),connection(d,[(861,715),(845,731),(595,731)]),connection(d,[(348,594),(335,578),(335,467)])]
 d.rounded_rectangle((102,871,1346,945),23,fill='#EBEFF2',outline='#FFFFFF',width=1)
 txt(d,355,890,'READY：组件可用',27);line(d,[(630,888),(630,927)],'#9BA2AE',1);txt(d,688,890,'任务结果：本轮工具终态与观测证据',25)
 txt(d,485,969,'任务执行可能失败或中断，最终报告保留真实结果。',23)
 return im,paths,boxes

def smallmap(d,x,y):
 # Door gaps remain explicit in the supplied illustrative skeleton.
 walls=[[(0,133),(0,43),(91,43),(91,-3),(124,-3)],[(124,3),(258,3),(258,132),(132,132)],[(0,133),(93,133)],[(158,132),(158,67),(257,67)],[(208,3),(208,66)],[(91,43),(91,81)]]
 for ps in walls:line(d,[(x+a,y+b)for a,b in ps],'#BBC1CA',9)
 for xx,yy in [(106,133),(210,67)]:d.arc((x+xx-4,y+yy-32,x+xx+31,y+yy+4),0,90,fill='#B9C0CC',width=1)
 route=[(31,105),(132,105),(132,44),(207,44)]
 for a,b in zip(route,route[1:]):
  L=math.dist(a,b)
  for k in range(int(L/10)+1):
   q=k*10/L;end=min(1,(k*10+5)/L);line(d,[(x+a[0]+(b[0]-a[0])*q,y+a[1]+(b[1]-a[1])*q),(x+a[0]+(b[0]-a[0])*end,y+a[1]+(b[1]-a[1])*end)],width=1)
 disk(d,x+31,y+105,7)
def layers(d,x,y,scale=1):
 def p(dx,dy):return x+dx*scale,y+dy*scale
 for yy in [0,65,130]:
  poly=[p(0,yy),p(107,yy-57),p(194,yy-14),p(87,yy+43)]
  d.polygon(poly,fill='#F5F7F9',outline='#CBD2DE');
  for a in range(1,5):line(d,[p(a*21,yy-a*11),p(87+a*21,yy+43-a*11)],'#DEE4EB',1)
  for a in range(1,4):line(d,[p(a*23,yy+a*11),p(107+a*23,yy-57+a*11)],'#DEE4EB',1)
 for poly in [[(77,-11),(111,-30),(127,-22),(93,-3)],[(112,6),(154,-17),(176,-6),(134,17)],[(33,15),(55,3),(75,13),(53,25)]]:d.polygon([p(a,b)for a,b in poly],fill='#B7BEC9')
 for dx,dy in [(81,148),(126,172),(164,142)]:d.ellipse((*p(dx-10,dy-6),*p(dx+10,dy+6)),fill='#FFE1D1')
 icon(d,'cube',*p(128,158),.43*scale,ORANGE)
 B.person(d,*p(49,154),.35*scale,ORANGE)
 return [p(108,76),p(108,111)]
def reuse():
 im=header('地图骨架与场景复用','结构化描述不同空间，复用同一套高层能力',4)
 boxes=[(57,232,694,550),(755,232,1393,550),(57,595,694,878),(755,595,1393,878)]
 for box in boxes:card(im,box)
 d=ImageDraw.Draw(im)
 for b,n,title in zip(boxes,['01','02','03','04'],['骨架描述','编译与生成','安全切换','切换后验证']):
  txt(d,b[0]+24,b[1]+43,n,52,ORANGE);txt(d,b[0]+112,b[1]+47,title,37,INK)
 txt(d,82,350,'房间、走廊、墙体、门洞与出生点',26);txt(d,82,391,'明确空间边界和区域连接',26);smallmap(d,398,381)
 fit_txt(d,781,349,'生成 Gazebo 场景、导航地图与语义位置',25,418);txt(d,781,393,'在所选布局中布置人员与物品',25);layerpath=layers(d,1220,355,.7)
 fit_txt(d,82,714,'上传、命名和预览不自动激活',26,354);fit_txt(d,82,754,'任务空闲且运动锁可用后确认切换',26,354)
 d.rounded_rectangle((450,662,669,827),10,fill='#FFFFFF',outline='#E9EDF2',width=1)
 d.rounded_rectangle((458,671,661,716),9,fill='#FFEBE0')
 for j,s in enumerate(['经典地图','简化莲华古城','办公室火灾']):
  yy=690+j*49;icon(d,'file',480,yy+4,.8,GRAY);txt(d,504,yy-12,s,19);d.ellipse((633,yy-5,652,yy+14),outline=ORANGE if j==0 else '#CAD0DA',width=1)
  if j==0:disk(d,642,yy+4,6)
 fit_txt(d,782,715,'校对新地图、机器人位姿与 Camera',25,410);fit_txt(d,782,755,'关联新会话，避免沿用旧场景状态',25,410)
 d.rounded_rectangle((1219,661,1364,767),5,fill='#F4F6F8',outline='#BEC5CF',width=5)
 for xx in range(1230,1355,23):line(d,[(xx,669),(xx,759)],'#DDE3E9',1)
 for yy in range(669,760,22):line(d,[(1227,yy),(1355,yy)],'#DDE3E9',1)
 for b in [(1230,695,1264,717),(1307,685,1327,701),(1307,722,1352,739)]:d.rectangle(b,fill='#B3BBC7')
 d.polygon([(1284,721),(1229,740),(1308,760)],fill='#F9E2D6');d.polygon([(1278,725),(1295,715),(1294,736)],fill=ORANGE)
 d.rounded_rectangle((1178,789,1253,824),8,fill='#A4ADB9',outline='#626B7A',width=2)
 for xx in [1182,1204,1248]:d.ellipse((xx-10,813,xx+10,840),fill='#606978',outline='#3F4753',width=2)
 line(d,[(1214,789),(1214,763)],'#687384',5);d.rectangle((1206,752,1223,769),fill='#A4ADB9',outline='#657081',width=2)
 txt(d,418,927,'当前场景：经典地图 / 简化莲华古城 / 办公室火灾',28,ORANGE)
 txt(d,61,1034,'当前为 Gazebo 仿真验证。真机部署与完整搜救稳定性仍需进一步验证。',18)
 paths=[connection(d,[(697,393),(751,393)]),connection(d,[(374,553),(374,591)]),connection(d,[(1074,553),(1074,591)]),connection(d,[(697,743),(751,743)]),connection(d,layerpath)]
 return im,paths,boxes
BUILDERS=[architecture,perception,closed_loop,reuse]
SCENES=[];LABELS=[]
for builder in BUILDERS:
 TEXT.clear();SCENES.append(builder());LABELS.append(TEXT.copy())

def animated(idx,tm,duration):
 static,paths,boxes=SCENES[idx];im=static.copy();d=ImageDraw.Draw(im)
 # One meaningful transfer at a time, with a short return leg for action results.
 if idx==0:
  steps=[(0,False,0),(1,False,1),(2,False,2),(4,False,4),(5,False,5),(5,True,4),(4,True,2),(2,True,0),(3,False,3),(6,False,5),(7,False,4),(4,True,2),(2,True,0),(1,True,1)]
 elif idx==1:steps=[(0,False,0),(1,False,1),(0,False,2),(1,False,2)]
 elif idx==2:steps=[(0,False,0),(1,False,1),(2,False,2),(3,False,3)]
 else:steps=[(0,False,0),(4,False,1),(1,False,2),(3,False,3),(2,False,3)]
 # Sequence covers the entire narration, without a motionless tail.
 interval=duration/len(steps);position=min(len(steps)-1,int(tm/interval));path_id,reverse,box_id=steps[position]
 progress=(tm-position*interval)/interval;transfer(d,list(reversed(paths[path_id])) if reverse else paths[path_id],progress)
 box=boxes[min(box_id,len(boxes)-1)];d.rounded_rectangle((box[0]+2,box[1]+2,box[2]-2,box[3]-2),22,outline='#FFA16F',width=1)
 # Gentle progress in the original circular diagram, not an arrowhead.
 if idx==2:
  a=(tm/duration)*360-90;d.arc((618,412,830,624),a-16,a+16,fill=ORANGE,width=3)
 if idx==1:
  # Evidence scanner stays around the fixed robot position; never crosses a wall.
  a=(tm*28)%360;d.arc((827,505,905,583),a,a+42,fill=ORANGE,width=3)
 return im

def compose(idx,tm,duration,recorded,caps,source_time):
 # Preserve the entire reference layout and footer, with a separate caption band.
 im=Image.new('RGB',(B.W,B.H),BG);slide=animated(idx,tm,duration)
 slide=slide.resize((1320,990),Image.Resampling.LANCZOS);im.paste(slide,(59,0))
 # Keep the actual chronological camera/map recording in the unused header corner.
 inset=recorded.crop((950,213,1372,434)).resize((332,174),Image.Resampling.LANCZOS)
 im.paste(inset,(1040,23));d=ImageDraw.Draw(im);d.rounded_rectangle((1038,21,1374,199),12,outline='#D9DFE4',width=1)
 return B.subtitle(im,caps,source_time)
