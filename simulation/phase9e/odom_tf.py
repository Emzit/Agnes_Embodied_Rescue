"""Real odometry TF and fixed sensor mounting transforms; no control logic."""
import sys
import os
sys.path.insert(0, '/data-ssd/zhongchengkai/agnes/simulation/phase9d')
import rclpy
from geometry_msgs.msg import TransformStamped
from odom_tf import OdomTf

def main():
    rclpy.init()
    node = OdomTf()
    origin = TransformStamped()
    origin.header.frame_id = 'map'
    origin.child_frame_id = 'odom'
    origin.transform.rotation.w = 1.0
    # Publish all static transforms in one retained /tf_static sample.
    transforms = [] if os.environ.get('SCENARIO_LOCALIZATION') == 'amcl' else [origin]
    for frame, x in [('lidar_link', 0.1), ('camera_link', 0.25)]:
        tf = TransformStamped()
        tf.header.frame_id = 'base_link'
        tf.child_frame_id = frame
        tf.transform.translation.x = x
        tf.transform.translation.z = 0.22
        tf.transform.rotation.w = 1.0
        transforms.append(tf)
    node.static.sendTransform(transforms)
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()

if __name__ == '__main__':
    main()
