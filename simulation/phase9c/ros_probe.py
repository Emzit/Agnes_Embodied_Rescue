"""Acceptance observer/publisher only. Never simulates robot odometry."""
import json
import os
import sys
import time
os.environ['RCUTILS_LOGGING_USE_STDOUT'] = '0'
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry


def main():
    rclpy.init()
    node = Node('phase9c_acceptance_probe')
    samples = []
    def receive(msg):
        samples.append({'x': msg.pose.pose.position.x, 'y': msg.pose.pose.position.y,
                        'linear_velocity': msg.twist.twist.linear.x,
                        'angular_velocity': msg.twist.twist.angular.z,
                        'stamp': {'sec': msg.header.stamp.sec, 'nanosec': msg.header.stamp.nanosec}})
    node.create_subscription(Odometry, '/odom', receive, 10)
    pub = node.create_publisher(Twist, '/cmd_vel', 10)
    def spin_for(seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            rclpy.spin_once(node, timeout_sec=0.05)
    try:
        for line in sys.stdin:
            request = json.loads(line)
            try:
                method = request['method']
                if method == 'sample':
                    samples.clear()
                    deadline = time.monotonic() + 15
                    while len(samples) < 3 and time.monotonic() < deadline:
                        rclpy.spin_once(node, timeout_sec=0.1)
                    if len(samples) < 3:
                        raise RuntimeError('ODOM_NOT_RECEIVED')
                    result = {'samples': samples[-3:], 'topics': node.get_topic_names_and_types()}
                elif method in ('drive', 'zero'):
                    spin_for(0.5)
                    if pub.get_subscription_count() < 1:
                        raise RuntimeError('CMD_VEL_NO_SUBSCRIBER')
                    msg = Twist()
                    msg.linear.x = 0.4 if method == 'drive' else 0.0
                    samples.clear()
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        pub.publish(msg)
                        spin_for(0.05)
                    if len(samples) < 3:
                        raise RuntimeError('ODOM_NOT_RECEIVED')
                    result = {'published_linear_x': msg.linear.x, 'samples': samples[-3:]}
                else:
                    raise RuntimeError('UNKNOWN_METHOD')
                print(json.dumps({'id': request['id'], 'ok': True, 'result': result}), flush=True)
            except Exception:
                print(json.dumps({'id': request.get('id'), 'ok': False,
                                  'error': {'code': 'PROBE_FAILED', 'message': 'ROS observation failed.'}}), flush=True)
    finally:
        pub.publish(Twist())
        spin_for(0.2)
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
