"""Private physical actuation. No ROS publications or agent memory access."""
import json
import math
import threading
import time
from collections import deque
from pathlib import Path

from gz.transport13 import Node
from gz.msgs10.pose_v_pb2 import Pose_V
from gz.msgs10.double_pb2 import Double


def intersects(points, center, size, radius):
    # A sampled point is a geometric witness inside the swept corridor.
    # Rounded corners are checked by distance to the original rectangle;
    # the margin avoids accepting a grazing boundary contact.
    hx, hy = size[0] / 2, size[1] / 2
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        for i in range(max(1, math.ceil(length / .01)) + 1):
            t = i / max(1, math.ceil(length / .01))
            x, y = a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
            dx = max(0, abs(x - center[0]) - hx)
            dy = max(0, abs(y - center[1]) - hy)
            if math.hypot(dx, dy) < radius - .02:
                return True
    return False


def alternate_exists(grid, robot, goal, center, size, radius):
    """Connectivity check on the observed pre-event global grid, no fake plan."""
    if grid is None:
        return False
    res = grid.info.resolution
    ox, oy = grid.info.origin.position.x, grid.info.origin.position.y
    w, h = grid.info.width, grid.info.height
    def cell(p):
        return int((p[0] - ox) / res), int((p[1] - oy) / res)
    start, end = cell(robot), cell(goal)
    def free(c):
        x, y = c
        if not (0 <= x < w and 0 <= y < h):
            return False
        v = grid.data[y * w + x]
        if v < 0 or v >= 99:
            return False
        dx = max(0, abs(ox + (x + .5) * res - center[0]) - size[0] / 2)
        dy = max(0, abs(oy + (y + .5) * res - center[1]) - size[1] / 2)
        return math.hypot(dx, dy) > radius + .1
    if not free(start) or not free(end):
        return False
    queue, seen = deque([start]), {start}
    while queue:
        x, y = queue.popleft()
        if (x, y) == end:
            return True
        for nxt in [(x-1,y), (x+1,y), (x,y-1), (x,y+1)]:
            if nxt not in seen and free(nxt):
                seen.add(nxt)
                queue.append(nxt)
    return False


class CarrierFeedback:
    def __init__(self, world, start):
        self.start = start
        self.sample = None
        self.lock = threading.Lock()
        self.node = Node()
        self.topic = '/model/runtime_event_carrier/joint/event_slide/cmd_vel'
        self.publisher = self.node.advertise(self.topic, Double)
        self.node.subscribe(Pose_V, '/model/runtime_event_carrier/pose', self.on_pose)

    def on_pose(self, msg):
        # PosePublisher emits poses relative to their parent. body is relative
        # to the model; the fixed world anchor preserves the compiled origin.
        model = next((p for p in msg.pose if p.name == 'runtime_event_carrier'), None)
        if model is None:
            return
        measured_origin = [model.position.x, model.position.y]
        for p in msg.pose:
            if p.name.split('::')[-1] == 'body':
                q = p.orientation
                yaw = math.atan2(2*(q.w*q.z+q.x*q.y), 1-2*(q.y*q.y+q.z*q.z))
                with self.lock:
                    self.sample = {'wall_time': time.time(), 'monotonic': time.monotonic(),
                                   'sim_time': p.header.stamp.sec + p.header.stamp.nsec / 1e9,
                                   'body_relative': [p.position.x, p.position.y, p.position.z],
                                   'model_world_pose': measured_origin,
                                   'center': [measured_origin[0]+p.position.x,
                                              measured_origin[1]+p.position.y], 'yaw': yaw,
                                   'entity_id': p.id}

    def get(self):
        with self.lock:
            return dict(self.sample) if self.sample else None

    def drive(self, velocity):
        return self.publisher.publish(Double(data=float(velocity)))

    def move(self, target, points, size, radius, output):
        rows, stable_since, reached = [], None, None
        deadline = time.monotonic() + 20
        last_sim = None
        try:
            while time.monotonic() < deadline:
                sample = self.get()
                if not sample or time.monotonic() - sample['monotonic'] > .3:
                    self.drive(0)
                    time.sleep(.005)
                    continue
                if sample['sim_time'] == last_sim:
                    time.sleep(.002)
                    continue
                last_sim = sample['sim_time']
                error = target[1] - sample['center'][1]
                inside = intersects(points, sample['center'], size, radius)
                # Proportional velocity with bounded acceleration in real
                # physics. No wall-time calibration or pose assignment.
                velocity = max(-1.5, min(1.5, 3 * error))
                if abs(error) <= .04 and inside and abs(sample['yaw']) < .02:
                    velocity = 0
                    stable_since = stable_since or sample['sim_time']
                    if sample['sim_time'] - stable_since >= .5:
                        reached = sample
                else:
                    stable_since = None
                ok = self.drive(velocity)
                rows.append({**sample, 'error_m': error, 'velocity_command': velocity,
                             'collision_intersects_old_corridor': inside, 'published': bool(ok)})
                if reached:
                    break
                time.sleep(.002)
        finally:
            self.drive(0)
            output.write_text(json.dumps(rows, indent=2) + '\n')
        return {'pass': reached is not None, 'target': target, 'tolerance_m': .04,
                'stability_sim_seconds': .5, 'actual': reached or self.get(),
                'physical_event_reached_target': reached['wall_time'] if reached else None,
                'feedback_source': 'Gazebo PosePublisher measured model world pose plus measured body relative pose',
                'actuator': self.topic, 'trace': str(output), 'no_teleport': True}


def choose_target(old, pose, grid, event, radius):
    points = old['points']
    nearest = min(range(len(points)), key=lambda i: math.dist(points[i], pose))
    candidates, distance = [], 0
    fixed_x = event['carrier_start'][0]
    for i in range(nearest + 1, len(points)):
        distance += math.dist(points[i-1], points[i])
        p = points[i]
        if distance < 1.0 or abs(p[0] - fixed_x) > .15:
            continue
        target = [fixed_x, p[1]]
        if math.dist(target, points[-1]) < 1.5:
            continue
        if alternate_exists(grid, pose, points[-1], target, event['size'], radius):
            candidates.append({'index': i, 'point': p, 'target': target,
                               'future_arc_distance_m': distance, 'alternate_route_exists': True})
    if not candidates:
        raise RuntimeError('NO_REACHABLE_FUTURE_PATH_SEGMENT_WITH_ALTERNATE_ROUTE')
    return min(candidates, key=lambda c: abs(c['point'][0] - fixed_x))
