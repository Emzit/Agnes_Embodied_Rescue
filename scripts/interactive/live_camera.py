#!/usr/bin/env python3
"""Read-only latest-frame display subscriber; no publishers, actions or models."""
import hashlib, json, os, signal, sys, time, uuid
from datetime import datetime, timezone
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from rclpy.time import Time
from sensor_msgs.msg import Image
from tf2_ros import Buffer, TransformListener

ROOT = Path(__file__).resolve().parents[2]
assert Path.cwd().resolve() == ROOT
assert os.environ.get('ROS_DOMAIN_ID') == '106'
from camera_encoding import DisplayJpeg, fast_png, rgb_pixels
OUT = Path(os.environ.get('INTERACTIVE_LIVE_ROOT', ROOT / 'artifacts/interactive-live')).resolve()
assert OUT.is_relative_to(ROOT)
CAMERA = OUT / 'camera'
CAMERA.mkdir(parents=True, exist_ok=True)

def atomic(path, data):
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    temporary.write_bytes(data)
    temporary.replace(path)

def save(name, data):
    atomic(CAMERA / name, (json.dumps(data, indent=2) + '\n').encode())

class LiveCamera(Node):
    def __init__(self):
        super().__init__('agnes_live_camera_' + str(os.getpid()))
        self.buffer = Buffer()
        self.listener = TransformListener(self.buffer, self)
        self.run_id = uuid.uuid4().hex[:12]
        self.sequence = 0
        self.last_stamp = None
        self.retained = []
        self.window = []
        self.last_stats_at = 0
        try:
            self.jpeg = DisplayJpeg(ROOT / 'runtime/ros2-jazzy/.pixi/envs/default/lib/libturbojpeg.so')
        except (OSError, RuntimeError) as error:
            self.jpeg = None
            self.get_logger().warning('DISPLAY_JPEG_UNAVAILABLE: ' + str(error))
        interval = os.environ.get('INTERACTIVE_CAMERA_INTERVAL_MS')
        self.interval = max(.016, float(interval) / 1000) if interval else 1 / 30
        self.last_frame_at = 0
        self.stats = dict(topic='/camera/image_raw', target_interval_ms=self.interval * 1000,
                          frames_received=0, timestamp_resets=0, timestamp_monotonic=True,
                          real_sensor=True, source='read-only ROS2 image subscription',
                          started_at=datetime.now(timezone.utc).isoformat())
        qos = QoSProfile(depth=1, history=HistoryPolicy.KEEP_LAST,
                         reliability=ReliabilityPolicy.BEST_EFFORT)
        self.create_subscription(Image, '/camera/image_raw', self.on_image, qos)

    def pose(self):
        try:
            import math
            t = self.buffer.lookup_transform('map', 'base_link', Time())
            q = t.transform.rotation
            yaw = math.atan2(2*(q.w*q.z+q.x*q.y), 1-2*(q.y*q.y+q.z*q.z))
            p = dict(x=t.transform.translation.x, y=t.transform.translation.y)
            return dict(position=p, pose=dict(**p, heading=yaw, frame_id='map'), yaw=yaw,
                        timestamp=dict(sec=t.header.stamp.sec, nanosec=t.header.stamp.nanosec))
        except Exception:
            return None

    def on_image(self, msg):
        received_at = time.time()
        now = time.monotonic()
        stamp = (msg.header.stamp.sec, msg.header.stamp.nanosec)
        if stamp == self.last_stamp or now - self.last_frame_at < self.interval * .9:
            return
        if self.last_stamp is not None and stamp < self.last_stamp:
            self.stats['timestamp_resets'] += 1
        try:
            raw = rgb_pixels(msg)
            pixels = fast_png(msg, raw)
            display = None
            if self.jpeg:
                try:
                    display = self.jpeg.encode(msg, raw)
                except Exception as error:
                    # Evidence remains lossless and live if the optional encoder fails.
                    self.get_logger().warning('DISPLAY_JPEG_FALLBACK: ' + str(error))
                    self.jpeg.close()
                    self.jpeg = None
            self.sequence += 1
            frame_id = 'live-' + self.run_id + '-' + str(self.sequence)
            filename = frame_id + '.png'
            captured_at = datetime.fromtimestamp(received_at, timezone.utc).isoformat()
            # Manifest refers to an immutable frame: PNG and timestamp cannot race.
            atomic(CAMERA / filename, pixels)
            display_filename = frame_id + '.jpg' if display else None
            if display_filename:
                atomic(CAMERA / display_filename, display)
            atomic(CAMERA / 'latest.png', pixels)  # existing perception/evidence readers
            timestamp = dict(sec=stamp[0], nanosec=stamp[1])
            meta = dict(sequence=self.sequence, frame_id=frame_id, image_file=filename,
                        timestamp=timestamp, captured_at=captured_at,
                        width=msg.width, height=msg.height, encoding=msg.encoding+'->png',
                        topic='/camera/image_raw', pose=self.pose(), byte_length=len(pixels),
                        pixel_hash_prefix=hashlib.sha256(pixels).hexdigest()[:32],
                        real_sensor=True, encode_ms=(time.monotonic()-now)*1000)
            if display_filename:
                meta.update(display_file=display_filename, display_mime_type='image/jpeg',
                            display_byte_length=len(display), display_quality=self.jpeg.quality)
            save('latest-meta.json', meta)
            self.retained.append((filename, display_filename))
            if len(self.retained) > 4:
                for expired in self.retained.pop(0):
                    if expired:
                        (CAMERA / expired).unlink(missing_ok=True)
            self.last_stamp = stamp
            self.last_frame_at = now
            self.stats['frames_received'] += 1
            self.stats['last_timestamp'] = timestamp
            self.stats.setdefault('first_timestamp', timestamp)
            self.window.append(now)
            self.window = [t for t in self.window if now-t < 5]
            if now - self.last_stats_at >= 1:
                self.stats['fps'] = ((len(self.window)-1)/(now-self.window[0])
                                     if len(self.window)>1 else 0)
                save('camera-stats.json', dict(self.stats, updated_at=captured_at,
                    encode_ms=meta['encode_ms'], png_byte_length=len(pixels),
                    display_byte_length=len(display) if display else len(pixels),
                    display_mime_type='image/jpeg' if display else 'image/png'))
                self.last_stats_at = now
        except Exception as error:
            self.get_logger().error('LIVE_CAMERA_FRAME_ERROR: ' + str(error))

rclpy.init()
node = LiveCamera()
try:
    rclpy.spin(node)
finally:
    if node.jpeg:
        node.jpeg.close()
    node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()
