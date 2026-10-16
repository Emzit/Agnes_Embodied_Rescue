"""Read-only onboard evidence recorder. Does not read scenario truth."""
import json
import os
import time
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import LaserScan
from nav_msgs.msg import Odometry, Path as NavPath, OccupancyGrid
from nav2_msgs.msg import Costmap
from action_msgs.msg import GoalStatusArray
from geometry_msgs.msg import PoseWithCovarianceStamped
from tf2_msgs.msg import TFMessage
from rosidl_runtime_py.convert import message_to_ordereddict
from gz.transport13 import Node as GzNode
from gz.msgs10.pose_v_pb2 import Pose_V
from google.protobuf.json_format import MessageToDict
import threading

ROOT = Path('/data-ssd/zhongchengkai/agnes')
OUT = Path(os.environ['LOTUS_ONBOARD_OUT'])
OUT.relative_to(ROOT)
OUT.parent.mkdir(parents=True, exist_ok=True)


class Recorder(Node):
    def __init__(self):
        super().__init__('lotus_onboard_recorder')
        self.stream = OUT.open('a')
        self.output_lock = threading.Lock()
        self.last_physical_stamp = -1
        self.gz_node = GzNode()
        # Evaluator-only physical audit. Never forwarded to Agent or ROS.
        self.gz_node.subscribe(Pose_V, '/world/lotus_a_greybox/pose/info', self.physical_audit)
        self.gz_node.subscribe(Pose_V, '/model/runtime_event_carrier/pose', self.carrier_audit)
        self.subscriptions_kept = []
        for topic, typ, qos in [('/scan', LaserScan, qos_profile_sensor_data),
                                ('/odom', Odometry, 20), ('/plan', NavPath, 20),
                                ('/global_costmap/costmap', OccupancyGrid, 10),
                                ('/global_costmap/obstacle_layer_raw', Costmap, 10),
                                ('/compute_path_to_pose/_action/status', GoalStatusArray, 20),
                                ('/navigate_to_pose/_action/status', GoalStatusArray, 20)]:
            self.subscriptions_kept.append(self.create_subscription(
                typ, topic, lambda m, t=topic: self.record(t, m), qos))
        for topic,typ in [('/amcl_pose',PoseWithCovarianceStamped),('/tf',TFMessage)]:
            self.subscriptions_kept.append(self.create_subscription(
                typ, topic, lambda m,t=topic: self.record(t,m), 20))

    def record(self, topic, msg):
        row = {'wall_time': time.time(), 'topic': topic,
               'message': message_to_ordereddict(msg)}
        self.write(row)

    def write(self, row):
        with self.output_lock:
            self.stream.write(json.dumps(row, allow_nan=True) + '\n')
            self.stream.flush()

    def physical_audit(self, msg):
        sim = msg.header.stamp.sec + msg.header.stamp.nsec / 1e9
        if sim - self.last_physical_stamp < .04:
            return
        self.last_physical_stamp = sim
        poses = [MessageToDict(p, preserving_proto_field_name=True) for p in msg.pose
                 if p.name == 'imported_rescue_robot']
        if poses:
            self.write({'wall_time': time.time(), 'topic': 'evaluator_only_gazebo_robot_pose',
                        'message': {'stamp': MessageToDict(msg.header.stamp), 'poses': poses},
                        'agent_visible': False})

    def carrier_audit(self, msg):
        self.write({'wall_time':time.time(),'topic':'evaluator_only_gazebo_carrier_pose',
                    'message':MessageToDict(msg,preserving_proto_field_name=True),
                    'agent_visible':False})


rclpy.init()
node = Recorder()
try:
    rclpy.spin(node)
except KeyboardInterrupt:
    pass
finally:
    node.stream.close()
    node.destroy_node()
    rclpy.try_shutdown()
