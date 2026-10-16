"""Real Nav2 terminal convergence isolation; no scenario controller or pose writes."""
import json, os, subprocess, time, signal, select
from pathlib import Path
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist, PoseWithCovarianceStamped
from nav_msgs.msg import Odometry
from std_msgs.msg import Bool
from tf2_msgs.msg import TFMessage

ROOT=Path('/data-ssd/zhongchengkai/agnes')
OUT=Path(os.environ['LOTUS_CONVERGENCE_OUT']).resolve(); OUT.relative_to(ROOT)
class Recorder(Node):
    def __init__(self):
        super().__init__('lotus_terminal_convergence_recorder')
        self.rows=[]
        for topic,typ in [('/amcl_pose',PoseWithCovarianceStamped),('/odom',Odometry),
                          ('/cmd_vel',Twist),('/is_rotating_to_heading',Bool),('/tf',TFMessage)]:
            self.create_subscription(typ,topic,lambda m,t=topic:self.record(t,m),10)
    def record(self,topic,msg):
        row={'wall_time':time.time(),'topic':topic}
        if topic=='/amcl_pose':
            p=msg.pose.pose.position;row['pose']={'x':p.x,'y':p.y}
        elif topic=='/odom':
            p=msg.pose.pose.position;row['pose']={'x':p.x,'y':p.y};row['linear_x']=msg.twist.twist.linear.x;row['angular_z']=msg.twist.twist.angular.z
        elif topic=='/cmd_vel': row['linear_x']=msg.linear.x;row['angular_z']=msg.angular.z
        elif topic=='/is_rotating_to_heading': row['rotating']=msg.data
        else:
            row['transforms']=[{'parent':t.header.frame_id,'child':t.child_frame_id,'stamp':{'sec':t.header.stamp.sec,'nanosec':t.header.stamp.nanosec},'x':t.transform.translation.x,'y':t.transform.translation.y} for t in msg.transforms if t.header.frame_id in ('map','odom')]
        self.rows.append(row)
def main():
    rclpy.init();node=Recorder();env=os.environ.copy();env['ROBOT_ROS2_ENV']='final_rescue';env['ROBOT_TRACE_DIR']=str(OUT.parent)
    bridge=subprocess.Popen(['bash',str(ROOT/'services/robot-mcp/ros2_bridge/launch_bridge.sh')],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,preexec_fn=os.setsid)
    request={'id':'terminal-convergence','method':'navigate_to','params':{'target':'A_Link','pose':{'x':10.5,'y':-4.2,'yaw':0.0,'frame_id':'map'},'timeout_sec':45}}
    bridge.stdin.write(json.dumps(request)+'\n');bridge.stdin.flush();result=None;started=time.monotonic()
    try:
        while time.monotonic()-started<60 and result is None:
            rclpy.spin_once(node,timeout_sec=.05)
            line=''
            if bridge.stdout and select.select([bridge.stdout],[],[],0)[0]:
                line=bridge.stdout.readline()
            if line:
                try:
                    reply=json.loads(line)
                    if reply.get('id')=='terminal-convergence':result=reply
                except json.JSONDecodeError:pass
    finally:
        try: bridge.stdin.write(json.dumps({'id':'stop','method':'stop_robot','params':{}})+'\n');bridge.stdin.flush()
        except Exception:pass
        try:os.killpg(bridge.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        node.destroy_node();rclpy.shutdown();OUT.write_text(json.dumps({'result':result,'rows':node.rows,'no_scenario_controller':True,'read_only_recorder':True},indent=2)+'\n')
if __name__=='__main__':main()
