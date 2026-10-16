from pathlib import Path
import json,time,struct,zlib,hashlib,threading,statistics,os
from gz.transport13 import Node
from gz.msgs10.image_pb2 import Image
from gz.msgs10.laserscan_pb2 import LaserScan
BASE=Path(__file__).resolve().parent
VARIANT=os.environ.get("PROBE_VARIANT","")
node=Node();lock=threading.Lock();counts={};frames={};scans=[];start=time.monotonic()
def write_png(p,w,h,raw):
 def chunk(t,d):return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
 rows=b"".join(b"\0"+raw[y*w*3:(y+1)*w*3] for y in range(h))
 p.write_bytes(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(rows,6))+chunk(b"IEND",b""))
def camera(name):
 def cb(m):
  with lock:
   counts[name]=counts.get(name,0)+1
   elapsed=time.monotonic()-start
   if elapsed>6 and len(frames.get(name,[]))<5 and (not frames.get(name) or elapsed-frames[name][-1]["elapsed"]>1):
    data=bytes(m.data);p=BASE/(VARIANT+name+"-"+str(len(frames.get(name,[])))+".png")
    # gz Image rows use step (may include padding).
    raw=b"".join(data[y*m.step:y*m.step+m.width*3] for y in range(m.height))
    write_png(p,m.width,m.height,raw)
    frames.setdefault(name,[]).append({"file":p.name,"elapsed":elapsed,"sha256":hashlib.sha256(raw).hexdigest()})
 return cb
callbacks=[camera("front"),camera("oblique")]
for name,cb in zip(["front","oblique"],callbacks):assert node.subscribe(Image,"/volume_probe/"+name,cb)
def scan(m):
 with lock:
  if len(scans)<20 and time.monotonic()-start>6:scans.append(list(m.ranges))
assert node.subscribe(LaserScan,"/volume_probe/scan",scan)
while time.monotonic()-start<18:time.sleep(.2)
with lock:
 report={"counts":counts,"frames":frames,"scan_count":len(scans),"scan":scans[-1] if scans else []}
 (BASE/(VARIANT+"capture.json")).write_text(json.dumps(report,indent=2))
 print(json.dumps({"counts":counts,"unique_frames":{k:len(set(f["sha256"] for f in v)) for k,v in frames.items()},"scan_count":len(scans)}))
