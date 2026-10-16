"""Real /odom plus one calibrated static transform batch; never controls."""
import os,math
from pathlib import Path
import xml.etree.ElementTree as ET
import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry
from tf2_ros import TransformBroadcaster,StaticTransformBroadcaster
class CalibratedOdomTf(Node):
 def __init__(self):
  super().__init__('agnes_final_odom_tf',parameter_overrides=[Parameter('use_sim_time',value=True)])
  self.dynamic=TransformBroadcaster(self);self.static=StaticTransformBroadcaster(self)
  origin=TransformStamped();origin.header.frame_id='map';origin.child_frame_id='odom'
  origin.transform.translation.x=float(os.environ.get('SCENARIO_MAP_ODOM_X','0'))
  origin.transform.translation.y=float(os.environ.get('SCENARIO_MAP_ODOM_Y','0'))
  yaw=float(os.environ.get('SCENARIO_MAP_ODOM_YAW','0'))
  origin.transform.rotation.z=math.sin(yaw/2);origin.transform.rotation.w=math.cos(yaw/2)
  transforms=[] if os.environ.get('SCENARIO_LOCALIZATION')=='amcl' else [origin]
  # Read the selected SDF so camera TF follows scene changes and rollbacks.
  world_path=os.environ.get('SCENARIO_WORLD') or str(Path(__file__).with_name('world.sdf'))
  poses=ET.parse(world_path).findall("./world/model/link[@name='camera_link']/pose")
  if len(poses)!=1 or poses[0].get('relative_to'):
   raise ValueError('Selected world must define one model-relative camera_link pose')
  camera_pose=[float(v) for v in (poses[0].text or '').split()]
  if len(camera_pose)!=6 or not all(math.isfinite(v) for v in camera_pose):
   raise ValueError('Invalid camera pose in selected world')
  if camera_pose[:2]!=[.25,0] or any(camera_pose[3:]):
   raise ValueError('Unsupported camera translation/orientation; update TF calibration')
  camera_z=camera_pose[2]
  for frame,x,z in [('lidar_link',.1,.22),('camera_link',.25,camera_z)]:
   tf=TransformStamped();tf.header.frame_id='base_link';tf.child_frame_id=frame
   tf.transform.translation.x=x;tf.transform.translation.z=z;tf.transform.rotation.w=1.;transforms.append(tf)
  # One batch only: StaticTransformBroadcaster retains the first entry per child.
  self.static.sendTransform(transforms)
  self.create_subscription(Odometry,'/odom',self.on_odom,10)
 def on_odom(self,msg):
  t=TransformStamped();t.header=msg.header;t.header.frame_id='odom';t.child_frame_id='base_link'
  p=msg.pose.pose.position;t.transform.translation.x=p.x;t.transform.translation.y=p.y;t.transform.translation.z=p.z
  t.transform.rotation=msg.pose.pose.orientation;self.dynamic.sendTransform(t)
def main():
 rclpy.init();node=CalibratedOdomTf()
 try:rclpy.spin(node)
 except (KeyboardInterrupt,rclpy.executors.ExternalShutdownException):pass
 finally:
  node.destroy_node()
  if rclpy.ok():rclpy.shutdown()
if __name__=='__main__':main()
