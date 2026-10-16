"""Physical-only controller for an activated imported skeleton.

The private scenario file is controller/evaluator input only.  This process
never publishes the victim, event type, event schedule, or semantic state to
the agent.  It only creates/removes real Gazebo entities and records raw
sensor/navigation evidence under FINAL_RUN_DIR.
"""
import hashlib, json, math, os, subprocess, threading, time
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import LaserScan
from nav_msgs.msg import Odometry, Path as NavPath, OccupancyGrid
from std_msgs.msg import String
from geometry_msgs.msg import PoseWithCovarianceStamped

ROOT = Path('/data-ssd/zhongchengkai/agnes')
import sys
sys.path.insert(0, str(ROOT))
from simulation.visual_assets.scene_style import person_links
OUT = Path(os.environ.get('FINAL_RUN_DIR', ROOT / 'artifacts/interactive-live/full-mission'))
OUT.mkdir(parents=True, exist_ok=True)
PRIVATE = Path(os.environ.get('SCENARIO_PRIVATE_FILE', ROOT / 'artifacts/interactive-live/imported-runtime/private-scenario.json'))
SPEC = json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {}
WORLD = os.environ.get('SCENARIO_WORLD_NAME', 'imported_building')
GZ = ROOT / 'runtime/ros2-jazzy/.pixi/envs/default/bin/gz'
RUNTIME = ROOT / 'artifacts/interactive-live/imported-runtime'
RUNTIME.mkdir(parents=True, exist_ok=True)

def save(name, value):
    target = OUT / name
    temp = target.with_suffix(target.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(target)

def gz_service(kind, name, sdf=None):
    if kind == 'remove':
        args = ['service', '-s', f'/world/{WORLD}/remove', '--reqtype', 'gz.msgs.Entity', '--reptype', 'gz.msgs.Boolean', '--timeout', '3000', '--req', f'name: "{name}"']
    else:
        args = ['service', '-s', f'/world/{WORLD}/create', '--reqtype', 'gz.msgs.EntityFactory', '--reptype', 'gz.msgs.Boolean', '--timeout', '5000', '--req', f'sdf_filename: "{sdf}"']
    try:
        result = subprocess.run([str(GZ), *args], cwd=ROOT, capture_output=True, text=True, timeout=8)
        return {'returncode': result.returncode, 'stdout': result.stdout[-1000:], 'stderr': result.stderr[-1000:]}
    except Exception as error:
        return {'returncode': 1, 'error': type(error).__name__}

def joint_pulse(door_id, velocity, duration=1.7):
    """Drive an already-loaded Gazebo hinge through its real controller.

    This is deliberately different from inserting an obstacle or setting a
    pose: the existing door joint moves under Gazebo physics, so the lidar and
    costmap see the same collision geometry that the normal door capability
    uses.  The controller is private scenario actuation and never enters the
    agent/tool trace.
    """
    topic = f'/model/door_{door_id}/joint/{door_id}_hinge/cmd_vel'
    args = [str(GZ), 'topic', '-t', topic, '-m', 'gz.msgs.Double', '-p', f'data: {velocity}']
    stop_args = [str(GZ), 'topic', '-t', topic, '-m', 'gz.msgs.Double', '-p', 'data: 0.0']
    try:
        start = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=6)
        time.sleep(duration)
        stop = subprocess.run(stop_args, cwd=ROOT, capture_output=True, text=True, timeout=6)
        return {'topic': topic, 'velocity': velocity, 'duration_sec': duration,
                'start_returncode': start.returncode, 'stop_returncode': stop.returncode,
                'stdout': (start.stdout + stop.stdout)[-1000:],
                'stderr': (start.stderr + stop.stderr)[-1000:]}
    except Exception as error:
        return {'topic': topic, 'velocity': velocity, 'duration_sec': duration,
                'returncode': 1, 'error': type(error).__name__}

