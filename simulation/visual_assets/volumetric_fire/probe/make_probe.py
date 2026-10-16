from pathlib import Path
import xml.etree.ElementTree as E
BASE=Path(__file__).resolve().parents[1]
def el(p,t,text=None,**attrs):
 e=E.SubElement(p,t,attrs)
 if text is not None:e.text=str(text)
 return e
root=E.Element("sdf",version="1.9");w=el(root,"world",name="volume_probe")
ph=el(w,"physics",name="default",type="ignored");el(ph,"max_step_size",.004);el(ph,"real_time_factor",1)
for file,name in [("physics","Physics"),("sensors","Sensors"),("scene-broadcaster","SceneBroadcaster")]:
 p=el(w,"plugin",filename="gz-sim-"+file+"-system",name="gz::sim::systems::"+name)
 if name=="Sensors":el(p,"render_engine","ogre2")
scene=el(w,"scene");el(scene,"ambient",".45 .45 .45 1");el(scene,"background",".10 .11 .13 1")
def box(name,pose,size,color):
 m=el(w,"model",name=name);el(m,"static","true");el(m,"pose",pose);link=el(m,"link",name="link")
 for tag in ["visual","collision"]:
  x=el(link,tag,name=tag);g=el(el(x,"geometry"),"box");el(g,"size",size)
  if tag=="visual":
   mat=el(x,"material");el(mat,"diffuse",color);el(mat,"ambient",color)
box("floor","0 0 -.1 0 0 0","10 10 .2",".35 .35 .35 1")
box("backwall",".7 0 1.3 0 0 0",".15 8 2.6",".3 .36 .42 1")
box("foreground_bar","-.6 0 .9 0 0 0",".18 .13 1.8",".15 .8 .9 1")
plug=el(w,"plugin",filename=str(BASE/"build/libagnes_volume_fire.so"),name="agnes::VolumetricFire")
el(plug,"shader_dir",BASE/"shaders");el(plug,"status_path",BASE/"probe/runtime.json")
for i,y in enumerate([-1.6,0,1.6]):
 for kind in (0,1):
  v=el(plug,"volume",name="probe_"+str(i)+"_"+str(kind))
  el(v,"center","0 "+str(y)+" "+str(1.19 if kind==0 else 2.0))
  el(v,"size","1.0 .8 1.42" if kind==0 else "1.15 1.25 .2")
  el(v,"kind",kind);el(v,"seed",17+i*9);el(v,"steps",36)
  el(v,"direction","0 0 1" if kind==0 else "0 -1 0")
for name,pose in [("front","-3.8 0 1.15 0 0 0"),("oblique","-3.2 -2.7 1.3 0 0 .58")]:
 m=el(w,"model",name=name);el(m,"static","true");el(m,"pose",pose);l=el(m,"link",name="link")
 s=el(l,"sensor",name="camera",type="camera");el(s,"always_on","true");el(s,"update_rate",24);el(s,"topic","/volume_probe/"+name)
 c=el(s,"camera");el(c,"horizontal_fov",1.2);im=el(c,"image");el(im,"width",640);el(im,"height",360);el(im,"format","R8G8B8")
 clip=el(c,"clip");el(clip,"near",.04);el(clip,"far",30)
 if name=="front":
  s=el(l,"sensor",name="lidar",type="gpu_lidar");el(s,"always_on","true");el(s,"update_rate",10);el(s,"topic","/volume_probe/scan")
  lid=el(s,"lidar");h=el(el(lid,"scan"),"horizontal");el(h,"samples",101);el(h,"resolution",1);el(h,"min_angle",-.48);el(h,"max_angle",.48)
  rng=el(lid,"range");el(rng,"min",.05);el(rng,"max",15);el(rng,"resolution",.01)
E.indent(root);E.ElementTree(root).write(BASE/"probe/world.sdf",encoding="unicode")
w.remove(plug)
E.ElementTree(root).write(BASE/"probe/baseline.sdf",encoding="unicode")
