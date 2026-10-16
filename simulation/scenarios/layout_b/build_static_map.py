"""Offline map builder: static walls only; no semantic objects or dynamic cabinet."""
from pathlib import Path
import xml.etree.ElementTree as ET
HERE=Path(__file__).parent
world=ET.parse(HERE/'world.sdf').getroot().find('world');walls=[]
for m in world.findall('model'):
    if not m.attrib['name'].startswith('wall_'):continue
    x,y,*_=map(float,m.findtext('pose').split());sx,sy,*_=map(float,m.findtext('link/collision/geometry/box/size').split());walls.append((x,y,sx,sy))
pixels=bytearray()
for j in reversed(range(200)):
    for i in range(200):
        x=-10+(i+.5)*.1;y=-10+(j+.5)*.1
        pixels.append(0 if any(abs(x-a)<=sx/2+1e-6 and abs(y-b)<=sy/2+1e-6 for a,b,sx,sy in walls) else 254)
(HERE/'map.pgm').write_bytes(b'P5\n200 200\n255\n'+pixels)
