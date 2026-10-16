"""TF only: real Gazebo odometry plus fixed map origin; never publishes velocity."""
import os
import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from tf2_ros import TransformBroadcaster, StaticTransformBroadcaster
from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry


class OdomTf(Node):
    def __init__(self):
        super().__init__('phase9d_odom_tf', parameter_overrides=[Parameter('use_sim_time', value=True)])
        self.dynamic = TransformBroadcaster(self)
        self.static = StaticTransformBroadcaster(self)
        origin = TransformStamped()
        origin.header.frame_id = 'map'
        origin.child_frame_id = 'odom'
        # Gazebo's diff-drive odometry is relative to the robot's physical
        # spawn pose, while the imported map is expressed in world/map
        # coordinates.  Keep the transform zero for the legacy baseline, but
        # allow an activated skeleton to supply its real start pose so the
        # sensor frame, Nav2 map and Gazebo collision geometry share one
        # coordinate frame.  This is a frame calibration, not a pose write or
        # teleport; the dynamic transform below remains the real /odom.
        try:
            origin.transform.translation.x = float(os.environ.get('SCENARIO_MAP_ODOM_X', '0'))
            origin.transform.translation.y = float(os.environ.get('SCENARIO_MAP_ODOM_Y', '0'))
        except ValueError:
            origin.transform.translation.x = 0.0
            origin.transform.translation.y = 0.0
        origin.transform.rotation.w = 1.0
        if os.environ.get('SCENARIO_LOCALIZATION') != 'amcl':
            self.static.sendTransform(origin)
        self.create_subscription(Odometry, '/odom', self.on_odom, 10)

    def on_odom(self, msg):
        transform = TransformStamped()
        transform.header = msg.header
        transform.header.frame_id = 'odom'
        transform.child_frame_id = 'base_link'
        p = msg.pose.pose.position
        transform.transform.translation.x = p.x
        transform.transform.translation.y = p.y
        transform.transform.translation.z = p.z
        transform.transform.rotation = msg.pose.pose.orientation
        self.dynamic.sendTransform(transform)


def main():
    rclpy.init()
    node = OdomTf()
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
