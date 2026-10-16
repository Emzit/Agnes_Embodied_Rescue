"""Read the live ROS graph without starting a ROS CLI daemon."""
import sys
import time
import rclpy
from rclpy.action import get_action_names_and_types

rclpy.init()
node = rclpy.create_node('phase9b_graph_snapshot')
try:
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        rclpy.spin_once(node, timeout_sec=0.1)
    if sys.argv[1] == 'actions':
        for name, types in get_action_names_and_types(node):
            print(name, types)
    elif sys.argv[1] == 'topics':
        for name, types in node.get_topic_names_and_types():
            print(name, types)
    else:
        for name, namespace in node.get_node_names_and_namespaces():
            print(namespace.rstrip('/') + '/' + name)
finally:
    node.destroy_node()
    rclpy.shutdown()
