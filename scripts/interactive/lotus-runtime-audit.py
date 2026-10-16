"""Read-only ROS graph, runtime parameters and TF publisher identity audit."""
import argparse,json,time
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile,DurabilityPolicy
from rcl_interfaces.srv import GetParameters
from tf2_msgs.msg import TFMessage

ROOT=Path('/data-ssd/zhongchengkai/agnes')
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--seconds',type=float,default=6);args=p.parse_args();args.out.resolve().relative_to(ROOT)
rclpy.init();node=Node('lotus_readonly_runtime_audit');frames={};subscriptions=[];callback_info=[]
def receive(msg,info):
 if len(callback_info)<4: callback_info.append({'type':str(type(info)),'repr':repr(info),'keys':list(info.keys()) if isinstance(info,dict) else []})
 if isinstance(info,dict):
  raw=info.get('publisher_gid') or info.get('endpoint_gid') or info.get('gid') or b''
 else:
  raw=getattr(info,'publisher_gid',getattr(info,'endpoint_gid',b''))
 gid=bytes(raw).hex()
 for tf in msg.transforms:
  key=(tf.header.frame_id,tf.child_frame_id,gid)
  value=frames.setdefault(key,{'parent':key[0],'child':key[1],'publisher_gid':gid,'samples':0})
  value.update(samples=value['samples']+1,last_stamp={'sec':tf.header.stamp.sec,'nanosec':tf.header.stamp.nanosec},translation={'x':tf.transform.translation.x,'y':tf.transform.translation.y,'z':tf.transform.translation.z})
for topic,qos in [('/tf',100),('/tf_static',QoSProfile(depth=10,durability=DurabilityPolicy.TRANSIENT_LOCAL))]:
 subscriptions.append(node.create_subscription(TFMessage,topic,receive,qos))
end=time.monotonic()+args.seconds
while time.monotonic()<end:rclpy.spin_once(node,timeout_sec=.05)
graph=node.get_node_names_and_namespaces();controllers=[(n,ns) for n,ns in graph if n=='controller_server'];amcls=[(n,ns) for n,ns in graph if n=='amcl']
values={}
def decode(v):
 return {1:v.bool_value,2:v.integer_value,3:v.double_value,4:v.string_value,5:list(v.byte_array_value),6:list(v.bool_array_value),7:list(v.integer_array_value),8:list(v.double_array_value),9:list(v.string_array_value)}.get(v.type)
for name,ns in controllers+amcls:
 fq=ns.rstrip('/')+'/'+name
 names=(['controller_plugins','goal_checker_plugins','progress_checker_plugins','FollowPath.plugin','FollowPath.stateful','FollowPath.use_collision_detection','FollowPath.use_rotate_to_heading','goal_checker.plugin','goal_checker.stateful','goal_checker.xy_goal_tolerance','goal_checker.yaw_goal_tolerance','progress_checker.plugin','progress_checker.required_movement_radius','progress_checker.movement_time_allowance'] if name=='controller_server' else ['tf_broadcast','base_frame_id','odom_frame_id','global_frame_id','initial_pose.x','initial_pose.y','initial_pose.yaw','laser_model_type','transform_tolerance','do_beamskip','beam_skip_distance','beam_skip_threshold','beam_skip_error_threshold'])
 client=node.create_client(GetParameters,fq+'/get_parameters')
 if client.wait_for_service(timeout_sec=2):
  request=GetParameters.Request();request.names=names;future=client.call_async(request);rclpy.spin_until_future_complete(node,future,timeout_sec=4)
  if future.done() and future.result():values[fq]=dict(zip(names,map(decode,future.result().values)))
 node.destroy_client(client)
endpoints=[]
for topic in ['/tf','/tf_static']:
 for e in node.get_publishers_info_by_topic(topic):
  endpoints.append({'topic':topic,'node':e.node_namespace.rstrip('/')+'/'+e.node_name,'gid':bytes(getattr(e,'endpoint_gid',b'')).hex()})
for v in frames.values():v['publisher_nodes']=sorted({e['node'] for e in endpoints if e['gid']==v['publisher_gid']})
processes=[]
for proc in Path('/proc').glob('[0-9]*'):
 try:
  cmd=(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode()
  if str(ROOT) in cmd and any(x in cmd for x in ['/controller_server --ros-args','/amcl --ros-args','/odom_tf.py','ros2 launch ']):
   processes.append({'pid':int(proc.name),'cmdline':cmd})
 except (OSError,UnicodeError):pass
result={'generated_at_unix':time.time(),'read_only':True,'node_graph':[{'name':n,'namespace':ns} for n,ns in graph],'controller_nodes':[{'name':n,'namespace':ns} for n,ns in controllers],'controller_count':len(controllers),'runtime_parameters':values,'tf_observed_authorities':list(frames.values()),'tf_endpoints':endpoints,'callback_info':callback_info,'processes':processes}
args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'controllers':result['controller_nodes'],'runtime_parameters':values,'map_odom_authorities':[v for v in frames.values() if v['parent']=='map' and v['child']=='odom']}))
node.destroy_node();rclpy.shutdown()
