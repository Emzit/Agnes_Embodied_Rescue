"""Direct official NavigateToPose convergence isolation, read-only recorder."""
import json, math, os, time
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from geometry_msgs.msg import Twist, PoseWithCovarianceStamped
from nav_msgs.msg import Odometry
from std_msgs.msg import Bool
from tf2_msgs.msg import TFMessage
from nav2_msgs.action import NavigateToPose

ROOT=Path('/data-ssd/zhongchengkai/agnes')
OUT=Path(os.environ['LOTUS_CONVERGENCE_OUT']).resolve();OUT.relative_to(ROOT)
def quat_yaw(q): return math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z))
class Recorder(Node):
 def __init__(self):
  super().__init__('lotus_terminal_action_convergence_recorder');self.rows=[]
  for topic,typ in [('/amcl_pose',PoseWithCovarianceStamped),('/odom',Odometry),('/cmd_vel',Twist),('/is_rotating_to_heading',Bool),('/tf',TFMessage)]:
   self.create_subscription(typ,topic,lambda m,t=topic:self.record(t,m),10)
 def record(self,topic,msg):
  r={'wall_time':time.time(),'topic':topic}
  if topic=='/amcl_pose':
   p=msg.pose.pose.position;r['pose']={'x':p.x,'y':p.y,'yaw':quat_yaw(msg.pose.pose.orientation)}
  elif topic=='/odom':
   p=msg.pose.pose.position;r['pose']={'x':p.x,'y':p.y};r['linear_x']=msg.twist.twist.linear.x;r['angular_z']=msg.twist.twist.angular.z
  elif topic=='/cmd_vel':r['linear_x']=msg.linear.x;r['angular_z']=msg.angular.z
  elif topic=='/is_rotating_to_heading':r['rotating']=msg.data
  else:r['transforms']=[{'parent':t.header.frame_id,'child':t.child_frame_id,'stamp':{'sec':t.header.stamp.sec,'nanosec':t.header.stamp.nanosec},'x':t.transform.translation.x,'y':t.transform.translation.y,'yaw':quat_yaw(t.transform.rotation)} for t in msg.transforms if t.header.frame_id in ('map','odom')]
  self.rows.append(r)
def main():
 rclpy.init();n=Recorder();client=ActionClient(n,NavigateToPose,'/navigate_to_pose');result=None;accepted=False
 if client.wait_for_server(timeout_sec=10):
  g=NavigateToPose.Goal();g.pose.header.frame_id='map';g.pose.header.stamp=n.get_clock().now().to_msg();g.pose.pose.position.x=10.5;g.pose.pose.position.y=-4.2;g.pose.pose.orientation.w=1.0
  send=client.send_goal_async(g);rclpy.spin_until_future_complete(n,send,timeout_sec=10)
  if send.done() and send.result():
   handle=send.result();accepted=handle.accepted
   if accepted:
    future=handle.get_result_async();deadline=time.monotonic()+90
    while rclpy.ok() and not future.done() and time.monotonic()<deadline:rclpy.spin_once(n,timeout_sec=.05)
    if future.done():
     v=future.result();result={'action_status':int(v.status),'error_code':int(v.result.error_code),'goal_id':bytes(handle.goal_id.uuid).hex(),'result_wall_time':time.time()}
    else:
     cancel=handle.cancel_goal_async();rclpy.spin_until_future_complete(n,cancel,timeout_sec=5);result={'action_status':'TIMEOUT','error_code':None,'goal_id':bytes(handle.goal_id.uuid).hex(),'result_wall_time':time.time()}
  else: result={'action_status':'REJECTED','error_code':None}
 else: result={'action_status':'SERVER_UNAVAILABLE','error_code':None}
 n.create_publisher(Twist,'/cmd_vel',10).publish(Twist());time.sleep(.2)
 OUT.write_text(json.dumps({'result':result,'accepted':accepted,'rows':n.rows,'no_scenario_controller':True,'read_only_recorder':True},indent=2)+'\n');n.destroy_node();rclpy.shutdown()
if __name__=='__main__':main()
