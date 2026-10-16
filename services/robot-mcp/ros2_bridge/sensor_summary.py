"""Pure numeric summaries of ROS sensor messages; no semantic inference."""
import hashlib
import math
import numpy as np

def stamp(header):
    return {'sec': header.stamp.sec, 'nanosec': header.stamp.nanosec}

def lidar_summary(msg):
    valid = [(msg.angle_min + i * msg.angle_increment, float(v))
             for i, v in enumerate(msg.ranges)
             if math.isfinite(v) and msg.range_min <= v <= msg.range_max]
    def sector(center):
        values = [r for a, r in valid
                  if abs(math.atan2(math.sin(a-center), math.cos(a-center))) <= math.pi/6]
        return min(values) if values else None
    return {'available': True, 'min_range': min((r for _, r in valid), default=None),
            'front_min_range': sector(0), 'left_min_range': sector(math.pi/2),
            'right_min_range': sector(-math.pi/2), 'valid_points': len(valid),
            'sample_count': len(msg.ranges), 'frame_id': msg.header.frame_id,
            'frame_timestamp': stamp(msg.header)}

def camera_summary(msg):
    # Account for row padding; unsupported formats are not guessed or reinterpreted.
    channels = {'rgb8': 3, 'bgr8': 3, 'rgba8': 4, 'bgra8': 4, 'mono8': 1}.get(msg.encoding)
    raw = bytes(msg.data)
    if not channels or not msg.width or not msg.height or msg.step < msg.width*channels \
            or len(raw) != msg.height*msg.step:
        return {'available': False, 'status': 'UNSUPPORTED_IMAGE_LAYOUT'}
    pixels = np.frombuffer(raw, dtype=np.uint8).reshape(msg.height, msg.step)[:, :msg.width*channels]
    return {'available': True, 'width': msg.width, 'height': msg.height,
            'encoding': msg.encoding, 'frame_id': msg.header.frame_id,
            'frame_timestamp': stamp(msg.header), 'data_length': len(raw),
            'summary': {'mean': float(pixels.mean()), 'std': float(pixels.std()),
                        'min': int(pixels.min()), 'max': int(pixels.max()),
                        'sha256': hashlib.sha256(pixels.tobytes()).hexdigest()}}
