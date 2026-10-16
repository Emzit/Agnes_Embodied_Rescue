#!/usr/bin/env python3
"""Read-only ROS domain 106 monitor. No publishers, services, or action clients."""
import os,json,time,math,hashlib,struct,zlib,fcntl
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile,DurabilityPolicy,ReliabilityPolicy
from rclpy.time import Time
from nav_msgs.msg import OccupancyGrid,Path as RosPath
from geometry_msgs.msg import Twist
from action_msgs.msg import GoalStatusArray
from tf2_ros import Buffer,TransformListener
ROOT=Path('/data-ssd/zhongchengkai/agnes')
OUT=ROOT/'artifacts/demo-ui-final'
assert os.environ.get('ROS_DOMAIN_ID')=='106'
def atomic(name,value):
    p=OUT/name; tmp=p.with_suffix(p.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)); tmp.replace(p)
def png(w,h,gray):
    def chunk(k,v): return struct.pack('!I',len(v))+k+v+struct.pack('!I',zlib.crc32(k+v)&0xffffffff)
    rows=b''.join(b'\x00'+gray[y*w:(y+1)*w] for y in range(h))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,0,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
class Monitor(Node):
    def __init__(self):
        super().__init__('agnes_demo_ui_readonly',parameter_overrides=[])
        self.buffer=Buffer(); self.listener=TransformListener(self.buffer,self)
        self.map=None; self.goal_status=[]; self.goal_at=None; self.velocity=None; self.velocity_at=None; self.plan=[]; self.plan_at=None; self.tf_seen=None; self.tf_at=None
        durable=QoSProfile(depth=1,durability=DurabilityPolicy.TRANSIENT_LOCAL,reliability=ReliabilityPolicy.RELIABLE)
        self.create_subscription(OccupancyGrid,'/map',self.on_map,durable)
        self.create_subscription(GoalStatusArray,'/navigate_to_pose/_action/status',self.on_goal,durable)
        self.create_subscription(Twist,'/cmd_vel',self.on_velocity,10)
        self.create_subscription(RosPath,'/plan',self.on_plan,10)
        self.create_timer(.3,self.tick)
    def on_map(self,m):
        w,h=m.info.width,m.info.height
        gray=bytes(205 if v<0 else round(255*(1-min(100,v)/100)) for v in m.data)
        raw=png(w,h,b''.join(gray[y*w:(y+1)*w] for y in range(h-1,-1,-1)))
        digest=hashlib.sha256(raw).hexdigest()
        if not self.map or self.map['sha256']!=digest:
            p=OUT/'ros-map.png'; tmp=OUT/'ros-map.png.tmp'; tmp.write_bytes(raw); tmp.replace(p)
        q=m.info.origin.orientation
        self.map={'source':'ROS2 /map (static occupancy prior)','frame_id':m.header.frame_id,'width':w,'height':h,'resolution':m.info.resolution,'origin':{'x':m.info.origin.position.x,'y':m.info.origin.position.y,'yaw':math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z))},'sha256':digest,'received_at':time.time(),'image_url':'/api/demo-ui/map.png'}
    def on_goal(self,m):
        self.goal_status=[{'goal_id':bytes(x.goal_info.goal_id.uuid).hex(),'status':int(x.status)} for x in m.status_list]; self.goal_at=time.time()
    def on_velocity(self,m):
        self.velocity={'linear_x':m.linear.x,'linear_y':m.linear.y,'angular_z':m.angular.z}; self.velocity_at=time.time()
    def on_plan(self,m):
        self.plan=[{'x':p.pose.position.x,'y':p.pose.position.y} for p in m.poses]; self.plan_at=time.time()
    def lease(self):
        try: fd=os.open(ROOT/'runtime/motion-control.lock',os.O_RDONLY)
        except FileNotFoundError: return {'held':False,'owner':None}
        try:
            try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                try: owner=json.loads(os.read(fd,4096))
                except Exception: owner={'unknown':True}
                return {'held':True,'owner':owner}
            else:
                fcntl.flock(fd,fcntl.LOCK_UN); return {'held':False,'owner':None}
        finally: os.close(fd)
    def tick(self):
        now=time.time(); pose=None; error=None; stamp=None
        try:
            t=self.buffer.lookup_transform('map','base_link',Time())
            q=t.transform.rotation; s=t.header.stamp; stamp={'sec':s.sec,'nanosec':s.nanosec}
            key=(s.sec,s.nanosec)
            if key!=self.tf_seen: self.tf_seen=key; self.tf_at=now
            pose={'x':t.transform.translation.x,'y':t.transform.translation.y,'yaw':math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z)),'frame_id':'map'}
        except Exception as e: error=str(e)[:250]
        active=[g for g in self.goal_status if g['status'] in [1,2,3]]
        generation_idle=False
        if not self.goal_at:
            try:
                gen=json.loads((OUT/'scene-generation.json').read_text())
                stat=Path('/proc/'+str(gen['nav_pid'])+'/stat').read_text().rsplit(')',1)[1].split()
                generation_idle=gen['ready'] and stat[19]==gen['nav_start_time'] and stat[0]!='Z' and self.map and self.map['received_at']>gen['started_at']
            except (OSError,ValueError,KeyError):pass
        data={'updated_at':now,'ros_domain_id':106,'read_only':True,'map':self.map,'pose':pose,'pose_source':'ROS2 TF map → base_link','pose_stamp':stamp,'pose_age_ms':None if self.tf_at is None else (now-self.tf_at)*1000,'pose_error':error,'navigation':{'status':'ACTIVE' if active else 'IDLE' if self.goal_at or generation_idle else 'UNKNOWN','active_goals':active,'status_source':'ROS2 action status' if self.goal_at else 'verified newly started Nav2 generation; no goals received' if generation_idle else 'unknown','goal_statuses':self.goal_status,'status_received_at':self.goal_at,'motion_lease':self.lease()},'velocity':self.velocity,'velocity_received_at':self.velocity_at,'plan':self.plan if active else [],'plan_received_at':self.plan_at}
        atomic('ros-state.json',data)
rclpy.init()
node=Monitor()
try: rclpy.spin(node)
finally: node.destroy_node(); rclpy.shutdown()
