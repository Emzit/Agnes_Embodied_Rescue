"""Read-only evidence collector: graph, lifecycle, TF, path, command and odometry."""
import json
import os
import sys
import threading
import time
os.environ['RCUTILS_LOGGING_USE_STDOUT'] = '0'
import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.action import get_action_names_and_types, get_action_server_names_and_types_by_node
from rclpy.time import Time
from lifecycle_msgs.srv import GetState
from tf2_ros import Buffer, TransformListener
from nav_msgs.msg import Odometry, Path
from geometry_msgs.msg import Twist
from rosgraph_msgs.msg import Clock


def main():
    rclpy.init()
    node = Node('phase9d_observer', parameter_overrides=[Parameter('use_sim_time', value=True)])
    group = ReentrantCallbackGroup()
    lock = threading.Lock()
    stats = {'odom_count': 0, 'path_count': 0, 'nonzero_commands': 0, 'zero_commands': 0,
             'latest_odom': None, 'last_path_size': 0, 'max_path_size': 0,
             'clock_count': 0, 'clock_seconds': 0.0}
    def on_clock(msg):
        with lock:
            stats['clock_count'] += 1
            stats['clock_seconds'] = msg.clock.sec + msg.clock.nanosec / 1e9
    def on_odom(msg):
        with lock:
            stats['odom_count'] += 1
            stats['latest_odom'] = {'x': msg.pose.pose.position.x, 'y': msg.pose.pose.position.y,
                                    'linear_velocity': msg.twist.twist.linear.x,
                                    'angular_velocity': msg.twist.twist.angular.z}
    def on_plan(msg):
        with lock:
            stats['path_count'] += 1
            stats['last_path_size'] = len(msg.poses)
            stats['max_path_size'] = max(stats['max_path_size'], len(msg.poses))
    def on_cmd(msg):
        with lock:
            key = 'nonzero_commands' if abs(msg.linear.x) + abs(msg.angular.z) > 0.001 else 'zero_commands'
            stats[key] += 1
    node.create_subscription(Odometry, '/odom', on_odom, 100, callback_group=group)
    node.create_subscription(Path, '/plan', on_plan, 100, callback_group=group)
    node.create_subscription(Twist, '/cmd_vel', on_cmd, 100, callback_group=group)
    node.create_subscription(Clock, '/clock', on_clock, 100, callback_group=group)
    buffer = Buffer(node=node)
    listener = TransformListener(buffer, node)
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    spin = threading.Thread(target=executor.spin, daemon=True)
    spin.start()
    try:
        for line in sys.stdin:
            request = json.loads(line)
            try:
                method = request['method']
                if method == 'snapshot':
                    with lock:
                        result = dict(stats)
                elif method == 'graph':
                    result = {'nodes': node.get_node_names_and_namespaces(),
                              'topics': node.get_topic_names_and_types(),
                              'actions': get_action_names_and_types(node),
                              'nav2_action_servers': get_action_server_names_and_types_by_node(node, 'bt_navigator', '/'),
                              'plan_publishers': [p.node_name for p in node.get_publishers_info_by_topic('/plan')],
                              'cmd_vel_publishers': [p.node_name for p in node.get_publishers_info_by_topic('/cmd_vel')],
                              'odom_publishers': [p.node_name for p in node.get_publishers_info_by_topic('/odom')],
                              'clock_publishers': [p.node_name for p in node.get_publishers_info_by_topic('/clock')],
                              'tf_tree': buffer.all_frames_as_yaml()}
                    transforms = {}
                    for target, source in [('map', 'odom'), ('odom', 'base_link'), ('map', 'base_link')]:
                        transform = buffer.lookup_transform(target, source, Time())
                        transforms[f'{target}->{source}'] = {'x': transform.transform.translation.x,
                                                             'y': transform.transform.translation.y,
                                                             'frame_id': transform.header.frame_id,
                                                             'child_frame_id': transform.child_frame_id}
                    result['tf'] = transforms
                    result['map_to_base'] = {'x': transforms['map->base_link']['x'], 'y': transforms['map->base_link']['y']}
                elif method == 'lifecycle':
                    result = {}
                    for name in ['map_server', 'planner_server', 'controller_server', 'behavior_server', 'bt_navigator']:
                        client = node.create_client(GetState, '/' + name + '/get_state', callback_group=group)
                        try:
                            if not client.wait_for_service(timeout_sec=1):
                                result[name] = 'UNAVAILABLE'
                                continue
                            future = client.call_async(GetState.Request())
                            event = threading.Event()
                            future.add_done_callback(lambda _: event.set())
                            result[name] = future.result().current_state.label if event.wait(2) else 'TIMEOUT'
                        finally:
                            node.destroy_client(client)
                else:
                    raise RuntimeError()
                print(json.dumps({'id': request['id'], 'ok': True, 'result': result}), flush=True)
            except Exception:
                print(json.dumps({'id': request.get('id'), 'ok': False,
                                  'error': {'code': 'OBSERVER_UNAVAILABLE', 'message': 'Evidence not ready.'}}), flush=True)
    finally:
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        spin.join(timeout=3)


if __name__ == '__main__':
    main()
