"""Compare live ROS occupancy map with static SDF walls, never dynamic entities."""
import json
import math
import os
from pathlib import Path
import time
import xml.etree.ElementTree as ET
os.environ['RCUTILS_LOGGING_USE_STDOUT']='0'
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
from nav_msgs.msg import OccupancyGrid

ROOT=Path('/data-ssd/zhongchengkai/agnes')
def main():
    rclpy.init()
    node=Node('phase9f_map_alignment_probe')
    messages=[]
    qos=QoSProfile(depth=1,reliability=ReliabilityPolicy.RELIABLE,durability=DurabilityPolicy.TRANSIENT_LOCAL)
    node.create_subscription(OccupancyGrid,'/map',messages.append,qos)
    try:
        end=time.monotonic()+20
        while not messages and time.monotonic()<end:
            rclpy.spin_once(node,timeout_sec=0.2)
        assert messages, 'LIVE_MAP_UNAVAILABLE'
        msg=messages[-1]
        walls=[]
        world=ET.parse(ROOT/'simulation/phase9f/world.sdf').getroot().find('world')
        for model in world.findall('model'):
            if not model.attrib['name'].startswith('wall_'):
                continue
            x,y,*_=map(float,model.findtext('pose').split())
            sx,sy,*_=map(float,model.findtext('link/collision/geometry/box/size').split())
            walls.append((x,y,sx,sy))
        mismatch=0
        for j in range(msg.info.height):
            for i in range(msg.info.width):
                x=msg.info.origin.position.x+(i+0.5)*msg.info.resolution
                y=msg.info.origin.position.y+(j+0.5)*msg.info.resolution
                blocked=any(abs(x-wx)<=sx/2+1e-6 and abs(y-wy)<=sy/2+1e-6 for wx,wy,sx,sy in walls)
                if (msg.data[j*msg.info.width+i]>=65)!=blocked:
                    mismatch+=1
        assert mismatch==0, 'MAP_GEOMETRY_MISMATCH'
        registry=json.loads((ROOT/'simulation/phase9f/world_registry.json').read_text())
        free=[]
        for location in registry['locations']:
            p=location['pose']
            i=int((p['x']-msg.info.origin.position.x)/msg.info.resolution)
            j=int((p['y']-msg.info.origin.position.y)/msg.info.resolution)
            assert msg.data[j*msg.info.width+i]==0
            free.append(location['id'])
        print(json.dumps({'passed':True,'source':'live ROS2 /map + static SDF collision geometry',
                          'map_frame':msg.header.frame_id,'wall_count':len(walls),
                          'width':msg.info.width,'height':msg.info.height,'resolution':msg.info.resolution,
                          'mismatched_cells':mismatch,'free_waypoints':free}))
    finally:
        node.destroy_node()
        if rclpy.ok(): rclpy.shutdown()
if __name__=='__main__': main()
