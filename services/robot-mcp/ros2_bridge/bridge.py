"""JSONL/rclpy bridge. Stdout is protocol only; no simulator state is imported."""
import json
import base64
import fcntl
import hashlib
import math
import os
import signal
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

os.environ['RCUTILS_LOGGING_USE_STDOUT'] = '0'
import rclpy
from rclpy.action import ActionClient
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.time import Time
from rclpy.duration import Duration
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry, OccupancyGrid, Path as NavPath
from std_msgs.msg import String
from nav2_msgs.action import NavigateToPose, NavigateThroughPoses
from geometry_msgs.msg import PoseStamped
from nav2_msgs.srv import ClearEntireCostmap
from nav2_msgs.msg import Costmap
from action_msgs.msg import GoalStatus, GoalStatusArray
from action_msgs.srv import CancelGoal
from lifecycle_msgs.srv import GetState
from sensor_msgs.msg import LaserScan, Image, CameraInfo
from rclpy.qos import qos_profile_sensor_data, QoSProfile, DurabilityPolicy, ReliabilityPolicy
from tf2_ros import Buffer, TransformListener
from sensor_summary import lidar_summary, camera_summary
from perception import Perception, png_bytes
from map_pose import project_odometry
from motion_stop import StopMailbox
from cv_detector import CvPerception
from camera_stream import CameraStream, CameraStreamUnavailable
from navigation_result import nav2_result_details
from doorway_navigation import plan_doorway_route, DoorwayRouteError


class SafeError(Exception):
    def __init__(self, code):
        self.code = code


# The managed MCP request may return a pending operation before the SDK's
# 60 s request deadline.  The real Nav2 goal keeps a separate bounded budget;
# timeout cancels the exact goal and ownership remains held until its late
# result is observed.  This is deliberately finite and independent of MCP.
NAVIGATION_TIMEOUT_DEFAULT = 180.0
NAVIGATION_TIMEOUT_MAX = 900.0


def await_future(future, timeout):
    event = threading.Event()
    future.add_done_callback(lambda _: event.set())
    if not event.wait(timeout):
        raise SafeError('ROS2_TIMEOUT')
    if future.exception() is not None:
        raise SafeError('ROS2_ACTION_ERROR')
    return future.result()


