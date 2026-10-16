"""Transport-only fixture using NavigateToPose; this is NOT Nav2."""
import argparse
import json
import math
import os
import threading
import time
from pathlib import Path
os.environ['RCUTILS_LOGGING_USE_STDOUT'] = '0'
import rclpy
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from nav_msgs.msg import Odometry
from geometry_msgs.msg import Twist
from nav2_msgs.action import NavigateToPose


class Fixture(Node):
    def __init__(self, events):
        super().__init__('phase9b_nav_fixture')
        self.events = events
        self.lock = threading.Lock()
        self.x = self.y = self.speed = 0.0
        self.busy = False
        self.group = ReentrantCallbackGroup()
        self.publisher = self.create_publisher(Odometry, '/odom', 10)
        self.create_timer(0.05, self.publish, callback_group=self.group)
        self.create_subscription(Twist, '/cmd_vel', self.on_velocity, 10, callback_group=self.group)
        self.server = ActionServer(self, NavigateToPose, '/navigate_to_pose',
                                   self.execute, goal_callback=self.goal,
                                   cancel_callback=self.cancel, callback_group=self.group)
        self.event('fixture_ready', real_nav2=False)

    def event(self, name, **fields):
        with self.events.open('a') as stream:
            stream.write(json.dumps({'event': name, **fields}) + '\n')

    def publish(self):
        message = Odometry()
        message.header.frame_id = 'map'
        message.child_frame_id = 'base_link'
        message.header.stamp = self.get_clock().now().to_msg()
        with self.lock:
            message.pose.pose.position.x, message.pose.pose.position.y = self.x, self.y
            message.twist.twist.linear.x = self.speed
        message.pose.pose.orientation.w = 1.0
        self.publisher.publish(message)

    def on_velocity(self, message):
        if all(getattr(vector, axis) == 0 for vector in (message.linear, message.angular)
               for axis in ('x', 'y', 'z')):
            self.event('zero_twist_received')

    def goal(self, request):
        with self.lock:
            if self.busy:
                return GoalResponse.REJECT
            self.busy = True
        return GoalResponse.ACCEPT

    def cancel(self, handle):
        self.event('cancel_requested')
        return CancelResponse.ACCEPT

    def execute(self, handle):
        goal = handle.request.pose.pose.position
        self.event('goal_accepted', x=goal.x, y=goal.y)
        result = NavigateToPose.Result()
        try:
            while rclpy.ok():
                if handle.is_cancel_requested:
                    handle.canceled()
                    self.event('goal_canceled')
                    return result
                with self.lock:
                    dx, dy = goal.x - self.x, goal.y - self.y
                    distance = math.hypot(dx, dy)
                    if distance < 0.01:
                        self.x, self.y = goal.x, goal.y
                        break
                    step = min(0.05, distance)
                    self.x += dx / distance * step
                    self.y += dy / distance * step
                    self.speed = 1.0
                time.sleep(0.05)
            handle.succeed()
            self.event('goal_succeeded', x=goal.x, y=goal.y)
            return result
        finally:
            with self.lock:
                self.speed = 0.0
                self.busy = False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--events', required=True)
    args = parser.parse_args()
    rclpy.init()
    node = Fixture(Path(args.events))
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    try:
        executor.spin()
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    finally:
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
