"""VLM input is exclusively current ROS Image bytes. No world/entity/registry reads."""
import base64
import copy
from collections import OrderedDict
import hashlib
import json
import math
from pathlib import Path
import select
import struct
import subprocess
import threading
import time
import zlib
import sys

class PerceptionError(ValueError):
    def __init__(self, stage):
        super().__init__('PERCEPTION_UNAVAILABLE')
        self.stage = stage

ROOT=Path('/data-ssd/zhongchengkai/agnes')
def png_bytes(msg):
    if msg.encoding!='rgb8' or len(msg.data)!=msg.height*msg.step:
        raise ValueError('UNSUPPORTED_IMAGE_LAYOUT')
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    raw=bytes(msg.data)
    rows=b''.join(b'\0'+raw[y*msg.step:y*msg.step+msg.width*3] for y in range(msg.height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',msg.width,msg.height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')

class Perception:
    def __init__(self):
        self.child=None
        self.lock=threading.Lock()
        self.sequence=0
        self.cache=OrderedDict()
    def request(self,method,png=None,*,repair_invalid_schema=False,timeout_ms=45000):
        if self.child is None:
            self.child=subprocess.Popen([str(ROOT/'tools/node/bin/node'),str(ROOT/'third_party/agnes-harness/node_modules/tsx/dist/cli.mjs'),
                str(ROOT/'services/robot-mcp/perception/vlm-worker.mts')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
        self.sequence+=1
        request={'id':str(self.sequence),'method':method}
        if repair_invalid_schema:
            request['repair_invalid_schema']=True
            request['timeout_ms']=max(1000,min(45000,int(timeout_ms)))
        if png: request['png']=base64.b64encode(png).decode()
        self.child.stdin.write(json.dumps(request)+'\n');self.child.stdin.flush()
        if not select.select([self.child.stdout],[],[],55)[0]:
            print('PERCEPTION_SAFE_ERROR=RESPONSE_TIMEOUT',file=sys.stderr,flush=True)
            self.close();self.child=None
            raise PerceptionError('RESPONSE_TIMEOUT')
        response=json.loads(self.child.stdout.readline())
        if response.get('id')!=request['id'] or not response.get('ok'):
            stage=response.get('error',{}).get('stage')
            if stage in ['CONNECT','SESSION_NEW','IMAGE_PROMPT','EVENT_READING','JSON_PARSE','EMPTY_ASSISTANT_OUTPUT','NO_VALID_DETECTIONS_JSON','TOOL_CALL_FORBIDDEN','INFERENCE_TIMEOUT','INFERENCE_CANCELLED','INFERENCE_FAILED']:
                print('PERCEPTION_SAFE_ERROR='+stage,file=sys.stderr,flush=True)
            raise PerceptionError(stage or 'INVALID_WORKER_RESPONSE')
        return response['result']
    def detect(self,msg,focus=None):
        with self.lock:
            key=(msg.header.stamp.sec,msg.header.stamp.nanosec)
            png=png_bytes(msg)
            frame_hash=hashlib.sha256(png).hexdigest()
            # Reuse only the exact same sensor frame and focus. A new stamp,
            # changed pixels (even with a reused stamp), frame ID or size must
            # trigger Agnes again; opening a door never reuses the pre-open view.
            cache_key=(key,msg.header.frame_id,msg.width,msg.height,focus,frame_hash)
            if cache_key in self.cache:
                self.cache.move_to_end(cache_key)
                return copy.deepcopy(self.cache[cache_key])
            # Retry only a quick malformed/empty reply. Repeating a timed-out
            # model turn, forbidden tool request or connection failure would
            # double a long wait and exceed the native tool deadline.
            method='detect_door' if focus=='door' else 'detect'
            request_started=time.monotonic()
            try:result=self.request(method,png)
            except PerceptionError as error:
                if error.stage not in ('NO_VALID_DETECTIONS_JSON','EMPTY_ASSISTANT_OUTPUT') or time.monotonic()-request_started>=20:
                    raise
                # The sole retry explicitly repairs the schema on the exact same
                # image, and shares the original 45s inference budget.
                remaining_ms=max(1000,int(45000-(time.monotonic()-request_started)*1000))
                result=self.request(method,png,repair_invalid_schema=True,timeout_ms=remaining_ms)
            detections=[]
            for d in result['detections']:
                box=[d['bbox'][i]*(msg.width if i%2==0 else msg.height) for i in range(4)]
                digest=hashlib.sha256((str(key)+frame_hash+d['label']+str(box)).encode()).hexdigest()[:16]
                detections.append({'id':'visual_'+digest,'label':d['label'],'confidence':d['confidence'],
                    'bbox':box,'center':[(box[0]+box[2])/2,(box[1]+box[3])/2],
                    'source':'ros2_camera_perception','frame_id':msg.header.frame_id,
                    'timestamp':{'sec':key[0],'nanosec':key[1]},
                    'evidence':{'method':'vlm','provider':'agnes-ai','model':'agnes-3.0-flash',
                        'frame_timestamp':{'sec':key[0],'nanosec':key[1]},'frame_sha256':frame_hash,
                        'inspection_focus':focus,'image_width':msg.width,'image_height':msg.height,'vlm_tool_calls':result['tool_calls']}})
            self.cache[cache_key]=copy.deepcopy(detections)
            while len(self.cache)>8:self.cache.popitem(last=False)
            return detections
    def close(self):
        if self.child:
            self.child.stdin.close()
            try:self.child.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self.child.terminate()
                try:self.child.wait(timeout=3)
                except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=3)