def carrier_pulse(distance, velocity=1.0):
    """Move the preloaded event body through its real prismatic joint."""
    topic = '/model/runtime_event_carrier/joint/event_slide/cmd_vel'
    # Gazebo is intentionally running headless and faster than wall time. A
    # direct calibration on the real joint measured about 6.0 m of travel per
    # wall-second at command velocity 1.0. Use that bounded physical pulse so
    # the body reaches the selected corridor instead of relying on a fixed
    # wall-time minimum that overshoots it.
    signed_velocity = abs(float(velocity)) if float(distance) >= 0 else -abs(float(velocity))
    duration = max(0.02, abs(float(distance)) / abs(float(velocity)) * 0.168)
    args = [str(GZ), 'topic', '-t', topic, '-m', 'gz.msgs.Double', '-p', f'data: {signed_velocity}']
    stop_args = [str(GZ), 'topic', '-t', topic, '-m', 'gz.msgs.Double', '-p', 'data: 0.0']
    try:
        start = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=6)
        time.sleep(duration)
        stop = subprocess.run(stop_args, cwd=ROOT, capture_output=True, text=True, timeout=6)
        return {'topic': topic, 'distance_m': distance, 'velocity_m_s': signed_velocity,
                'duration_sec': duration, 'start_returncode': start.returncode,
                'stop_returncode': stop.returncode,
                'stdout': (start.stdout + stop.stdout)[-1000:],
                'stderr': (start.stderr + stop.stderr)[-1000:]}
    except Exception as error:
        return {'topic': topic, 'distance_m': distance, 'velocity_m_s': signed_velocity,
                'duration_sec': duration, 'returncode': 1, 'error': type(error).__name__}

def model_sdf(name, x, y, yaw, label, size=(0.35, 0.35, 0.4), collision=False):
    sx, sy, sz = size
    collision_xml = f'<collision name="collision"><geometry><box><size>{sx} {sy} {sz}</size></box></geometry></collision>' if collision else ''
    inertial_xml = ('<gravity>false</gravity><inertial><mass>20</mass><inertia>'
                    '<ixx>1.0</ixx><iyy>1.0</iyy><izz>1.0</izz>'
                    '</inertia></inertial>') if collision else ''
    if label == 'person':
        body = person_links()
    elif label == 'crate_block':
        body = f'<link name="body">{inertial_xml}{collision_xml}<visual name="visual"><geometry><box><size>{sx} {sy} {sz}</size></box></geometry><material><diffuse>.52 .28 .08 1</diffuse></material></visual></link>'
    else:
        body = f'<link name="body">{inertial_xml}{collision_xml}<visual name="visual"><geometry><box><size>{sx} {sy} {sz}</size></box></geometry><material><diffuse>.35 .25 .12 1</diffuse></material></visual></link>'
    # Runtime blockers are real non-teleporting Gazebo bodies.  Keep gravity
    # disabled so the event remains at its generated map pose while its
    # collision participates in lidar/raycast and Nav2 costmap marking.
    static = '<static>false</static>' if collision else '<static>true</static>'
    z = sz / 2.0 if collision else 0.0
    return f'<?xml version="1.0"?><sdf version="1.9"><model name="{name}">{static}<pose>{x} {y} {z} {0} {0} {yaw}</pose>{body}</model></sdf>'

