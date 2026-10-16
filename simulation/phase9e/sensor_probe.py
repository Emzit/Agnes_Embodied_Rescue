"""Read-only ROS sensor evidence collector; PNG is decoded from the latest Image."""
import json
import math
import os
from pathlib import Path
import struct
import sys
import threading
import zlib
sys.path.insert(0, '/data-ssd/zhongchengkai/agnes/services/robot-mcp/ros2_bridge')
import rclpy
from rclpy.node import Node
from rclpy.executors import MultiThreadedExecutor
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import LaserScan, Image, CameraInfo
from sensor_summary import lidar_summary, camera_summary, stamp

ROOT = Path('/data-ssd/zhongchengkai/agnes')
class Probe(Node):
    def __init__(self):
        super().__init__('phase9e_sensor_probe')
        self.lock = threading.Lock()
        self.scans, self.images, self.info = [], [], None
        self.last_image = None
        self.create_subscription(LaserScan, '/scan', self.scan, qos_profile_sensor_data)
        self.create_subscription(Image, '/camera/image_raw', self.image, qos_profile_sensor_data)
        self.create_subscription(CameraInfo, '/camera/camera_info', self.camera_info, qos_profile_sensor_data)
    def scan(self, msg):
        summary = lidar_summary(msg)
        summary['ranges'] = [float(v) if math.isfinite(v) else None for v in msg.ranges]
        with self.lock:
            self.scans.append(summary)
            self.scans = self.scans[-50:]
    def image(self, msg):
        with self.lock:
            self.last_image = msg
            self.images.append(camera_summary(msg))
            self.images = self.images[-50:]
    def camera_info(self, msg):
        with self.lock:
            self.info = {'width': msg.width, 'height': msg.height,
                         'frame_id': msg.header.frame_id, 'stamp': stamp(msg.header),
                         'k': list(msg.k), 'distortion_model': msg.distortion_model}
    def snapshot(self):
        with self.lock:
            return {'scans': list(self.scans), 'images': list(self.images), 'camera_info': self.info}
    def png(self):
        with self.lock:
            msg = self.last_image
        if msg is None or msg.encoding != 'rgb8':
            raise ValueError('IMAGE_UNAVAILABLE')
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))
        raw = bytes(msg.data)
        rows = b''.join(b'\0'+raw[y*msg.step:y*msg.step+msg.width*3] for y in range(msg.height))
        png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',msg.width,msg.height,8,2,0,0,0))
        png += chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
        (ROOT/'artifacts/phase9e/camera-frame.png').write_bytes(png)
        return {'source': '/camera/image_raw', 'width': msg.width, 'height': msg.height}

def main():
    rclpy.init()
    node = Probe()
    executor = MultiThreadedExecutor(num_threads=2)
    executor.add_node(node)
    thread = threading.Thread(target=executor.spin, daemon=True)
    thread.start()
    try:
        for line in sys.stdin:
            request = json.loads(line)
            try:
                result = node.png() if request['method'] == 'save_frame' else node.snapshot()
                print(json.dumps({'id': request['id'], 'ok': True, 'result': result}, allow_nan=False), flush=True)
            except Exception:
                print(json.dumps({'id': request['id'], 'ok': False, 'error': {'code': 'PROBE_ERROR'}}), flush=True)
    finally:
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        thread.join(timeout=3)
if __name__ == '__main__':
    main()