class Bridge(Node):
    def __init__(self):
        # Multiple legitimate MCP clients (robot and environment perception)
        # may coexist.  A process-unique node name prevents ROS graph
        # collisions and makes action ownership auditable; topics/actions
        # remain the unchanged public ROS interfaces.
        self.bridge_instance_id = f"bridge-{os.getpid()}"
        super().__init__(f'agnes_robot_bridge_{os.getpid()}', parameter_overrides=[
            Parameter('use_sim_time', value=os.environ.get('ROBOT_ROS_USE_SIM_TIME') == '1')])
        self.group = ReentrantCallbackGroup()
        self.create_subscription(Odometry, '/odom', self.on_odom, 10, callback_group=self.group)
        self.client = ActionClient(self, NavigateToPose, '/navigate_to_pose', callback_group=self.group)
        self.doorway_client = ActionClient(self, NavigateThroughPoses, '/navigate_through_poses', callback_group=self.group)
        self.cancel_client = self.create_client(CancelGoal, '/navigate_to_pose/_action/cancel_goal', callback_group=self.group)
        self.doorway_cancel_client = self.create_client(CancelGoal, '/navigate_through_poses/_action/cancel_goal', callback_group=self.group)
        self.velocity = self.create_publisher(Twist, '/cmd_vel', 10)
        self.odom_ready = threading.Event()
        self.lock = threading.Lock()
        self.navigation_lock = threading.Lock()
        self.state = None
        self.odom_received_monotonic = None
        self.active_goal = None
        self.result_future = None
        # One operation owns the ROS2 goal from acceptance until a terminal
        # result is observed.  The MCP request may time out earlier; that
        # transport fact must never release ownership or permit a second goal.
        self.navigation_operation = None
        self.last_terminal_operation = None
        self.navigation_lock_held = False
        self.navigation_status = 'IDLE'
        self.navigation_terminal_known = True
        self.sensors = {}
        self.costmap = None
        self.monitor_lotus_path = os.environ.get('SCENARIO_WORLD_NAME') == 'lotus_a_greybox'
        self.owned_path = None
        self.path_baseline = None
        self.path_conflict = None
        self.navigation_target = None
        self.event_sink = None
        self.obstacle_raw = None
        self.obstacle_baseline = None
        self.static_prior = None
        if self.monitor_lotus_path:
            self.create_subscription(NavPath, '/plan', self.on_owned_path, 10, callback_group=self.group)
            self.create_subscription(Costmap, '/global_costmap/obstacle_layer_raw',
                                     self.on_obstacle_raw, 10, callback_group=self.group)
            self.create_subscription(OccupancyGrid, '/map', self.on_static_prior,
                                     QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL),
                                     callback_group=self.group)
        self.map = None
        self.goal_statuses = None
        self.goal_statuses_by_action = {}
        # /odom is relative to Gazebo's physical spawn pose.  Imported maps
        # express semantic locations in map/world coordinates; the matching
        # map->odom calibration is supplied by the activated skeleton.  Keep
        # the legacy baseline at zero and apply only the explicit runtime
        # calibration, never a simulator pose or hidden scene state.
        try:
            self.map_odom_x = float(os.environ.get('SCENARIO_MAP_ODOM_X', '0'))
            self.map_odom_y = float(os.environ.get('SCENARIO_MAP_ODOM_Y', '0'))
            self.map_odom_yaw = float(os.environ.get('SCENARIO_MAP_ODOM_YAW', '0'))
        except ValueError:
            self.map_odom_x = self.map_odom_y = self.map_odom_yaw = 0.0
        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self, spin_thread=False)
        self.inspection_events = self.create_publisher(String, '/rescue/inspection_completed', 10)
        self.create_subscription(OccupancyGrid, '/global_costmap/costmap', self.on_costmap, 10, callback_group=self.group)
        self.create_subscription(OccupancyGrid, '/map', self.on_map, 10, callback_group=self.group)
        self.create_subscription(GoalStatusArray, '/navigate_to_pose/_action/status',
            lambda msg: self.on_goal_status(msg, 'navigate_to_pose'),
            QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL), callback_group=self.group)
        self.create_subscription(GoalStatusArray, '/navigate_through_poses/_action/status',
            lambda msg: self.on_goal_status(msg, 'navigate_through_poses'),
            QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL), callback_group=self.group)
        mode=os.environ.get('ROBOT_PERCEPTION')
        self.perception = Perception() if mode == 'vlm' else CvPerception() if mode == 'cv' else None
        self.visual_objects = {}
        self.inspection_lock = threading.Lock()
        # Navigation and active perception both move the same physical base.
        # The in-process guard closes the local TOCTOU window; the advisory
        # project lock also prevents two project bridge processes in the same
        # ROS domain from independently publishing motion commands.  flock is
        # released by the kernel if a bridge crashes, so a stale file cannot
        # retain ownership after restart.
        self.motion_owner_guard = threading.Lock()
        self.motion_lease_fd = None
        self.motion_owner = None
        self.motion_lock_path = os.environ.get(
            'ROBOT_MOTION_LOCK_FILE',
            '/data-ssd/zhongchengkai/agnes/runtime/motion-control.lock')
        self.active_inspection_owner = None
        self.inspection_cancel = threading.Event()
        self.inspection_operation = None
        self.inspection_thread = None
        self.motion_stop_shutdown = threading.Event()
        self.motion_stop_mailbox = StopMailbox(self)
        self.motion_stop_thread = threading.Thread(target=self._watch_motion_stops, daemon=True)
        self.motion_stop_thread.start()
        for message_type, topic, name in [(LaserScan, '/scan', 'lidar'),
                                          (CameraInfo, '/camera/camera_info', 'camera_info')]:
            self.create_subscription(message_type, topic,
                lambda msg, key=name: self.on_sensor(key, msg), qos_profile_sensor_data,
                callback_group=self.group)
        self.camera_stream = CameraStream(
            lambda callback: self.create_subscription(Image, '/camera/image_raw', callback,
                QoSProfile(depth=1, reliability=ReliabilityPolicy.BEST_EFFORT),
                callback_group=self.group),
            self.destroy_subscription, on_frame=lambda msg: self.on_sensor('camera', msg))
        self.camera_stream.start()
        self.doorway_geometry = self.doorway_registry = None
        registry_path = os.environ.get('ROBOT_WORLD_REGISTRY')
        if registry_path:
            from pathlib import Path
            geometry_path = Path(registry_path).with_name('dashboard-geometry.json')
            if geometry_path.is_file():
                self.doorway_geometry = json.loads(geometry_path.read_text())
                self.doorway_registry = json.loads(Path(registry_path).read_text())

    def _acquire_motion_lease(self, kind, operation_id):
        """Atomically claim base motion for navigation or active scanning."""
        with self.motion_owner_guard:
            if self.motion_owner is not None:
                return False
            try:
                parent = os.path.dirname(self.motion_lock_path)
                if parent:
                    os.makedirs(parent, exist_ok=True)
                fd = os.open(self.motion_lock_path, os.O_CREAT | os.O_RDWR, 0o600)
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (BlockingIOError, OSError):
                try:
                    os.close(fd)
                except Exception:
                    pass
                return False
            self.motion_lease_fd = fd
            self.motion_owner = {'kind': kind, 'operation_id': operation_id,
                                 'pid': os.getpid(), 'bridge_instance_id': self.bridge_instance_id,
                                 'acquired_at': time.time()}
            os.ftruncate(fd, 0)
            os.write(fd, json.dumps(self.motion_owner).encode('utf-8'))
            os.fsync(fd)
            return True

    def _release_motion_lease(self, operation_id=None):
        with self.motion_owner_guard:
            if self.motion_owner is None:
                return
            if operation_id is not None and self.motion_owner.get('operation_id') != operation_id:
                return
            fd = self.motion_lease_fd
            self.motion_lease_fd = None
            self.motion_owner = None
            if fd is not None:
                try:
                    os.ftruncate(fd, 0)
                    fcntl.flock(fd, fcntl.LOCK_UN)
                finally:
                    os.close(fd)

    def _motion_owner_snapshot(self):
        with self.motion_owner_guard:
            return dict(self.motion_owner) if self.motion_owner else None

    def _external_motion_owner(self):
        """Read another bridge's lease without ever taking its lock."""
        try:
            fd = os.open(self.motion_lock_path, os.O_RDONLY)
        except OSError:
            return None
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raw = os.read(fd, 4096)
                try:
                    return json.loads(raw.decode('utf-8')) if raw else {'unknown': True}
                except Exception:
                    return {'unknown': True}
            else:
                fcntl.flock(fd, fcntl.LOCK_UN)
                return None
        finally:
            os.close(fd)

    def on_costmap(self, msg):
        self.costmap = msg
        if self.monitor_lotus_path:
            self.check_owned_path(msg)

    def audit_navigation(self, kind, evidence):
        from pathlib import Path
        root = Path('/data-ssd/zhongchengkai/agnes')
        out = Path(os.environ.get('ROBOT_TRACE_DIR', root / 'artifacts/interactive-live/full-mission'))
        out.resolve().relative_to(root)
        out.mkdir(parents=True, exist_ok=True)
        with (out / 'onboard-path-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'type': kind, 'wall_time': time.time(),
                                     'bridge_instance_id': getattr(self, 'bridge_instance_id', None),
                                     **evidence}) + '\n')

    def _operation_snapshot(self):
        with self.lock:
            return dict(self.navigation_operation) if self.navigation_operation else None

    def _terminal_status(self, result):
        status = int(getattr(result, 'status', 0))
        if status == GoalStatus.STATUS_SUCCEEDED:
            return 'SUCCEEDED'
        if status == GoalStatus.STATUS_CANCELED:
            return 'CANCELED'
        if status == GoalStatus.STATUS_ABORTED:
            return 'ABORTED'
        return 'UNKNOWN'

    def _finish_detached_operation(self, operation, future):
        """Record a late terminal result and release the exact owner lock."""
        try:
            result = future.result()
            terminal = self._terminal_status(result)
            error_code = int(getattr(result.result, 'error_code', 0))
            error_msg = str(getattr(result.result, 'error_msg', ''))
            error = None
        except Exception as exc:
            terminal = 'UNKNOWN'
            error_code = None
            error_msg = None
            error = type(exc).__name__
        with self.lock:
            current = self.navigation_operation
            if not current or current.get('operation_id') != operation.get('operation_id'):
                return
            current.update({'state': terminal, 'terminal_at': time.time(),
                            'terminal_status': terminal, **nav2_result_details(terminal, error_code, error_msg),
                            'terminal_error': error, 'terminal_known': terminal != 'UNKNOWN'})
            self.last_terminal_operation = dict(current)
            self.navigation_status = terminal
            self.navigation_terminal_known = terminal != 'UNKNOWN'
            self.active_goal = None
            self.result_future = None
            self.navigation_operation = None
            release = self.navigation_lock_held
            self.navigation_lock_held = False
        self.audit_navigation('navigation_terminal', {
            'operation_id': operation.get('operation_id'),
            'goal_id': operation.get('goal_id'), 'action_status': terminal,
            'error_code': error_code, 'error_msg': error_msg, 'terminal_error': error,
            'late_terminal': True, 'terminal_known': terminal != 'UNKNOWN'})
        if release:
            self.navigation_lock.release()
        self._release_motion_lease(operation.get('operation_id'))

    def on_static_prior(self, msg):
        self.static_prior = msg

    def on_obstacle_raw(self, msg):
        self.obstacle_raw = msg
        if self.costmap is not None:
            self.check_owned_path(self.costmap)

    def dynamic_markings(self):
        raw, before, prior = self.obstacle_raw, self.obstacle_baseline, self.static_prior
        if raw is None or before is None or prior is None:
            return []
        if len(raw.data) != len(before.data):
            return []
        metadata = raw.metadata
        resolution = metadata.resolution
        width = metadata.size_x
        origin = metadata.origin.position
        p = prior.info
        result = []
        # Exclude observations close to known static walls: wheel odometry
        # uncertainty must not be mislabeled as a new dynamic obstruction.
        for k, value in enumerate(raw.data):
            if value != 254 or before.data[k] == 254:
                continue
            x = origin.x + (k % width + .5) * resolution
            y = origin.y + (k // width + .5) * resolution
            cx = int((x-p.origin.position.x)/p.resolution)
            cy = int((y-p.origin.position.y)/p.resolution)
            radius = math.ceil(.9/p.resolution)
            wall_near = any(prior.data[yy*p.width+xx] >= 100
                            for yy in range(max(0,cy-radius),min(p.height,cy+radius+1))
                            for xx in range(max(0,cx-radius),min(p.width,cx+radius+1))
                            if math.hypot(xx-cx,yy-cy)*p.resolution <= .9)
            if not wall_near:
                result.append([x,y])
        # A few disconnected single cells do not establish an obstacle.
        # Require a local surface cluster before relating inflation to path.
        return [a for a in result if sum(math.dist(a,b)<=.35 for b in result)>=3]

    def on_owned_path(self, msg):
        if self.navigation_lock.locked() and self.owned_path is None and msg.header.frame_id == 'map':
            self.owned_path = [[p.pose.position.x, p.pose.position.y] for p in msg.poses]
            self.audit_navigation('old_plan_created', {'points': self.owned_path,
                                  'goal_id': bytes(self.active_goal.goal_id.uuid).hex() if self.active_goal else None})

    def check_owned_path(self, grid):
        old, baseline, handle = self.owned_path, self.path_baseline, self.active_goal
        entry = self.sensors.get('lidar')
        if not old or not baseline or handle is None or self.path_conflict or not self.state or not entry:
            return
        if time.monotonic() - entry[1] > .5:
            return
        if (grid.info.width, grid.info.height, grid.info.resolution) != (baseline.info.width, baseline.info.height, baseline.info.resolution):
            return
        dynamic_points = self.dynamic_markings()
        if len(dynamic_points) < 3:
            return
        position = self.state['position']
        nearest = min(range(len(old)), key=lambda i: math.hypot(old[i][0]-position['x'], old[i][1]-position['y']))
        w, h, res = grid.info.width, grid.info.height, grid.info.resolution
        ox, oy = grid.info.origin.position.x, grid.info.origin.position.y
        conflicts = []
        for index in range(nearest + 1, len(old)):
            x, y = old[index]
            cx, cy = int((x-ox)/res), int((y-oy)/res)
            if 0 <= cx < w and 0 <= cy < h:
                k = cy*w+cx
                if (grid.data[k] >= 99 and 0 <= baseline.data[k] < 99
                        and any(math.hypot(x-a,y-b) <= .65 for a,b in dynamic_points)):
                    conflicts.append({'path_index': index, 'point': [x,y], 'cell': [cx,cy],
                                      'before': int(baseline.data[k]), 'after': int(grid.data[k])})
        if not conflicts:
            return
        # This live state is derived solely from fresh onboard scan and the
        # changed Nav2 grid. No scenario/controller input is consumed.
        self.path_conflict = {'source': 'live_nav2_path_costmap_and_lidar',
                              'live_world_updated_at': time.time(), 'conflicts': conflicts,
                              'new_dynamic_lidar_markings': dynamic_points,
                              'lidar': lidar_summary(entry[0]),
                              'costmap_stamp': {'sec':grid.header.stamp.sec,'nanosec':grid.header.stamp.nanosec}}
        self.audit_navigation('onboard_path_conflict_detected', {'evidence': self.path_conflict})
        if self.event_sink:
            self.event_sink({'event': 'onboard_path_conflict',
                             'goal_id': bytes(handle.goal_id.uuid).hex(),
                             'target': self.navigation_target, 'evidence': self.path_conflict})

    def ack_world_update(self, params):
        handle = self.active_goal
        if (handle is None or self.path_conflict is None or
                params.get('goal_id') != bytes(handle.goal_id.uuid).hex()):
            raise SafeError('STALE_WORLD_UPDATE_ACK')
        if self.path_conflict.get('gateway_updated_at') is not None:
            return {'acknowledged': True, 'duplicate': True}
        self.path_conflict['gateway_updated_at'] = params['gateway_updated_at']
        self.audit_navigation('live_world_updated', {'evidence': self.path_conflict,
                              'gateway_updated_at': params['gateway_updated_at'],
                              'world_model_entry': params.get('world_model_entry'),
                              'world_model': 'RuntimeWorldState.blocked_routes'})
        self.audit_navigation('old_plan_invalidation_requested', {'goal_id': bytes(handle.goal_id.uuid).hex(),
                              'evidence': self.path_conflict})
        future = handle.cancel_goal_async()
        def canceled(f):
            result = f.result() if f.exception() is None else None
            self.path_conflict['old_plan_invalidated_at'] = time.time() if result and result.goals_canceling else None
            self.audit_navigation('old_plan_invalidated', {'accepted': bool(result and result.goals_canceling),
                                  'goal_id': bytes(handle.goal_id.uuid).hex()})
        future.add_done_callback(canceled)
        return {'acknowledged': True, 'goal_id': params['goal_id']}

    def on_map(self, msg):
        self.map = msg

    def on_goal_status(self, msg, action_name='navigate_to_pose'):
        with self.lock:
            statuses = getattr(self, 'goal_statuses_by_action', {})
            statuses[action_name] = list(msg.status_list)
            self.goal_statuses_by_action = statuses
            self.goal_statuses = [entry for values in statuses.values() for entry in values]

    def blocked_evidence(self, pose):
        m = self.costmap
        entry = self.sensors.get('lidar')
        if m is None or entry is None or time.monotonic()-entry[1]>3:return None
        i=int((pose['x']-m.info.origin.position.x)/m.info.resolution)
        j=int((pose['y']-m.info.origin.position.y)/m.info.resolution)
        if not (0<=i<m.info.width and 0<=j<m.info.height):return None
        radius=math.ceil(0.5/m.info.resolution)
        cells=[m.data[y*m.info.width+x] for y in range(max(0,j-radius),min(m.info.height,j+radius+1))
               for x in range(max(0,i-radius),min(m.info.width,i+radius+1))
               if math.hypot(x-i,y-j)*m.info.resolution<=0.5]
        value=max(cells,default=0)
        if value<100:return None
        return {'source':'live_nav2_costmap_and_lidar','goal_occupancy':int(value),'lidar':lidar_summary(entry[0])}

    def on_sensor(self, name, msg):
        with self.lock:
            self.sensors[name] = (msg, time.monotonic())

    def observation(self, focus=None):
        # A newly connected MCP bridge may have odometry before the first
        # camera message. Door inspection must wait for an actual fresh frame,
        # not mistake subscription startup for a missing camera.
        try:
            self.fresh_frame()
        except SafeError:
            pass  # Fail closed below; an unavailable frame is never fabricated.
        state = self.get_state()
        with self.lock:
            sensors = dict(self.sensors)
        def summarize(name, function):
            entry = sensors.get(name)
            if entry is None or time.monotonic() - entry[1] > 3:
                return {'available': False, 'status': 'SENSOR_UNAVAILABLE_OR_STALE'}
            return function(entry[0])
        result = {'status': 'SUCCEEDED', 'source': 'ros2_real_sensors',
                'timestamp': state['timestamp'], 'robot_pose': state['pose'],
                'location': state['current_location'], 'observations': [],
                'object_observations': [], 'semantic_objects': [],
                'lidar': summarize('lidar', lidar_summary),
                'camera': summarize('camera', camera_summary)}
        # Carry the exact summarized ROS frame as an MCP image, independent of text budgets.
        if result['camera']['available']:
            frame_png = png_bytes(sensors['camera'][0])
            result['camera']['png_sha256'] = hashlib.sha256(frame_png).hexdigest()
            result['_camera_image'] = {
                'type': 'image', 'mimeType': 'image/png',
                'data': base64.b64encode(frame_png).decode('ascii'),
            }
        result['perception_status'] = 'NOT_CONFIGURED'
        if getattr(self, 'camera_stream', None):
            result['camera_diagnostics'] = self.camera_stream.diagnostics()
        if self.perception and not result['camera']['available']:
            result['perception_status'] = 'CAMERA_UNAVAILABLE'
        if self.perception and result['camera']['available']:
            try:
                result['semantic_objects'] = self.detect_frame(sensors['camera'][0], state, focus)
                result['perception_status'] = 'AVAILABLE'
                result['perception_source'] = 'ros2_camera_perception'
            except SafeError as error:
                if error.code != 'PERCEPTION_UNAVAILABLE':
                    raise
                # Raw frame remains available to the main Agnes multimodal session.
                result['perception_status'] = 'PERCEPTION_UNAVAILABLE'
                result['perception_source'] = 'ros2_camera_sensor'
                result['perception_error'] = error.code
                result['perception_error_stage'] = getattr(error, 'perception_stage', 'UNKNOWN')
            result['object_observations'] = [{'object_id':d['id'],'location':state['current_location'],
                'labels':[{'name':d['label'],'confidence':d['confidence']}]} for d in result['semantic_objects']]
        result['vision_observation'] = {
            'frame_timestamp': result['camera'].get('frame_timestamp') if isinstance(result.get('camera'), dict) else None,
            'robot_pose': result['robot_pose'],
            'detections': result['semantic_objects'],
            'source': result.get('perception_source', 'ros2_camera_sensor'),
            'uncertainty': 'per-detection evidence' if result['semantic_objects'] else 'UNKNOWN',
            'frame_hash': result['camera'].get('summary', {}).get('sha256') if isinstance(result.get('camera'), dict) else None,
            'frame_sha256': result['camera'].get('png_sha256'),
            'provenance': 'current ROS2 /camera/image_raw frame only',
        }
        return result

    def detect_frame(self, msg, state, focus=None):
        if not self.perception:
            raise SafeError('PERCEPTION_NOT_CONFIGURED')
        try:
            if focus and not isinstance(self.perception, Perception):
                raise ValueError('FOCUSED_PERCEPTION_REQUIRES_AGNES')
            detections = self.perception.detect(msg, focus=focus) if focus else self.perception.detect(msg)
        except Exception as error:
            print('PERCEPTION_SAFE_EXCEPTION='+type(error).__name__, file=sys.stderr, flush=True)
            safe_error = SafeError('PERCEPTION_UNAVAILABLE')
            safe_error.perception_stage = getattr(error, 'stage', 'DETECTION_ERROR')
            raise safe_error
        fx = msg.width / (2*math.tan(1.3/2))
        output = []
        for value in detections:
            d = {**value, 'view_pose':dict(state['pose'])}
            d['view_bearing'] = state['yaw'] - math.atan((d['center'][0]-msg.width/2)/fx)
            with self.lock:
                self.visual_objects[d['id']] = d
            output.append(d)
        return output

    def fresh_frame(self, previous=None):
        stream = getattr(self, 'camera_stream', None)
        if stream is not None:
            try:
                return stream.wait_fresh(previous, timeout_sec=5, max_age_sec=2)
            except CameraStreamUnavailable as error:
                failed = SafeError('CAMERA_UNAVAILABLE')
                failed.camera_diagnostics = error.diagnostics
                raise failed
        end = time.monotonic()+5
        while time.monotonic()<end:
            with self.lock:
                entry=self.sensors.get('camera')
            if entry and time.monotonic()-entry[1]<2:
                msg=entry[0]
                key=(msg.header.stamp.sec,msg.header.stamp.nanosec)
                if key!=previous:
                    return msg
            time.sleep(0.05)
        raise SafeError('CAMERA_UNAVAILABLE')

    def continuous_odometry(self):
        """Continuous local motion evidence; AMCL map corrections are not travel."""
        with self.lock:
            odom = dict(getattr(self, 'local_odometry', {}) or {})
            received = self.odom_received_monotonic
        if (received is None or time.monotonic() - received > 1.0 or
                not all(isinstance(odom.get(k), (int, float)) and math.isfinite(odom[k])
                        for k in ('x', 'y', 'yaw'))):
            raise SafeError('POSE_STALE')
        return odom

    def rotate_in_place(self, target_yaw, max_seconds=8.0, owner_token=None, odom_target_yaw=None):
        """Turn on continuous odometry, preserving map poses as location evidence."""
        start = self.get_state()
        odom_start = self.continuous_odometry()
        target = math.atan2(math.sin(float(target_yaw)), math.cos(float(target_yaw)))
        if odom_target_yaw is None:
            delta = math.atan2(math.sin(target - start['yaw']), math.cos(target - start['yaw']))
            odom_target_yaw = odom_start['yaw'] + delta
        target_odom = math.atan2(math.sin(odom_target_yaw), math.cos(odom_target_yaw))
        started = time.monotonic()
        samples, measured_radians, last_yaw = [], 0.0, odom_start['yaw']
        try:
            while time.monotonic() - started < max_seconds:
                if self.inspection_cancel.is_set():
                    raise SafeError('ROBOT_STOPPED')
                with self.lock:
                    owner = self.active_inspection_owner
                if owner_token is not None and owner != owner_token:
                    raise SafeError('MOTION_OWNERSHIP_LOST')
                state, odom = self.get_state(), self.continuous_odometry()
                drift = math.hypot(odom['x']-odom_start['x'], odom['y']-odom_start['y'])
                if drift > 0.20:
                    raise SafeError('ROTATION_XY_DRIFT')
                yaw = odom['yaw']
                measured_radians += math.atan2(math.sin(yaw-last_yaw), math.cos(yaw-last_yaw))
                last_yaw = yaw
                error = math.atan2(math.sin(target_odom-yaw), math.cos(target_odom-yaw))
                samples.append({'at':time.time(),'x':odom['x'],'y':odom['y'],
                                'yaw':yaw,'yaw_error':error,'frame_id':'odom'})
                if abs(error) <= 0.06:
                    return {'status':'SUCCEEDED','motion':'ROTATION_ONLY','control_frame':'odom',
                            'target_yaw':target,'target_odometry_yaw':target_odom,
                            'start_pose':start['pose'],'end_pose':state['pose'],
                            'start_odometry':odom_start,'end_odometry':odom,
                            'yaw_error':error,'xy_drift':drift,'measured_radians':measured_radians,
                            'map_xy_displacement':math.hypot(state['position']['x']-start['position']['x'],
                                                            state['position']['y']-start['position']['y']),
                            'duration_sec':time.monotonic()-started,'samples':samples}
                twist = Twist()
                twist.angular.z = max(-0.55, min(0.55, 2.0*error))
                if self.inspection_cancel.is_set():
                    raise SafeError('ROBOT_STOPPED')
                self.velocity.publish(twist)
                time.sleep(0.05)
            raise SafeError('ROTATION_TIMEOUT')
        finally:
            self._zero_twist()

    def capture_scan_circle(self, initial, initial_odom, owner_token, on_view, check_scan):
        """One continuous odometry circle; image inference never gates turning.

        The existing 0.55 rad/s limit and 0.20 m drift guard are unchanged.
        Eight live camera frames are accepted near the measured 45-degree
        bearings; missing/stale frames fail closed rather than skip a bearing.
        """
        started = time.monotonic()
        previous = self.fresh_frame()
        msg = self.fresh_frame((previous.header.stamp.sec, previous.header.stamp.nanosec))
        check_scan()
        first_state, first_odom = self.get_state(), self.continuous_odometry()
        last_key = (msg.header.stamp.sec, msg.header.stamp.nanosec)
        if last_key <= (previous.header.stamp.sec, previous.header.stamp.nanosec):
            raise SafeError('CAMERA_UNAVAILABLE')
        last_yaw = initial_odom['yaw']
        measured = math.atan2(math.sin(first_odom['yaw']-last_yaw),
                              math.cos(first_odom['yaw']-last_yaw))
        last_yaw = first_odom['yaw']
        motion_samples = []
        segment_start_state, segment_start_odom = initial, initial_odom
        segment_started, segment_measured = started, 0.0

        def frame_matches_odometry(frame, odom):
            stamp = odom.get('timestamp', {})
            if not all(isinstance(stamp.get(k), (int, float)) and math.isfinite(stamp[k])
                       for k in ('sec', 'nanosec')):
                return False
            frame_time = frame.header.stamp.sec + frame.header.stamp.nanosec/1e9
            odom_time = stamp['sec'] + stamp['nanosec']/1e9
            return abs(frame_time-odom_time) <= 0.15

        def motion_at(state, odom, target_progress):
            target_yaw = initial_odom['yaw'] + target_progress
            return {'status':'SUCCEEDED', 'motion':'ROTATION_ONLY', 'control_frame':'odom',
                    'target_yaw':math.atan2(math.sin(initial['yaw']+target_progress),
                                           math.cos(initial['yaw']+target_progress)),
                    'target_odometry_yaw':math.atan2(math.sin(target_yaw), math.cos(target_yaw)),
                    'start_pose':segment_start_state['pose'], 'end_pose':state['pose'],
                    'start_odometry':segment_start_odom, 'end_odometry':odom,
                    'yaw_error':target_progress-measured,
                    'xy_drift':math.hypot(odom['x']-initial_odom['x'], odom['y']-initial_odom['y']),
                    'measured_radians':measured-segment_measured,
                    'duration_sec':time.monotonic()-segment_started,
                    'samples':list(motion_samples)}

        try:
            # Capture the initial bearing while stationary, then keep moving
            # through the remaining seven bearings with no inference waits.
            if abs(measured) > 0.06:
                raise SafeError('INSPECTION_POSE_CHANGED')
            if not frame_matches_odometry(msg, first_odom):
                raise SafeError('CAMERA_UNAVAILABLE')
            on_view(msg, first_state, first_odom, motion_at(first_state, first_odom, 0.0))
            segment_start_state, segment_start_odom = first_state, first_odom
            segment_started, segment_measured = time.monotonic(), measured
            next_view = 1
            while time.monotonic()-started < 30.0:
                check_scan()
                state, odom = self.get_state(), self.continuous_odometry()
                step = math.atan2(math.sin(odom['yaw']-last_yaw), math.cos(odom['yaw']-last_yaw))
                measured += step
                last_yaw = odom['yaw']
                if measured < -0.06:
                    raise SafeError('INSPECTION_ROTATION_DIRECTION')
                remaining = 2*math.pi-measured
                motion_samples.append({'at':time.time(), 'x':odom['x'], 'y':odom['y'],
                                       'yaw':odom['yaw'], 'yaw_error':remaining, 'frame_id':'odom'})
                if next_view < 8 and measured >= next_view*math.pi/4-0.025:
                    with self.lock:
                        entry = self.sensors.get('camera')
                    key = ((entry[0].header.stamp.sec, entry[0].header.stamp.nanosec)
                           if entry else None)
                    if (entry and time.monotonic()-entry[1] <= 0.25
                            and key > last_key and frame_matches_odometry(entry[0], odom)):
                        # A stalled sensor must not assign a late frame to an
                        # already passed direction.
                        if abs(measured-next_view*math.pi/4) > 0.06:
                            raise SafeError('INSPECTION_CAMERA_BEARING_MISSED')
                        on_view(entry[0], state, odom, motion_at(state, odom, next_view*math.pi/4))
                        last_key = key
                        next_view += 1
                        segment_start_state, segment_start_odom = state, odom
                        segment_started, segment_measured = time.monotonic(), measured
                        motion_samples = []
                    elif measured > next_view*math.pi/4+0.06:
                        raise SafeError('CAMERA_UNAVAILABLE')
                if abs(remaining) <= 0.06:
                    if next_view != 8:
                        raise SafeError('INSPECTION_CAMERA_BEARING_MISSED')
                    return {'measured_radians':measured,
                            'return_motion':motion_at(state, odom, 2*math.pi),
                            'capture_sec':time.monotonic()-started}
                twist = Twist()
                # Cruise through the capture bearings; slow only for the
                # final return to the initial bearing.
                twist.angular.z = max(-0.55, min(0.55, 2.0*remaining))
                if self.inspection_cancel.is_set():
                    raise SafeError('ROBOT_STOPPED')
                self.velocity.publish(twist)
                time.sleep(0.05)
            raise SafeError('ROTATION_TIMEOUT')
        finally:
            self._zero_twist()

    def inspection_status_snapshot(self):
        with self.lock:
            # Results contain frame evidence; return a detached snapshot while
            # the worker advances. No polling request starts another scan.
            return json.loads(json.dumps(self.inspection_operation)) if self.inspection_operation else None

    def _update_inspection_progress(self, owner_token, **changes):
        with self.lock:
            operation = self.inspection_operation
            if operation and operation['inspection_id'] == owner_token:
                operation.update(changes, updated_at=time.time())

    def start_room_inspection(self, params):
        """Admit one finite scan, then return before the MCP's 60 s deadline."""
        if not self.perception:
            raise SafeError('PERCEPTION_NOT_CONFIGURED')
        if not self.inspection_lock.acquire(blocking=False):
            raise SafeError('INSPECTION_BUSY')
        owner_token = f"inspect-{uuid.uuid4().hex}"
        claimed = False
        try:
            with self.lock:
                unfinished = self.inspection_operation and not self.inspection_operation.get('terminal_known')
                navigating = self.navigation_operation is not None or any(
                    int(s.status) in (GoalStatus.STATUS_ACCEPTED, GoalStatus.STATUS_EXECUTING,
                                      GoalStatus.STATUS_CANCELING) for s in (self.goal_statuses or []))
            if unfinished:
                raise SafeError('INSPECTION_BUSY')
            if navigating:
                raise SafeError('NAVIGATION_NOT_IDLE')
            if not self._acquire_motion_lease('inspection', owner_token):
                raise SafeError('MOTION_CONTROL_BUSY')
            claimed = True
            state = self.get_state()
            expected = params.get('expected_pose', {})
            if (not all(isinstance(expected.get(k), (int, float)) and math.isfinite(expected[k]) for k in ('x', 'y'))
                    or math.hypot(state['position']['x'] - expected['x'],
                                  state['position']['y'] - expected['y']) > 0.20):
                raise SafeError('INSPECTION_POSE_CHANGED')
            if any(abs(float(state.get(k, 0))) > 0.02 for k in ('linear_velocity', 'angular_velocity')):
                raise SafeError('ROBOT_NOT_STATIONARY')
            with self.lock:
                self.active_inspection_owner = owner_token
                self.inspection_cancel.clear()
                self.inspection_operation = {
                    'inspection_id': owner_token, 'location': params['room'],
                    'status': 'PENDING', 'active': True, 'terminal_known': False,
                    'scan_views': 0, 'captured_views': 0, 'analyzed_views': 0,
                    'phase': 'CAPTURING', 'required_views': 8, 'rotation_complete': False,
                    'started_at': time.time(), 'updated_at': time.time(),
                    'poll_via': 'get_robot_state', 'result': None,
                }
            def run():
                try:
                    result = self.room_inspection(params, owner_token=owner_token)
                except Exception as error:
                    # The synchronous body always stops/releases in finally.
                    result = {'status': 'FAILED', 'room': params['room'], 'inspected': False,
                              'reason': error.code if isinstance(error, SafeError) else 'INSPECTION_FAILED',
                              'complete_visibility_claimed': False, 'rotation_complete': False}
                self._update_inspection_progress(
                    owner_token, status=result['status'], active=False, terminal_known=True,
                    scan_views=result.get('scan_views', 0),
                    rotation_complete=result.get('rotation_complete', False),
                    phase='COMPLETE' if result['status'] == 'SUCCEEDED' else 'STOPPED', result=result)
            self.inspection_thread = threading.Thread(target=run, name=owner_token, daemon=True)
            self.inspection_thread.start()
            return {'status': 'PENDING', 'accepted': True, 'room': params['room'],
                    'inspection_id': owner_token, 'terminal_known': False,
                    'poll_via': 'get_robot_state', 'required_views': 8}
        except Exception:
            if claimed:
                with self.lock:
                    if self.active_inspection_owner == owner_token:
                        self.active_inspection_owner = None
                        self.inspection_operation = None
                self._release_motion_lease(owner_token)
            self.inspection_lock.release()
            raise

    def room_inspection(self, params, owner_token=None):
        if owner_token is None:
            if not self.perception:
                raise SafeError('PERCEPTION_NOT_CONFIGURED')
            if not self.inspection_lock.acquire(blocking=False):
                raise SafeError('INSPECTION_BUSY')
            owner_token = f"inspect-{uuid.uuid4().hex}"
            if not self._acquire_motion_lease('inspection', owner_token):
                self.inspection_lock.release()
                raise SafeError('MOTION_CONTROL_BUSY')
            with self.lock:
                self.active_inspection_owner = owner_token
                self.inspection_cancel.clear()
        samples=[]
        captures=[]
        detections=[]
        started = time.monotonic()
        rotation_complete = False
        measured_radians, max_odom_drift = 0.0, 0.0
        inference = ThreadPoolExecutor(max_workers=1, thread_name_prefix='scan-perception')
        capture_sec, perception_drain_sec = 0.0, 0.0

        def collect_completed():
            # Preserve camera order even when callers inspect progress while
            # the base rotates. This does not wait for a running inference.
            while len(samples) < len(captures):
                capture = captures[len(samples)]
                future = capture['future']
                if not future.done():
                    break
                found = future.result()
                sample = {k:v for k,v in capture['evidence'].items()}
                sample.update(perception_status='AVAILABLE', detections=found)
                samples.append(sample)
                self._update_inspection_progress(owner_token, scan_views=len(samples),
                                                 analyzed_views=len(samples))
                for d in found:
                    same=next((v for v in detections if v['label']==d['label'] and
                        abs(math.atan2(math.sin(v['view_bearing']-d['view_bearing']),
                                       math.cos(v['view_bearing']-d['view_bearing'])))<0.4), None)
                    if same is None:
                        detections.append(d)
                    elif d['confidence']>same['confidence']:
                        detections[detections.index(same)]=d

        def check_scan():
            nonlocal max_odom_drift
            if self.inspection_cancel.is_set():
                raise SafeError('ROBOT_STOPPED')
            if time.monotonic() - started > 240:
                raise SafeError('INSPECTION_TIMEOUT')
            with self.lock:
                if self.active_inspection_owner != owner_token:
                    raise SafeError('MOTION_OWNERSHIP_LOST')
            current_odom = self.continuous_odometry()
            drift = math.hypot(current_odom['x']-initial_odom['x'], current_odom['y']-initial_odom['y'])
            max_odom_drift = max(max_odom_drift, drift)
            if drift > 0.20:
                raise SafeError('ROTATION_XY_DRIFT')
            collect_completed()

        def capture_view(msg, state, odom, motion):
            frame_png = png_bytes(msg)
            if os.environ.get('PHASE10_CAPTURE_SCAN') == '1':
                from pathlib import Path
                directory=Path('/data-ssd/zhongchengkai/agnes/artifacts/phase10/scan-frames')
                directory.mkdir(exist_ok=True)
                (directory / f'{msg.header.stamp.sec}-{msg.header.stamp.nanosec}.png').write_bytes(frame_png)
            captures.append({
                'future':inference.submit(self.detect_frame, msg, state),
                'evidence':{
                    'yaw':state['yaw'], 'odom_yaw':odom['yaw'],
                    'timestamp':{'sec':msg.header.stamp.sec,'nanosec':msg.header.stamp.nanosec},
                    'frame_sha256':hashlib.sha256(frame_png).hexdigest(),
                    'navigation_status':'ROTATION_ONLY_SUCCEEDED', 'motion':motion},
            })
            self._update_inspection_progress(owner_token, captured_views=len(captures))

        try:
            initial=self.get_state()
            initial_odom=self.continuous_odometry()
            circle = self.capture_scan_circle(initial, initial_odom, owner_token, capture_view, check_scan)
            capture_sec = circle['capture_sec']
            measured_radians = circle['measured_radians']
            return_motion = circle['return_motion']
            rotation_complete = (return_motion['status'] == 'SUCCEEDED' and
                                 abs(measured_radians-2*math.pi) <= 0.12)
            if not rotation_complete:
                raise SafeError('INSPECTION_NAVIGATION_FAILED')
            self._update_inspection_progress(owner_token, phase='ANALYZING',
                                             rotation_complete=rotation_complete)
            drain_started = time.monotonic()
            while len(samples) < len(captures):
                check_scan()
                if len(samples) < len(captures):
                    time.sleep(0.05)
            perception_drain_sec = time.monotonic()-drain_started
            check_scan()
            if params.get('region_type', 'room') == 'room':
                self.inspection_events.publish(String(data=json.dumps({'room':params['room'],'status':'SUCCEEDED','scan_views':len(samples),'timestamp':samples[-1]['timestamp']})))
            return {'status':'SUCCEEDED','room':params['room'],'inspected':True,'detections':detections,
                    'hazards':[d for d in detections if d['label']=='hazard_marker'],
                    'confidence':min((d['confidence'] for d in detections),default=None),
                    'observations':[],'object_observations':[{'object_id':d['id'],'location':params['room'],
                        'labels':[{'name':d['label'],'confidence':d['confidence']}]} for d in detections],
                    'evidence':samples,'scan_views':len(samples),'complete_visibility_claimed':False,
                    'rotation_complete':rotation_complete,
                    'rotation_evidence':{'control_frame':'odom','start_yaw':initial_odom['yaw'],
                        'end_yaw':self.continuous_odometry()['yaw'],'measured_radians':measured_radians,
                        'max_xy_drift_m':max_odom_drift,'requested_radians':2*math.pi},
                    'return_motion':{k:v for k,v in return_motion.items() if k!='samples'},
                    'timing':{'capture_sec':capture_sec, 'perception_drain_sec':perception_drain_sec,
                              'total_sec':time.monotonic()-started},
                    'inspection_id':owner_token}
        except Exception as error:
            status = 'PARTIAL' if isinstance(error, SafeError) else 'FAILED'
            reason = error.code if isinstance(error, SafeError) else 'INSPECTION_FAILED'
            if params.get('region_type', 'room') == 'room':
                self.inspection_events.publish(String(data=json.dumps({
                    'room': params['room'], 'status': status,
                    'scan_views': len(samples), 'reason': reason,
                    'timestamp': time.time()})))
            return {'status': status, 'room': params['room'], 'inspected': False,
                    'detections': detections, 'evidence': samples,
                    'scan_views': len(samples), 'completed_views': len(samples),
                    'reason': reason, 'complete_visibility_claimed': False,
                    'rotation_complete':False,'inspection_id':owner_token}
        finally:
            # Pending images cannot trigger motion. Cancel queued inference,
            # then retain the motion lease until the active worker returns,
            # matching the existing stop/ownership semantics.
            inference.shutdown(wait=True, cancel_futures=True)
            try:
                self._zero_twist()
            finally:
                with self.lock:
                    if self.active_inspection_owner == owner_token:
                        self.active_inspection_owner = None
                self._release_motion_lease(owner_token)
                self.inspection_lock.release()

    def object_inspection(self, params):
        ref=params.get('object_id')
        with self.lock:
            obj=self.visual_objects.get(ref)
            if obj is None:
                candidates=[v for v in self.visual_objects.values() if v['label']==ref]
                if candidates:obj=candidates[-1]
        if obj is None:raise SafeError('INVALID_OBJECT')
        if not self.perception:raise SafeError('PERCEPTION_NOT_CONFIGURED')
        if not self.inspection_lock.acquire(blocking=False):raise SafeError('INSPECTION_BUSY')
        owner_token = f"inspect-{uuid.uuid4().hex}"
        if not self._acquire_motion_lease('inspection', owner_token):
            self.inspection_lock.release()
            raise SafeError('MOTION_CONTROL_BUSY')
        with self.lock:
            self.active_inspection_owner = owner_token
            self.inspection_cancel.clear()
        found=[]
        evidence=[]
        try:
            state=self.get_state()
            if math.hypot(state['position']['x']-obj['view_pose']['x'],state['position']['y']-obj['view_pose']['y'])>0.5:
                raise SafeError('OBJECT_NOT_IN_CURRENT_VIEW_REGION')
            for offset in [0,-0.12,0.12]:
                motion=self.rotate_in_place(obj['view_bearing']+offset, owner_token=owner_token)
                if motion['status']!='SUCCEEDED':raise SafeError('INSPECTION_NAVIGATION_FAILED')
                old=self.fresh_frame()
                msg=self.fresh_frame((old.header.stamp.sec,old.header.stamp.nanosec))
                detections=self.detect_frame(msg,self.get_state())
                matches=[d for d in detections if d['label']==obj['label']]
                if matches:found.append(max(matches,key=lambda d:d['confidence']))
                evidence.append({'detections':matches,'yaw':self.get_state()['yaw'],
                                 'frame_timestamp':{'sec':msg.header.stamp.sec,'nanosec':msg.header.stamp.nanosec},
                                 'motion':motion})
            confidence=sum(d['confidence'] for d in found)/len(found) if found else 0.0
            uncertain=len(found)<2 or confidence<0.8
            return {'status':'SUCCEEDED','object_id':obj['id'],'labels':[{'name':obj['label'],'confidence':confidence}],
                    'before_confidence':obj['confidence'],'after_confidence':confidence,
                    'still_uncertain':uncertain,'target_verified':not uncertain,
                    'reason':'LOW_CONFIDENCE_OR_INSUFFICIENT_VIEWS' if uncertain else 'MULTIVIEW_TARGET_VERIFIED',
                    'detection_count':len(found),'detections':found,'evidence':evidence,
                    'confidence_method':'mean_of_actual_frame_confidences_not_calibrated_probability'}
        except SafeError as error:
            return {'status': 'PARTIAL', 'object_id': obj['id'], 'labels': [],
                    'detections': found, 'evidence': evidence,
                    'completed_views': len(evidence), 'reason': error.code,
                    'still_uncertain': True}
        finally:
            with self.lock:
                if self.active_inspection_owner == owner_token:
                    self.active_inspection_owner = None
            self._release_motion_lease(owner_token)
            self.inspection_lock.release()

    def capture_frame(self, params):
        name=params.get('name')
        if name not in ['camera-frame-room-a.png','camera-frame-room-b.png','camera-poor-view.png','camera-frame-door-inspect.png']:
            raise SafeError('INVALID_CAPTURE_NAME')
        msg=self.fresh_frame()
        from pathlib import Path
        path=Path('/data-ssd/zhongchengkai/agnes/artifacts/phase10')/name
        path.write_bytes(png_bytes(msg))
        return {'source':'/camera/image_raw','timestamp':{'sec':msg.header.stamp.sec,'nanosec':msg.header.stamp.nanosec}}

    def on_odom(self, msg):
        q = msg.pose.pose.orientation
        yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y*q.y + q.z*q.z))
        x,y=msg.pose.pose.position.x,msg.pose.pose.position.y
        rotation=self.map_odom_yaw
        odom_yaw=yaw
        map_x,map_y,yaw=project_odometry(x,y,odom_yaw,self.map_odom_x,self.map_odom_y,rotation)
        if os.environ.get('SCENARIO_LOCALIZATION') == 'amcl':
            try:
                # AMCL future-dates map->odom for Nav2. Compose with the
                # odometry sample at the same ROS time, not a newer transform.
                transform = self.tf_buffer.lookup_transform('map', 'odom', Time.from_msg(msg.header.stamp))
                t,qm = transform.transform.translation,transform.transform.rotation
                rotation = math.atan2(2*(qm.w*qm.z+qm.x*qm.y),1-2*(qm.y*qm.y+qm.z*qm.z))
                x,y = msg.pose.pose.position.x,msg.pose.pose.position.y
                map_x,map_y,yaw = project_odometry(x,y,odom_yaw,t.x,t.y,rotation)
            except Exception:
                # No initialized localization means no ready robot state.
                return
        with self.lock:
            self.local_odometry = {'x':msg.pose.pose.position.x,'y':msg.pose.pose.position.y,
                                   'yaw':odom_yaw,'frame_id':'odom',
                                   'timestamp':{'sec':msg.header.stamp.sec,'nanosec':msg.header.stamp.nanosec}}
            self.state = {
                'current_location': 'ros2_pose',
                'pose': {'location': 'ros2_pose', 'x': map_x,
                         'y': map_y, 'heading': yaw, 'frame_id': 'map'},
                'position': {'x': map_x, 'y': map_y},
                'yaw': yaw, 'linear_velocity': msg.twist.twist.linear.x,
                'angular_velocity': msg.twist.twist.angular.z,
                'timestamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec},
            }
            self.odom_received_monotonic = time.monotonic()
        self.odom_ready.set()

    def get_state(self):
        if not self.odom_ready.wait(5):
            raise SafeError('ROS2_ODOM_UNAVAILABLE')
        with self.lock:
            return {**self.state, 'navigation_status': self.navigation_status,
                    'stopped': self.navigation_status in ('CANCELED', 'STOPPED')}

    def navigation_status_snapshot(self):
        with self.lock:
            operation = dict(self.navigation_operation) if self.navigation_operation else None
            statuses = [int(s.status) for s in (self.goal_statuses or [])]
            inspection_active = self.active_inspection_owner is not None
        return {'status': self.navigation_status, 'active': operation is not None,
                'operation': operation, 'goal_statuses': statuses,
                'motion_owner': self._motion_owner_snapshot(),
                'inspection_active': inspection_active,
                'inspection': self.inspection_status_snapshot(),
                'last_terminal': dict(self.last_terminal_operation) if self.last_terminal_operation else None,
                'terminal_known': bool(self.navigation_terminal_known),
                'timestamp': time.time()}

    @staticmethod
    def _stamp_age(entry):
        return None if entry is None else max(0.0, time.monotonic() - entry[1])

    def _lifecycle_state(self, node_name):
        client = self.create_client(GetState, f'/{node_name}/get_state', callback_group=self.group)
        try:
            if not client.wait_for_service(timeout_sec=1.0):
                return {'state': 'UNAVAILABLE', 'service': f'/{node_name}/get_state'}
            response = await_future(client.call_async(GetState.Request()), 2)
            label = getattr(response.current_state, 'label', 'UNKNOWN')
            return {'state': label.upper(), 'id': int(response.current_state.id), 'service': f'/{node_name}/get_state'}
        except Exception as error:
            return {'state': 'ERROR', 'error': type(error).__name__, 'service': f'/{node_name}/get_state'}
        finally:
            self.destroy_client(client)

    def _tf_probe(self):
        result = {}
        for target, source in [('map', 'odom'), ('odom', 'base_link'), ('map', 'base_link')]:
            key = f'{target}->{source}'
            try:
                ok = self.tf_buffer.can_transform(target, source, Time(), timeout=Duration(seconds=0.8))
                if not ok:
                    result[key] = {'available': False, 'reason': 'TF_UNAVAILABLE'}
                    continue
                transform = self.tf_buffer.lookup_transform(target, source, Time())
                result[key] = {'available': True, 'frame_id': transform.header.frame_id,
                               'child_frame_id': transform.child_frame_id,
                               'stamp': {'sec': transform.header.stamp.sec, 'nanosec': transform.header.stamp.nanosec}}
            except Exception as error:
                result[key] = {'available': False, 'reason': type(error).__name__}
        return result

    def _pose_in_map(self, pose):
        grid = self.map or self.costmap
        if grid is None or not pose:
            return {'available': False, 'inside': False, 'reason': 'MAP_UNAVAILABLE'}
        origin = grid.info.origin.position
        x, y = float(pose['x']), float(pose['y'])
        inside = (origin.x <= x < origin.x + grid.info.width * grid.info.resolution and
                  origin.y <= y < origin.y + grid.info.height * grid.info.resolution)
        occupancy = None
        if inside and getattr(grid, 'data', None):
            ix = int((x - origin.x) / grid.info.resolution)
            iy = int((y - origin.y) / grid.info.resolution)
            occupancy = int(grid.data[iy * grid.info.width + ix])
        return {'available': True, 'inside': inside, 'occupancy': occupancy,
                'frame_id': getattr(grid.header, 'frame_id', None)}

    def _zero_twist(self):
        for _ in range(3):
            self.velocity.publish(Twist())
            time.sleep(0.05)

    def preflight(self):
        """Read-only real ROS/Nav2 health probe plus a safe zero-velocity pulse."""
        # Reuse the bounded camera reader recovery for navigation health too.
        # A stale subscriber is not evidence of a failed camera device.
        try:
            self.fresh_frame()
        except SafeError:
            pass
        deadline = time.monotonic() + 4.0
        while time.monotonic() < deadline:
            with self.lock:
                sensors = dict(self.sensors)
                state = dict(self.state) if self.state else None
                statuses = list(self.goal_statuses or [])
            if state and sensors.get('lidar') and sensors.get('camera') and self.map is not None:
                break
            time.sleep(0.1)
        with self.lock:
            sensors = dict(self.sensors)
            state = dict(self.state) if self.state else None
            statuses = list(self.goal_statuses or [])
        now = time.monotonic()
        sensor = {}
        for name in ('lidar', 'camera'):
            entry = sensors.get(name)
            age = None if entry is None else max(0.0, now - entry[1])
            sensor[name] = {'available': entry is not None and age is not None and age <= 2.0,
                            'age_sec': age,
                            'frame_timestamp': ({'sec': entry[0].header.stamp.sec, 'nanosec': entry[0].header.stamp.nanosec}
                                                if entry is not None else None)}
        lifecycle = {name: self._lifecycle_state(name) for name in
                     ('map_server', 'planner_server', 'controller_server', 'behavior_server', 'bt_navigator')}
        active_goals = [int(s.status) for s in statuses if int(s.status) in
                        (GoalStatus.STATUS_ACCEPTED, GoalStatus.STATUS_EXECUTING, GoalStatus.STATUS_CANCELING)]
        action_available = bool(self.client.wait_for_server(timeout_sec=1.5))
        tf = self._tf_probe()
        pose = state.get('position') if state else None
        zero = self._zero_twist()
        healthy_lifecycle = all(v.get('state') == 'ACTIVE' for v in lifecycle.values())
        healthy_tf = all(v.get('available') for v in tf.values())
        pose_map = self._pose_in_map(pose)
        result = {
            'timestamp': time.time(), 'bridge_ready': True, 'navigate_action_server': action_available,
            'lifecycle': lifecycle, 'lifecycle_active': healthy_lifecycle,
            'tf': tf, 'tf_map_odom_base_link': healthy_tf,
            'odom': {'fresh': bool(state), 'age_sec': 0.0 if state else None, 'pose': state},
            'sensors': sensor, 'camera_fresh': sensor['camera']['available'], 'lidar_fresh': sensor['lidar']['available'],
            'stale_active_goals': active_goals, 'no_stale_goal': not active_goals,
            'cmd_vel_zeroed': True, 'pose_in_map': pose_map,
            'costmap_services': {
                'local': self.service_available('/local_costmap/clear_entirely_local_costmap'),
                'global': self.service_available('/global_costmap/clear_entirely_global_costmap')},
        }
        result['clear_costmaps_reachable'] = all(result['costmap_services'].values())
        result['pass'] = all((action_available, healthy_lifecycle, healthy_tf, sensor['camera']['available'],
                              sensor['lidar']['available'], not active_goals, pose_map.get('inside', False),
                              result['clear_costmaps_reachable']))
        result['failure_reasons'] = []
        checks = [('navigate_action_server', action_available), ('lifecycle_active', healthy_lifecycle),
                  ('tf_map_odom_base_link', healthy_tf), ('camera_fresh', sensor['camera']['available']),
                  ('lidar_fresh', sensor['lidar']['available']), ('no_stale_goal', not active_goals),
                  ('pose_in_map', pose_map.get('inside', False)), ('clear_costmaps_reachable', result['clear_costmaps_reachable'])]
        result['failure_reasons'] = [name for name, ok in checks if not ok]
        return result

    def service_available(self, name):
        client = self.create_client(ClearEntireCostmap, name, callback_group=self.group)
        try:
            return bool(client.wait_for_service(timeout_sec=0.6))
        finally:
            self.destroy_client(client)

    def recover_navigation(self):
        recovery_owner = f"recovery-{uuid.uuid4().hex}"
        if not self._acquire_motion_lease('recovery', recovery_owner):
            return {'timestamp': time.time(), 'actions': [], 'pass': False,
                    'reason': 'MOTION_CONTROL_BUSY',
                    'owner': self._external_motion_owner() or self._motion_owner_snapshot()}
        actions = []
        try:
            clients = [('navigate_to_pose', self.cancel_client)]
            if getattr(self, 'doorway_cancel_client', None) is not None:
                clients.append(('navigate_through_poses', self.doorway_cancel_client))
            for action_name, client in clients:
                if client.wait_for_service(timeout_sec=1.0):
                    try:
                        response = await_future(client.call_async(CancelGoal.Request()), 3)
                        actions.append({'action': 'cancel_stale_goals', 'action_name': action_name,
                                        'ok': True, 'goals_canceling': len(response.goals_canceling)})
                    except Exception as error:
                        actions.append({'action': 'cancel_stale_goals', 'action_name': action_name,
                                        'ok': False, 'error': type(error).__name__})
                else:
                    actions.append({'action': 'cancel_stale_goals', 'action_name': action_name,
                                    'ok': False, 'error': 'SERVICE_UNAVAILABLE'})
            self._zero_twist()
            actions.append({'action': 'zero_twist', 'ok': True})
            for name in ('/local_costmap/clear_entirely_local_costmap', '/global_costmap/clear_entirely_global_costmap'):
                client = self.create_client(ClearEntireCostmap, name, callback_group=self.group)
                try:
                    if not client.wait_for_service(timeout_sec=1.0):
                        actions.append({'action': 'clear_costmap', 'service': name, 'ok': False, 'error': 'SERVICE_UNAVAILABLE'})
                        continue
                    await_future(client.call_async(ClearEntireCostmap.Request()), 5)
                    actions.append({'action': 'clear_costmap', 'service': name, 'ok': True})
                except Exception as error:
                    actions.append({'action': 'clear_costmap', 'service': name, 'ok': False, 'error': type(error).__name__})
                finally:
                    self.destroy_client(client)
            health = self.preflight()
            return {'timestamp': time.time(), 'actions': actions, 'health': health, 'pass': health.get('pass', False)}
        finally:
            self._release_motion_lease(recovery_owner)

    def navigate(self, params):
        pose = params.get('pose', {})
        if not isinstance(pose, dict) or not all(isinstance(pose.get(k), (int, float))
                                                  and math.isfinite(pose[k]) for k in ('x', 'y')):
            raise SafeError('INVALID_POSE')
        if not self.navigation_lock.acquire(blocking=False):
            owner = self._operation_snapshot() or {}
            return {'accepted': False, 'status': 'FAILED', 'target': params.get('target'),
                    'reason': 'GOAL_BUSY', 'code': 'ROS2_GOAL_BUSY',
                    'operation_id': owner.get('operation_id'), 'goal_id': owner.get('goal_id'),
                    'owner_status': owner.get('state', 'UNKNOWN'),
                    'terminal_known': owner.get('terminal_known', False)}
        handle = None
        operation = {'operation_id': f"nav-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}",
                     'target': params.get('target'), 'state': 'REQUESTED',
                     'requested_at': time.time(), 'terminal_known': False}
        with self.lock:
            self.navigation_operation = operation
            self.navigation_lock_held = True
            self.navigation_terminal_known = False
        if not self._acquire_motion_lease('navigation', operation['operation_id']):
            with self.lock:
                self.navigation_operation = None
                self.navigation_lock_held = False
                # The request was rejected before a ROS goal existed.  Do
                # not leave the previous terminal looking unresolved merely
                # because this rejected contender briefly opened a record.
                self.navigation_terminal_known = True
            self.navigation_lock.release()
            owner = self._motion_owner_snapshot() or {}
            return {'accepted': False, 'status': 'FAILED', 'target': params.get('target'),
                    'reason': 'MOTION_CONTROL_BUSY', 'code': 'MOTION_CONTROL_BUSY',
                    'owner_kind': owner.get('kind'), 'owner_operation_id': owner.get('operation_id'),
                    'terminal_known': False}
        motion_lease_held = True
        deferred_release = False
        try:
            with self.lock:
                stale = [int(s.status) for s in (self.goal_statuses or []) if int(s.status) in
                          (GoalStatus.STATUS_ACCEPTED, GoalStatus.STATUS_EXECUTING, GoalStatus.STATUS_CANCELING)]
            if stale:
                raise SafeError('NAVIGATION_SYSTEM_UNHEALTHY')
            route = [{'pose': pose, 'stage': 'target', 'door_id': None}]
            if getattr(self, 'doorway_geometry', None) and getattr(self, 'doorway_registry', None):
                try:
                    route = plan_doorway_route(self.doorway_geometry, self.doorway_registry,
                        self.get_state()['pose'], params.get('target'), pose)
                except DoorwayRouteError as error:
                    raise SafeError(error.code)
            through = len(route) > 1
            client = self.doorway_client if through else self.client
            if not client.wait_for_server(timeout_sec=5):
                raise SafeError('NAV2_NOT_AVAILABLE')
            goal = NavigateThroughPoses.Goal() if through else NavigateToPose.Goal()
            if through:
                from pathlib import Path
                # Nav2 caches trees by filename. A content-addressed copy also
                # applies a safe BT update without restarting localization.
                import hashlib
                root = Path(__file__).resolve().parents[3]
                tree = (root / 'simulation/final_rescue/doorway_navigation.xml').read_bytes()
                tree_path = root / 'runtime/navigation' / ('doorway-' + hashlib.sha256(tree).hexdigest()[:16] + '.xml')
                tree_path.parent.mkdir(parents=True, exist_ok=True)
                if not tree_path.exists():
                    tree_path.write_bytes(tree)
                goal.behavior_tree = str(tree_path)
                goal.poses = []
                for stage in route:
                    point = stage['pose']
                    stamped = PoseStamped()
                    stamped.header.frame_id = point.get('frame_id', 'map')
                    stamped.header.stamp = self.get_clock().now().to_msg()
                    stamped.pose.position.x, stamped.pose.position.y = float(point['x']), float(point['y'])
                    stamped.pose.orientation.z = math.sin(float(point.get('yaw', 0))/2)
                    stamped.pose.orientation.w = math.cos(float(point.get('yaw', 0))/2)
                    goal.poses.append(stamped)
                operation.update({'action_name': 'navigate_through_poses', 'doorway_route': route})
                self.audit_navigation('doorway_route_planned', {'operation_id': operation['operation_id'],
                    'target': params.get('target'), 'waypoints': route, 'source': 'static_door_geometry'})
            else:
                operation['action_name'] = 'navigate_to_pose'
            if self.monitor_lotus_path:
                self.owned_path = None
                self.path_baseline = self.costmap
                self.obstacle_baseline = self.obstacle_raw
                self.path_conflict = None
                self.navigation_target = params.get('target')
                self.audit_navigation('new_plan_requested', {'target': params.get('target'), 'pose': pose})
            if not through:
                goal.pose.header.frame_id = pose.get('frame_id', 'map')
                goal.pose.header.stamp = self.get_clock().now().to_msg()
                goal.pose.pose.position.x = float(pose['x'])
                goal.pose.pose.position.y = float(pose['y'])
                yaw = float(pose.get('yaw', 0))
                goal.pose.pose.orientation.z = math.sin(yaw/2)
                goal.pose.pose.orientation.w = math.cos(yaw/2)
            feedback_samples = []
            def on_feedback(message):
                feedback = message.feedback
                sample = {'distance_remaining': float(feedback.distance_remaining),
                          'number_of_recoveries': int(feedback.number_of_recoveries)}
                if hasattr(feedback, 'number_of_poses_remaining'):
                    sample['number_of_poses_remaining'] = int(feedback.number_of_poses_remaining)
                feedback_samples.append(sample)
                if len(feedback_samples) > 100:
                    del feedback_samples[0]
            handle = await_future(client.send_goal_async(goal, feedback_callback=on_feedback), 5)
            goal_id = bytes(handle.goal_id.uuid).hex()
            operation.update({'goal_id': goal_id, 'accepted_at': time.time()})
            if not handle.accepted:
                operation.update({'state': 'REJECTED', 'terminal_at': time.time(),
                                  'terminal_status': 'REJECTED', 'terminal_known': True})
                self.last_terminal_operation = dict(operation)
                self.navigation_terminal_known = True
                return {'accepted': False, 'status': 'FAILED', 'target': params.get('target'),
                        'goal_id': goal_id, 'reason': 'UNREACHABLE', 'action_status': 'REJECTED',
                        'operation_id': operation['operation_id'], 'terminal_known': True}
            future = handle.get_result_async()
            with self.lock:
                self.active_goal, self.result_future = handle, future
                self.navigation_status = 'EXECUTING'
                operation.update({'state': 'EXECUTING'})
            self.audit_navigation('navigation_accepted', {
                'operation_id': operation['operation_id'], 'goal_id': goal_id,
                'target': params.get('target'), 'accepted_at': operation['accepted_at']})
            try:
                requested_timeout = float(params.get('timeout_sec', NAVIGATION_TIMEOUT_DEFAULT))
                if not math.isfinite(requested_timeout):
                    raise SafeError('INVALID_TIMEOUT')
                action_timeout = max(10.0, min(requested_timeout, NAVIGATION_TIMEOUT_MAX))
                result = await_future(future, action_timeout)
            except SafeError as error:
                if error.code != 'ROS2_TIMEOUT':
                    raise
                # Cancel the exact goal, then keep ownership until the late
                # Nav2 result arrives.  Returning a bounded TIMEOUT to MCP is
                # safe only because the lock remains held by this operation.
                cancel_accepted = False
                try:
                    cancel = await_future(handle.cancel_goal_async(), 3)
                    cancel_accepted = bool(cancel and cancel.goals_canceling)
                except SafeError:
                    cancel_accepted = False
                self.velocity.publish(Twist())
                blocked=self.blocked_evidence(pose)
                operation.update({'state': 'CANCELING' if cancel_accepted else 'UNKNOWN',
                                  'timeout_at': time.time(),
                                  'cancel_requested_at': time.time(),
                                  'cancel_source': 'bridge_action_budget',
                                  'terminal_known': False})
                future.add_done_callback(lambda done, op=dict(operation):
                                          self._finish_detached_operation(op, done))
                deferred_release = True
                output = {'accepted': True, 'status': 'FAILED', 'target': params.get('target'),
                          'goal_id': goal_id, 'operation_id': operation['operation_id'],
                          'reason': 'TIMEOUT',
                          'action_status': 'CANCELING' if cancel_accepted else 'UNKNOWN',
                          'terminal_known': False,
                          'timeout_source': 'bridge_action_budget'}
                if blocked:
                    output.update({'reason': 'PATH_BLOCKED', 'evidence': blocked,
                                   'blocked_route': params.get('target')})
                self.audit_navigation('navigation_timeout', output)
                return output
            succeeded = result.status == GoalStatus.STATUS_SUCCEEDED
            canceled = result.status == GoalStatus.STATUS_CANCELED
            action_status = 'SUCCEEDED' if succeeded else 'CANCELED' if canceled else 'ABORTED'
            nav_error_code = int(getattr(result.result, 'error_code', 0))
            nav_error_msg = str(getattr(result.result, 'error_msg', ''))
            nav_details = nav2_result_details(action_status, nav_error_code, nav_error_msg)
            with self.lock:
                self.navigation_status = action_status
                self.navigation_terminal_known = True
                operation.update({'state': action_status, 'terminal_at': time.time(),
                                  'terminal_status': action_status, 'terminal_known': True,
                                  **nav_details})
                self.last_terminal_operation = dict(operation)
            output = {'accepted': True, 'status': 'SUCCEEDED' if succeeded else 'FAILED',
                      'target': params.get('target'), 'goal_id': goal_id,
                      'action_status': action_status,
                      'feedback': list(feedback_samples),
                      'operation_id': operation['operation_id'],
                      'terminal_known': True,
                      'result': {'error_code': nav_error_code, 'error_msg': nav_error_msg}, **nav_details}
            self.audit_navigation('navigation_terminal', {
                'operation_id': operation['operation_id'], 'goal_id': goal_id,
                'action_status': action_status, **nav_details,
                'terminal_known': True, 'late_terminal': False})
            if self.monitor_lotus_path and succeeded:
                self.audit_navigation('navigation_succeeded', {'target': params.get('target'),
                                      'goal_id': goal_id, 'action_status': action_status,
                                      'pose': self.get_state()['pose']})
            if self.monitor_lotus_path and self.path_conflict and not succeeded:
                output.update(reason='PATH_BLOCKED', blocked_route=params.get('target'),
                              evidence=self.path_conflict)
                self.audit_navigation('navigation_path_blocked', {'target': params.get('target'),
                                      'goal_id': goal_id, 'evidence': self.path_conflict})
                return output
            if not succeeded:
                output.update(nav_details)
                blocked=self.blocked_evidence(pose)
                if blocked:output.update(reason='PATH_BLOCKED',blocked_route=params.get('target'),evidence=blocked)
            return output
        finally:
            if not deferred_release:
                with self.lock:
                    if self.active_goal == handle:
                        self.active_goal = None
                        self.result_future = None
                    if self.navigation_operation and self.navigation_operation.get('operation_id') == operation['operation_id']:
                        self.navigation_operation = None
                    self.navigation_lock_held = False
                self.navigation_lock.release()
                if motion_lease_held:
                    self._release_motion_lease(operation['operation_id'])

    def _watch_motion_stops(self):
        while not self.motion_stop_shutdown.wait(0.1):
            try:
                self.motion_stop_mailbox.poll()
            except Exception:
                # Invalid or stale requests cannot stop a different operation.
                # Ordinary stop_robot remains independently available.
                pass

    def stop_owned_operation(self, expected_operation_id):
        """Stop only this exact owner; never race a replacement motion."""
        with self.motion_owner_guard:
            if not self.motion_owner or self.motion_owner.get('operation_id') != expected_operation_id:
                return {'status':'FAILED','stopped':False,'reason':'OWNER_CHANGED',
                        'terminal_known':False,'zero_twist_published':False}
            with self.lock:
                handle, future = self.active_goal, self.result_future
                operation = self.navigation_operation
                inspection_owner = self.active_inspection_owner
                is_inspection = inspection_owner == expected_operation_id
                is_navigation = operation and operation.get('operation_id') == expected_operation_id
                if not is_inspection and (not is_navigation or handle is None):
                    return {'status':'PENDING','stopped':False,'reason':'OWNER_NOT_READY',
                            'terminal_known':False,'zero_twist_published':False}
                if is_inspection:
                    self.inspection_cancel.set()
            # The lease guard prevents release/reacquisition until this exact
            # owner's stop is published. No later zero can touch a new owner.
            self.velocity.publish(Twist())
        if is_inspection:
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                with self.lock:
                    if self.active_inspection_owner != expected_operation_id:
                        return {'status':'STOPPED','stopped':True,'cancel_status':'CANCELED',
                                'terminal_known':True,'operation_id':expected_operation_id,
                                'zero_twist_published':True}
                time.sleep(.05)
            return {'status':'PENDING','stopped':False,'cancel_status':'ACCEPTED_PENDING',
                    'terminal_known':False,'operation_id':expected_operation_id,
                    'zero_twist_published':True}
        try:
            response = await_future(handle.cancel_goal_async(), 3)
            accepted = bool(response.goals_canceling)
            if accepted and future is not None:
                try:
                    result = await_future(future, 3)
                    canceled = result.status == GoalStatus.STATUS_CANCELED
                    return {'status':'STOPPED' if canceled else 'FAILED','stopped':canceled,
                            'cancel_status':'CANCELED' if canceled else 'NOT_CANCELED',
                            'terminal_known':True,'operation_id':expected_operation_id,
                            'zero_twist_published':True}
                except SafeError:
                    pass
            return {'status':'PENDING' if accepted else 'FAILED','stopped':False,
                    'cancel_status':'ACCEPTED_PENDING' if accepted else 'REJECTED',
                    'terminal_known':False,'operation_id':expected_operation_id,
                    'zero_twist_published':True}
        except SafeError:
            return {'status':'FAILED','stopped':False,'cancel_status':'TIMEOUT',
                    'terminal_known':False,'operation_id':expected_operation_id,
                    'zero_twist_published':True}

    def stop(self):
        with self.lock:
            handle, future = self.active_goal, self.result_future
            operation = dict(self.navigation_operation) if self.navigation_operation else None
            inspection_owner = self.active_inspection_owner
            if inspection_owner is not None:
                self.inspection_cancel.set()
        if handle is None and inspection_owner is None:
            external_owner = self._external_motion_owner()
            if external_owner is not None:
                return {'status': 'FAILED', 'stopped': False,
                        'cancel_status': 'REMOTE_OWNER', 'terminal_known': False,
                        'owner': external_owner, 'zero_twist_published': False}
        self.velocity.publish(Twist())
        cancel_status = 'NO_ACTIVE_GOAL'
        stopped = True
        terminal_known = handle is None
        if handle is not None:
            try:
                response = await_future(handle.cancel_goal_async(), 3)
                cancel_status = 'ACCEPTED' if response.goals_canceling else 'REJECTED'
                stopped = bool(response.goals_canceling)
                if stopped and future is not None:
                    try:
                        result = await_future(future, 3)
                        terminal_known = True
                        stopped = result.status == GoalStatus.STATUS_CANCELED
                        cancel_status = 'CANCELED' if stopped else 'NOT_CANCELED'
                    except SafeError:
                        # The cancel request was accepted, but Nav2 has not
                        # delivered its terminal result yet.  Do not claim
                        # that the action is fully stopped.
                        terminal_known = False
                        cancel_status = 'ACCEPTED_PENDING'
            except SafeError:
                cancel_status, stopped = 'TIMEOUT', False
        if inspection_owner is not None:
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                with self.lock:
                    still_scanning = self.active_inspection_owner == inspection_owner
                if not still_scanning:
                    break
                self.velocity.publish(Twist())
                time.sleep(0.05)
            with self.lock:
                still_scanning = self.active_inspection_owner == inspection_owner
            if still_scanning:
                cancel_status = 'ACCEPTED_PENDING'
                stopped = False
                terminal_known = False
            elif handle is None:
                cancel_status = 'CANCELED'
                stopped = True
                terminal_known = True
        # Let the real middleware transmit the zero Twist before returning.
        time.sleep(0.1)
        with self.lock:
            if stopped and terminal_known and handle is not None:
                self.navigation_status = 'STOPPED'
        return {'status': 'STOPPED' if stopped and terminal_known else 'FAILED',
                'stopped': stopped and terminal_known, 'cancel_status': cancel_status,
                'terminal_known': terminal_known, 'operation_id': operation.get('operation_id') if operation else None,
                'goal_id': operation.get('goal_id') if operation else None,
                'motion_owner': inspection_owner or (operation or {}).get('operation_id'),
                'zero_twist_published': True}


