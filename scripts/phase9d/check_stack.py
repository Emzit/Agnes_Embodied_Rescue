"""Check the live stack through ROS graph/services, not PID existence alone."""
import json
from pathlib import Path
import select
import subprocess
import sys
import time

ROOT = Path('/data-ssd/zhongchengkai/agnes')
child = subprocess.Popen([sys.executable, str(ROOT / 'simulation/phase9d/observer.py')],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)


def call_once(method):
    child.stdin.write(json.dumps({'id': method, 'method': method}) + '\n')
    child.stdin.flush()
    if not select.select([child.stdout], [], [], 25)[0]:
        raise RuntimeError('CHECK_TIMEOUT')
    reply = json.loads(child.stdout.readline())
    if not reply.get('ok'):
        raise RuntimeError('NOT_READY')
    return reply['result']


def call(method):
    # A new ROS graph/TF subscriber needs DDS discovery and retained TF delivery.
    # Retry readiness, not navigation; the successful checks remain unchanged.
    for attempt in range(20):
        try:
            return call_once(method)
        except RuntimeError as error:
            if str(error) != 'NOT_READY' or attempt == 19:
                raise
            time.sleep(0.25)


try:
    lifecycle = call('lifecycle')
    graph = call('graph')
    first = call('snapshot')
    time.sleep(0.6)
    second = call('snapshot')
    clock = second['clock_seconds'] > first['clock_seconds'] and second['clock_count'] > first['clock_count']
    fresh_odom = bool(first.get('latest_odom') and second.get('latest_odom') and second['odom_count'] > first['odom_count'])
    tf = graph.get('tf', {})
    tf_ready = all(tf.get(name, {}).get('frame_id') for name in ('map->odom', 'odom->base_link', 'map->base_link'))
    ready = (all(v == 'active' for v in lifecycle.values()) and clock and fresh_odom and tf_ready and
             any(n == '/navigate_to_pose' for n, _ in graph['nav2_action_servers']) and
             'controller_server' in graph['cmd_vel_publishers'] and
             'ros_gz_bridge' in graph['odom_publishers'] and 'ros_gz_bridge' in graph['clock_publishers'])
    print(json.dumps({'ready': ready, 'lifecycle': lifecycle, 'clock_advancing': clock,
                      'fresh_odom': fresh_odom, 'tf_ready': tf_ready, 'tf': tf,
                      'first_clock': first['clock_seconds'], 'second_clock': second['clock_seconds'],
                      'map_to_base': graph.get('map_to_base'),
                      'failure_reasons': ([] if ready else [
                          *([] if all(v == 'active' for v in lifecycle.values()) else ['lifecycle_active']),
                          *([] if clock else ['clock_advancing']),
                          *([] if fresh_odom else ['fresh_odom']),
                          *([] if tf_ready else ['map_odom_base_link_tf']),
                          *([] if any(n == '/navigate_to_pose' for n, _ in graph['nav2_action_servers']) else ['navigate_to_pose_action']),
                      ])}), flush=True)
    if not ready:
        sys.exit(1)
finally:
    child.stdin.close()
    try:
        child.wait(timeout=6)
    except subprocess.TimeoutExpired:
        child.terminate()
        child.wait(timeout=3)
