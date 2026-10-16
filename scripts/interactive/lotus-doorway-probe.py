import json
import math
import sys
import time

import rclpy
from nav_msgs.msg import OccupancyGrid
from sensor_msgs.msg import LaserScan


def main():
    rx = float(sys.argv[1]) if len(sys.argv) > 1 else 9.25
    ry = float(sys.argv[2]) if len(sys.argv) > 2 else 2.5
    rclpy.init()
    node = rclpy.create_node('lotus_doorway_probe')
    grids = {}
    scans = []
    for topic, key in [
        ('/global_costmap/costmap', 'global'),
        ('/global_costmap/obstacle_layer', 'global_obstacle'),
        ('/local_costmap/costmap', 'local'),
    ]:
        node.create_subscription(OccupancyGrid, topic,
                                 lambda msg, k=key: grids.__setitem__(k, msg), 10)
    node.create_subscription(LaserScan, '/scan', lambda msg: scans.append(msg), 10)
    end = time.monotonic() + 5.0
    while time.monotonic() < end and (len(grids) < 3 or not scans):
        rclpy.spin_once(node, timeout_sec=0.2)

    def cells(msg, cx, cy, radius):
        if msg is None:
            return {'available': False}
        info = msg.info
        ox, oy, res = info.origin.position.x, info.origin.position.y, info.resolution
        ix, iy = int((cx - ox) / res), int((cy - oy) / res)
        vals = []
        for y in range(max(0, iy - math.ceil(radius / res)),
                       min(info.height, iy + math.ceil(radius / res) + 1)):
            for x in range(max(0, ix - math.ceil(radius / res)),
                           min(info.width, ix + math.ceil(radius / res) + 1)):
                if math.hypot((x - ix) * res, (y - iy) * res) <= radius:
                    vals.append(int(msg.data[y * info.width + x]))
        return {
            'available': True,
            'stamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec},
            'origin': [ox, oy], 'resolution': res,
            'center': [cx, cy], 'radius': radius,
            'min': min(vals) if vals else None, 'max': max(vals) if vals else None,
            'lethal_or_unknown': sum(v >= 99 for v in vals), 'count': len(vals),
        }

    out = {
        'robot_footprint': {k: cells(v, rx, ry, 0.4) for k, v in grids.items()},
        'door_panel_sweep': {k: cells(v, 8.0, 2.5, 0.7) for k, v in grids.items()},
        'scan': {
            'available': bool(scans),
            'stamp': ({'sec': scans[-1].header.stamp.sec,
                       'nanosec': scans[-1].header.stamp.nanosec} if scans else None),
            'valid_points': (sum(math.isfinite(x) for x in scans[-1].ranges)
                             if scans else 0),
        },
    }
    print(json.dumps(out))
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
