"""Launch only official Nav2 servers; no SLAM, sensors or RViz."""
from launch import LaunchDescription
from launch_ros.actions import Node
import os

ROOT = '/data-ssd/zhongchengkai/agnes'


def generate_launch_description():
    params = os.environ.get('ROBOT_NAV2_PARAMS', ROOT + '/simulation/phase9d/nav2_params.yaml')
    components = [
        ('nav2_map_server', 'map_server', 'map_server'),
        ('nav2_planner', 'planner_server', 'planner_server'),
        ('nav2_controller', 'controller_server', 'controller_server'),
        ('nav2_behaviors', 'behavior_server', 'behavior_server'),
        ('nav2_bt_navigator', 'bt_navigator', 'bt_navigator'),
        ('nav2_lifecycle_manager', 'lifecycle_manager', 'lifecycle_manager'),
    ]
    if os.environ.get('SCENARIO_LOCALIZATION') == 'amcl':
        components.insert(1, ('nav2_amcl', 'amcl', 'amcl'))
    return LaunchDescription([Node(package=package, executable=executable, name=name,
                                   output='screen', parameters=[params])
                              for package, executable, name in components])
