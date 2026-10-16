#!/usr/bin/env python3
"""Run the existing pixel CV detector on one freshly captured real frame."""
import json, sys
import struct, zlib
from pathlib import Path
sys.path.insert(0, str(Path('/data-ssd/zhongchengkai/agnes/services/robot-mcp/ros2_bridge')))
from cv_detector import detect_pixels

path = Path(sys.argv[1])
stamp = json.loads(sys.argv[2])
def read_rgb_png(filename):
    data = filename.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('UNSUPPORTED_FRAME_FORMAT')
    pos = 8; width = height = channels = None; compressed = bytearray()
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos+4])[0]; kind = data[pos+4:pos+8]; body = data[pos+8:pos+8+size]; pos += 12 + size
        if kind == b'IHDR':
            width, height, depth, color_type, compression, filtering, interlace = struct.unpack('>IIBBBBB', body)
            if depth != 8 or color_type not in (2, 6) or interlace != 0: raise ValueError('UNSUPPORTED_FRAME_LAYOUT')
            channels = 3 if color_type == 2 else 4
        elif kind == b'IDAT': compressed.extend(body)
        elif kind == b'IEND': break
    decoded = zlib.decompress(bytes(compressed)); stride = width * channels; rows = []; offset = 0; prior = bytearray(stride)
    for _ in range(height):
        filter_type = decoded[offset]; offset += 1; row = bytearray(decoded[offset:offset+stride]); offset += stride
        for i in range(stride):
            left = row[i-channels] if i >= channels else 0; up = prior[i]; up_left = prior[i-channels] if i >= channels else 0
            if filter_type == 1: row[i] = (row[i] + left) & 255
            elif filter_type == 2: row[i] = (row[i] + up) & 255
            elif filter_type == 3: row[i] = (row[i] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                p = left + up - up_left; pa = abs(p-left); pb = abs(p-up); pc = abs(p-up_left); predictor = left if pa <= pb and pa <= pc else (up if pb <= pc else up_left); row[i] = (row[i] + predictor) & 255
            elif filter_type != 0: raise ValueError('UNSUPPORTED_PNG_FILTER')
        rows.append(bytes(row)); prior = row
    raw = b''.join(rows) if channels == 3 else b''.join(bytes(bytearray(row[i] for i in range(0, stride, 4))) for row in rows)
    return width, height, raw
width, height, raw = read_rgb_png(path)
class Stamp: pass
class Header: pass
class Msg: pass
msg = Msg(); msg.encoding = 'rgb8'; msg.height = height; msg.width = width; msg.step = width * 3; msg.data = raw
msg.header = Header(); msg.header.stamp = Stamp(); msg.header.stamp.sec = int(stamp.get('sec', 0)); msg.header.stamp.nanosec = int(stamp.get('nanosec', 0)); msg.header.frame_id = 'camera_link'
print(json.dumps({'detections': detect_pixels(msg), 'frame_path': str(path), 'timestamp': stamp}, separators=(',', ':')))