class ImportedRuntimeController(Node):
    def __init__(self):
        super().__init__('imported_runtime_controller')
        self.scan = None
        self.pose = None
        self.path_count = 0
        self.latest_path = None
        self.localized_pose = None
        if os.environ.get('SCENARIO_LOCALIZATION') == 'amcl':
            self.create_subscription(PoseWithCovarianceStamped, '/amcl_pose', self.on_localization, 10)
        self.carrier_feedback = None
        if SPEC.get('layout_id') == 'lotus_a_greybox':
            from lotus_closed_loop import CarrierFeedback
            self.carrier_feedback = CarrierFeedback(WORLD, SPEC['event']['carrier_start'])
        self.fired = False
        self.event_finished = False
        self.history = []
        self.global_costmap = None
        self.local_costmap = None
        self.inspection_events = self.create_subscription(String, '/rescue/inspection_completed', self.trigger, 10)
        self.scan_sub = self.create_subscription(LaserScan, '/scan', self.on_scan, qos_profile_sensor_data)
        self.pose_sub = self.create_subscription(Odometry, '/odom', self.on_pose, 20)
        self.path_sub = self.create_subscription(NavPath, '/plan', self.on_path, 10)
        self.global_costmap_sub = self.create_subscription(OccupancyGrid, '/global_costmap/costmap', self.on_global_costmap, 2)
        self.local_costmap_sub = self.create_subscription(OccupancyGrid, '/local_costmap/costmap', self.on_local_costmap, 2)
        prior_names = ('imported-physical-event.json', 'imported-lidar-before.json', 'imported-lidar-after.json', 'imported-pose-history.json', 'imported-nav-paths.jsonl', 'imported-physical-objects.json')
        prior_names += tuple(p.name for p in OUT.glob('lotus-*.json'))
        for name in prior_names:
            previous = OUT / name
            if previous.exists():
                archive = OUT / 'previous-evidence' / str(time.time_ns())
                archive.mkdir(parents=True, exist_ok=True)
                previous.rename(archive / name)
        self.spawn_objects()
        # For a door-close event the door is an existing map-prior object.  It
        # starts physically open so that the later close is a real state change
        # on an already-rendered collision entity (and not a post-start model
        # insertion that gpu_lidar cannot reliably pick up).  The runtime
        # state is still UNKNOWN to the agent until it observes the door.
        initial_event = SPEC.get('event', {})
        if initial_event.get('type') in ('door_closes', 'carrier_block') and initial_event.get('door_id'):
            # start-stack launches this node concurrently with Gazebo/Nav2;
            # wait for the already-declared joint controller before preparing
            # the initial OPEN state.  The bounded repeats are idempotent at
            # the joint upper limit and avoid an early-publish race.
            self.initial_door_setup = []
            for _ in range(3):
                time.sleep(0.8)
                self.initial_door_setup.append(joint_pulse(initial_event['door_id'], 1.0, 1.2))
        else:
            self.initial_door_setup = None
        save('imported-physical-event.json', {'triggered': False, 'agent_notified': False, 'source': 'Gazebo physical runtime only'})

    def spawn_objects(self):
        victim = SPEC.get('victim', {})
        specs = []
        if victim.get('x') is not None:
            specs.append(('imported_victim', victim['x'], victim['y'], victim.get('yaw', 0), 'person', (0.28, 0.45, 0.65), False))
        for obj in SPEC.get('objects', []):
            specs.append((obj['id'], obj['x'], obj['y'], obj.get('yaw', 0), obj.get('label', 'object'), tuple(obj.get('size', [0.35, 0.35, 0.4])), False))
        evidence = []
        for name, x, y, yaw, label, size, collision in specs:
            gz_service('remove', name)
            sdf = RUNTIME / f'{name}.sdf'
            sdf.write_text(model_sdf(name, x, y, yaw, label, size, collision))
            evidence.append({'model': name, 'label': label, 'response': gz_service('create', name, sdf)})
        save('imported-physical-objects.json', {'source': 'private scenario -> Gazebo EntityFactory', 'agent_visible_truth': False, 'objects': evidence})

    def on_scan(self, msg):
        if self.event_finished: return
        self.scan = {'timestamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec}, 'ranges': [float(v) if math.isfinite(v) else None for v in msg.ranges], 'pose': self.pose}

    def on_localization(self, msg):
        if self.event_finished: return
        self.localized_pose = [msg.pose.pose.position.x, msg.pose.pose.position.y]

    def robot_map_pose(self):
        if os.environ.get('SCENARIO_LOCALIZATION') == 'amcl':
            if self.localized_pose is None:
                raise RuntimeError('ONBOARD_LOCALIZATION_NOT_READY')
            return list(self.localized_pose)
        return [self.pose['x'] + float(os.environ.get('SCENARIO_MAP_ODOM_X', 0)),
                self.pose['y'] + float(os.environ.get('SCENARIO_MAP_ODOM_Y', 0))]

    def on_global_costmap(self, msg):
        if self.event_finished: return
        self.global_costmap = msg

    def on_local_costmap(self, msg):
        if self.event_finished: return
        self.local_costmap = msg

    def costmap_summary(self, msg, event):
        if msg is None: return {'available': False}
        ox, oy = msg.info.origin.position.x, msg.info.origin.position.y
        res = msg.info.resolution
        cx = int((float(event.get('x', 0)) - ox) / res)
        cy = int((float(event.get('y', 0)) - oy) / res)
        radius = max(2, int(max(event.get('size', [1, 1])) / res))
        cells = []
        for yy in range(max(0, cy - radius), min(msg.info.height, cy + radius + 1)):
            for xx in range(max(0, cx - radius), min(msg.info.width, cx + radius + 1)):
                value = int(msg.data[yy * msg.info.width + xx])
                cells.append(value)
        return {
            'available': True,
            'frame_id': msg.header.frame_id,
            'timestamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec},
            'resolution': res,
            'event_cell': {'x': cx, 'y': cy},
            'event_cell_value': int(msg.data[cy * msg.info.width + cx]) if 0 <= cx < msg.info.width and 0 <= cy < msg.info.height else None,
            'sample_max': max(cells) if cells else None,
            'sample_occupied_or_inflated': sum(1 for value in cells if value >= 50),
            'sample_cells': len(cells),
        }

    def on_pose(self, msg):
        if self.event_finished: return
        q = msg.pose.pose.orientation
        self.pose = {'x': msg.pose.pose.position.x, 'y': msg.pose.pose.position.y, 'yaw': math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))}
        if not self.history or time.monotonic() - self.history[-1]['wall_monotonic'] > .4:
            self.history.append({**self.pose, 'wall_monotonic': time.monotonic(), 'sim_sec': msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9})
            save('imported-pose-history.json', self.history)
        event = SPEC.get('event', {})
        if (not self.fired and event.get('trigger') in ('on_region_entry', 'on_side_entry', 'on_d_c_approach', 'on_room_a_approach')
                and self.scan is not None and self.global_costmap is not None):
            layout = SPEC.get('layout_id', '')
            if layout == 'lotus_a_greybox':
                # Trigger before the robot reaches the A_Main -> A_Tree
                # connector.  The event remains private; this only moves the
                # real pre-existing Gazebo hinge before the old route reaches
                # it, allowing Nav2 sensors/costmaps to observe the change.
                if event.get('door_id') == 'D_A_MainTree':
                    in_trigger_region = self.pose['x'] > 1.4 and self.pose['y'] < -5.0
                else:
                    # Lotus is triggered by a suitable real future /plan,
                    # rather than a late fixed odometry region.
                    in_trigger_region = False
            elif event.get('trigger') == 'on_side_entry':
                in_trigger_region = self.pose['x'] > 5.4 and self.pose['y'] < -2.8
            elif event.get('trigger') == 'on_d_c_approach':
                # The imported D_c interaction pose is approached from the
                # map-side corridor at the observed y=-1.3..-1.5 band.
                in_trigger_region = self.pose['x'] > 1.2 and -1.8 < self.pose['y'] < -0.8
            elif event.get('trigger') == 'on_room_a_approach':
                in_trigger_region = (self.pose['x'] > float(event.get('x', 1.2)) - 1.1
                                     and abs(self.pose['y'] - float(event.get('y', 0.0))) < 1.2)
            else:
                # Trigger before the robot reaches the planned blocker.  The
                # simple imported corridor is traversed with a small real
                # controller lateral offset (including negative y); the
                # trigger covers that physical corridor band rather than a
                # scripted route or a semantic agent instruction.
                in_trigger_region = self.pose['x'] > 4.8 and -0.8 < self.pose['y'] < 1.6
            if in_trigger_region:
                self.fired = True
                threading.Thread(target=self.spawn_event, daemon=True).start()

    def on_path(self, msg):
        if self.event_finished: return
        self.path_count += 1
        points = [[p.pose.position.x, p.pose.position.y] for p in msg.poses]
        path_hash = hashlib.sha256(json.dumps(points, separators=(',', ':')).encode()).hexdigest()
        self.latest_path = {'wall_time': time.time(), 'points': points,
                            'path_hash': path_hash, 'frame_id': msg.header.frame_id,
                            'timestamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec}}
        with (OUT / 'imported-nav-paths.jsonl').open('a') as stream:
            stream.write(json.dumps({'seq': self.path_count, 'wall_time': time.time(), 'timestamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec}, 'points': points, 'path_hash': path_hash}) + '\n')
        if self.carrier_feedback is not None and not self.fired and self.pose and self.global_costmap:
            from lotus_closed_loop import choose_target
            try:
                pose = self.robot_map_pose()
                choose_target(self.latest_path, pose, self.global_costmap, SPEC['event'], .4)
            except (RuntimeError, ValueError):
                pass
            else:
                self.fired = True
                threading.Thread(target=self.spawn_event, daemon=True).start()
        if (not self.fired and SPEC.get('event', {}).get('trigger') == 'after_navigation_observation'
                and self.path_count >= 1):
            self.fired = True
            threading.Thread(target=self.spawn_event, daemon=True).start()

    def trigger(self, message):
        if self.fired or json.loads(message.data).get('status') != 'SUCCEEDED': return
        self.fired = True
        threading.Thread(target=self.spawn_event, daemon=True).start()

    def spawn_event(self):
        event = SPEC.get('event', {})
        before = {
            'wall_time': time.time(),
            'pose': self.pose,
            'path_count': self.path_count,
            'scan': self.scan,
            'global_costmap': self.costmap_summary(self.global_costmap, event),
            'local_costmap': self.costmap_summary(self.local_costmap, event),
        }
        if self.scan is not None: save('imported-lidar-before.json', self.scan)
        if event.get('type') == 'jammed_door':
            # The jam is a real Gazebo joint-limit condition compiled into the
            # validation-only skeleton.  Do not add a second opaque collider
            # in front of the door: it would hide the door from the real
            # Camera and turn the test into a visibility/precondition failure.
            save('imported-physical-event.json', {
                'triggered': True,
                'agent_notified': False,
                'event_type_private': 'jammed_door',
                'physical_mechanism': 'Gazebo D_c_entry_hinge upper_limit=0.0',
                'gazebo_response': {'returncode': 0, 'stdout': 'compiled_joint_limit_active', 'stderr': ''},
                'trigger': event.get('trigger'),
                'trigger_observation': {'wall_time': before['wall_time'], 'pose': before['pose'], 'path_count': before['path_count']},
                'sensor_before_timestamp': (before['scan'] or {}).get('timestamp'),
                'sensor_after_timestamp': (self.scan or {}).get('timestamp'),
                'source': 'compiled Gazebo joint constraint; no runtime semantic notification'
            })
            return
        if event.get('type') == 'carrier_block':
            if self.carrier_feedback is not None:
                self.closed_loop_event(event, before)
                return
            start = event.get('carrier_start', [0, 0])
            distance = float(event.get('x', 0)) - float(start[0]) if event.get('carrier_axis') == 'x' else float(event.get('y', 0)) - float(start[1])
            command = carrier_pulse(distance)
            command['target_relative_distance_m'] = distance
            physical_created_at = time.time()
            time.sleep(2.0)
            if self.scan is not None: save('imported-lidar-after.json', self.scan)
            costmap_after = self.costmap_summary(self.global_costmap, event)
            local_costmap_after = self.costmap_summary(self.local_costmap, event)
            save('imported-costmap-before.json', before['global_costmap'])
            save('imported-costmap-after.json', costmap_after)
            save('imported-physical-event.json', {
                'triggered': command.get('start_returncode') == 0 and command.get('stop_returncode') == 0,
                'agent_notified': False,
                'event_type_private': 'carrier_block',
                'physical_mechanism': 'preloaded Gazebo prismatic joint moved collision body into route',
                'gazebo_response': command,
                'physical_event_created_at': physical_created_at,
                'trigger': event.get('trigger'),
                'trigger_observation': {'wall_time': before['wall_time'], 'pose': before['pose'], 'path_count': before['path_count']},
                'sensor_before_timestamp': (before['scan'] or {}).get('timestamp'),
                'sensor_after_timestamp': (self.scan or {}).get('timestamp'),
                'costmap_before': before['global_costmap'],
                'costmap_after': costmap_after,
                'local_costmap_before': before['local_costmap'],
                'local_costmap_after': local_costmap_after,
                'source': 'preloaded Gazebo collision + real prismatic-joint motion + LiDAR/Nav2 evidence'
            })
            return
        if event.get('type') == 'door_closes':
            # The door is part of the activated world from time zero.  Closing
            # it here moves pre-existing collision geometry through a real
            # Gazebo hinge, avoiding the known limitation of inserting a new
            # render/collision entity after gpu_lidar has been initialized.
            door_id = event['door_id']
            command = joint_pulse(door_id, -1.0, 1.7)
            physical_created_at = time.time()
            time.sleep(2.0)
            if self.scan is not None: save('imported-lidar-after.json', self.scan)
            costmap_after = self.costmap_summary(self.global_costmap, event)
            local_costmap_after = self.costmap_summary(self.local_costmap, event)
            save('imported-costmap-before.json', before['global_costmap'])
            save('imported-costmap-after.json', costmap_after)
            save('imported-physical-event.json', {
                'triggered': command.get('start_returncode') == 0 and command.get('stop_returncode') == 0,
                'agent_notified': False,
                'event_type_private': 'door_closes',
                'door_id': door_id,
                'physical_mechanism': 'pre-existing Gazebo hinge driven by bounded negative velocity pulse',
                'gazebo_response': command,
                'physical_event_created_at': physical_created_at,
                'trigger': event.get('trigger'),
                'trigger_observation': {'wall_time': before['wall_time'], 'pose': before['pose'], 'path_count': before['path_count']},
                'sensor_before_timestamp': (before['scan'] or {}).get('timestamp'),
                'sensor_after_timestamp': (self.scan or {}).get('timestamp'),
                'costmap_before': before['global_costmap'],
                'costmap_after': costmap_after,
                'local_costmap_before': before['local_costmap'],
                'local_costmap_after': local_costmap_after,
                'source': 'pre-existing Gazebo door collision + real LiDAR/Nav2 evidence'
            })
            return
        name = 'jammed_door_blocker' if event.get('type') == 'jammed_door' else 'imported_dynamic_blocker'
        gz_service('remove', name)
        sdf = RUNTIME / f'{name}.sdf'
        sdf.write_text(model_sdf(name, event['x'], event['y'], event.get('yaw', 0), event.get('type', 'crate_block'), tuple(event.get('size', [0.8, 1.2, 1.2])), True))
        response = gz_service('create', name, sdf)
        physical_created_at = time.time()
        time.sleep(4.0)
        if self.scan is not None: save('imported-lidar-after.json', self.scan)
        costmap_after = self.costmap_summary(self.global_costmap, event)
        local_costmap_after = self.costmap_summary(self.local_costmap, event)
        save('imported-costmap-before.json', before['global_costmap'])
        save('imported-costmap-after.json', costmap_after)
        save('imported-physical-event.json', {
            'triggered': response['returncode'] == 0 and 'true' in response.get('stdout', '').lower(),
            'agent_notified': False,
            'event_type_private': event.get('type'),
            'gazebo_response': response,
            'physical_event_created_at': physical_created_at,
            'trigger': event.get('trigger'),
            'trigger_observation': {'wall_time': before['wall_time'], 'pose': before['pose'], 'path_count': before['path_count']},
            'sensor_before_timestamp': (before['scan'] or {}).get('timestamp'),
            'sensor_after_timestamp': (self.scan or {}).get('timestamp'),
            'costmap_before': before['global_costmap'],
            'costmap_after': costmap_after,
            'local_costmap_before': before['local_costmap'],
            'local_costmap_after': local_costmap_after,
            'source': 'Gazebo collision entity + later real LiDAR/Nav2 evidence'
        })

    def closed_loop_event(self, event, before):
        from lotus_closed_loop import choose_target, intersects
        old = self.latest_path
        try:
            if not old or len(old['points']) < 2 or old['frame_id'] != 'map':
                raise RuntimeError('MISSING_REAL_OLD_MAP_PATH')
            # Odom is relative to the spawn frame; /plan is in map.
            pose = self.robot_map_pose()
            radius = .4  # activated Nav2 robot_radius
            selection = choose_target(old, pose, self.global_costmap, event, radius)
            initial = self.carrier_feedback.get()
            save('lotus-old-path-target.json', {'old_plan': old, 'robot_map_pose': pose,
                 'selection': selection, 'source': 'real /plan and pre-event global costmap',
                 'agent_notified': False})
            target = selection['target']
            save('lotus-event-target-geometry.json', {'target_center': target,
                 'target_joint_position': target[1] - event['carrier_start'][1],
                 'initial_actual': initial, 'collision_size': event['size'],
                 'robot_radius': radius, 'selection': selection,
                 'planned_intersection': intersects(old['points'], target, event['size'], radius)})
            validation = self.carrier_feedback.move(target, old['points'], event['size'],
                                                   radius, OUT / 'lotus-actuator-feedback.json')
            save('lotus-event-closed-loop-validation.json', validation)
            save('imported-physical-event.json', {'triggered': validation['pass'],
                 'agent_notified': False, 'physical_event_created_at': validation['physical_event_reached_target'],
                 'trigger_observation': {'wall_time': before['wall_time'], 'pose': before['pose']},
                 'closed_loop': validation, 'source': 'real Gazebo body feedback and velocity actuator'})
            self.event_finished = validation['pass']
            # Controller provides no post-event state. Onboard ROS/Nav2 and
            # separate read-only recorder own all subsequent observations.
        except Exception as error:
            self.carrier_feedback.drive(0)
            save('lotus-event-closed-loop-validation.json', {'pass': False,
                 'error': str(error), 'old_plan_available': bool(old), 'agent_notified': False})
            save('imported-physical-event.json', {'triggered': False, 'agent_notified': False,
                 'error': str(error), 'source': 'private physical controller'})

rclpy.init()
node = ImportedRuntimeController()
try:
    rclpy.spin(node)
except KeyboardInterrupt:
    pass
finally:
    node.destroy_node()
    rclpy.try_shutdown()