def main():
    rclpy.init()
    node = Bridge()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    spin = threading.Thread(target=executor.spin, daemon=True)
    spin.start()
    output_lock = threading.Lock()

    def send(value):
        with output_lock:
            print(json.dumps(value, allow_nan=False), flush=True)

    node.event_sink = send

    def process(request):
        ident = request.get('id')
        try:
            if not isinstance(ident, str) or not isinstance(request.get('params', {}), dict):
                raise SafeError('MALFORMED_REQUEST')
            method = request.get('method')
            if method == 'get_robot_state':
                result = node.get_state()
            elif method == 'get_observation':
                focus = request.get('params', {}).get('focus')
                if focus not in (None, 'door'):
                    raise SafeError('INVALID_PERCEPTION_FOCUS')
                result = node.observation(focus=focus)
            elif method == 'navigation_status':
                result = node.navigation_status_snapshot()
            elif method == 'inspect_room':
                params = request.get('params', {})
                result = node.start_room_inspection(params) if params.get('async') else node.room_inspection(params)
            elif method == 'inspect_object':
                result = node.object_inspection(request.get('params', {}))
            elif method == 'capture_frame':
                result = node.capture_frame(request.get('params', {}))
            elif method == 'navigate_to':
                result = node.navigate(request.get('params', {}))
            elif method == 'stop_robot':
                result = node.stop()
            elif method == 'preflight':
                result = node.preflight()
            elif method == 'recover_navigation':
                result = node.recover_navigation()
            elif method == 'ack_world_update':
                result = node.ack_world_update(request.get('params', {}))
            else:
                raise SafeError('UNKNOWN_METHOD')
            if os.environ.get('ROBOT_TRACE_DIR'):
                from pathlib import Path
                with (Path(os.environ['ROBOT_TRACE_DIR'])/'ros2-events.jsonl').open('a') as f:
                    f.write(json.dumps({'time':time.time(),'bridge_instance_id':node.bridge_instance_id,
                                        'request_id':ident,'method':method,
                                        'params':request.get('params',{}),'result':result})+'\n')
            send({'id': ident, 'ok': True, 'result': result})
        except Exception as error:
            send({'id': ident, 'ok': False, 'error': {
                'code': error.code if isinstance(error, SafeError) else 'ROS2_BRIDGE_ERROR',
                'message': 'ROS2 bridge request failed.',
            }})

    workers = ThreadPoolExecutor(max_workers=4)
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError()
                workers.submit(process, request)
            except (ValueError, json.JSONDecodeError):
                send({'id': None, 'ok': False, 'error': {
                    'code': 'MALFORMED_REQUEST', 'message': 'Request must be a JSON object.',
                }})
    finally:
        node.motion_stop_shutdown.set()
        node.motion_stop_thread.join(timeout=8)
        node.stop()
        workers.shutdown(wait=True)
        if node.inspection_thread:
            node.inspection_thread.join(timeout=120)
        if node.perception: node.perception.close()
        node.camera_stream.close()
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        spin.join(timeout=3)


if __name__ == '__main__':
    main()
