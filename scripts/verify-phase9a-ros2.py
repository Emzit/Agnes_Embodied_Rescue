"""Validate the workspace ROS runtime and clean up owned demo processes."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path('/data-ssd/zhongchengkai/agnes')
LOGS = ROOT / 'logs/phase9a'
PIXI = ROOT / 'tools/pixi/bin/pixi'
MANIFEST = ROOT / 'runtime/ros2-jazzy/pixi.toml'
env = os.environ.copy()
env.update({
    'ROS_DOMAIN_ID': '91',
    'ROS_AUTOMATIC_DISCOVERY_RANGE': 'LOCALHOST',
    'RMW_IMPLEMENTATION': 'rmw_cyclonedds_cpp',
    'CYCLONEDDS_URI': str(ROOT / 'runtime/ros2-jazzy/cyclonedds.xml'),
})
prefix = [str(PIXI), 'run', '--manifest-path', str(MANIFEST)]
results = {}
for name, command in [
    ('ros2_help', ['ros2', '--help']),
    ('ros2_pkg_list', ['ros2', 'pkg', 'list']),
    ('rclpy', ['python', '-c', 'import rclpy,sys; print("RCLPY_IMPORT=PASS"); print(sys.executable)']),
    ('colcon', ['colcon', '--help']),
]:
    with (LOGS / (name + '.log')).open('w') as output:
        completed = subprocess.run(prefix + command, cwd=ROOT, env=env,
                                   stdout=output, stderr=subprocess.STDOUT, timeout=90)
    results[name] = completed.returncode == 0

processes = []
streams = []
try:
    for executable in ('listener', 'talker'):
        stream = (LOGS / (executable + '.log')).open('w')
        streams.append(stream)
        processes.append(subprocess.Popen(
            prefix + ['ros2', 'run', 'demo_nodes_cpp', executable],
            cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT,
            start_new_session=True,
        ))
        if executable == 'listener':
            time.sleep(2)
    deadline = time.monotonic() + 45
    received = 0
    while time.monotonic() < deadline:
        received = (LOGS / 'listener.log').read_text().count('I heard:')
        if received >= 3 or any(process.poll() is not None for process in processes):
            break
        time.sleep(0.5)
    results['received_messages'] = received
    results['talker_listener'] = received >= 3
finally:
    for process in processes:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                break
            try:
                process.wait(timeout=5)
                break
            except subprocess.TimeoutExpired:
                continue
    for stream in streams:
        stream.close()
    results['owned_processes_exited'] = all(process.poll() is not None for process in processes)

(LOGS / 'runtime-validation.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
raise SystemExit(0 if all(results[key] for key in (
    'ros2_help', 'ros2_pkg_list', 'rclpy', 'colcon', 'talker_listener', 'owned_processes_exited',
)) else 1)
