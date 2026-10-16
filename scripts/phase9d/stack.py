"""Own-process supervisor; never discovers processes by broad name matching."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

ROOT = Path('/data-ssd/zhongchengkai/agnes')
PHASE = os.environ.get('PHASE9_STACK', 'phase9d')
if PHASE not in ('phase9d', 'phase9e', 'phase9f', 'phase10', 'final_rescue'):
    raise RuntimeError('INVALID_STACK_PHASE')
REGISTRY = ROOT / f'.runtime-{PHASE}/processes.json'


def project_path(name, default):
    value = os.environ.get(name)
    if not value:
        return ROOT / default
    candidate = Path(value).resolve()
    if ROOT not in candidate.parents and candidate != ROOT:
        raise RuntimeError('SCENARIO_PATH_OUTSIDE_PROJECT')
    return candidate


def identity(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        if stat[0] == 'Z' or Path(f'/proc/{pid}').stat().st_uid != os.getuid():
            return None
        return {'pid': pid, 'start_time': stat[19], 'ppid': int(stat[1]), 'pgid': int(stat[2])}
    except (OSError, ValueError):
        return None


def matches(entry):
    current = identity(entry['pid'])
    return current is not None and current['start_time'] == entry['start_time']


def load():
    return json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {'entries': []}


def save(value):
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    temporary = REGISTRY.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(REGISTRY)


def send(entry, signum):
    if not matches(entry):
        return
    if entry.get('group'):
        # Session leader identity and PGID must both still match the recorded PID.
        if os.getpgid(entry['pid']) != entry['pid']:
            raise RuntimeError('OWNERSHIP_MISMATCH')
        os.killpg(entry['pid'], signum)
    else:
        os.kill(entry['pid'], signum)


def serve():
    old = load()
    if any(matches(e) for e in old['entries']):
        raise RuntimeError('STACK_ALREADY_RUNNING')
    done = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: done.set())
    signal.signal(signal.SIGINT, lambda *_: done.set())
    save({'entries': [{**identity(os.getpid()), 'name': 'supervisor', 'group': False}]})
    prefix = ROOT / 'runtime/ros2-jazzy/.pixi/envs/default'
    world = project_path('SCENARIO_WORLD', f'simulation/{PHASE}/world.sdf')
    bridge = project_path('SCENARIO_BRIDGE', f'simulation/{"phase9f" if PHASE == "phase10" else PHASE}/bridge.yaml')
    odom_tf = project_path('SCENARIO_ODOM_TF', f'simulation/{"phase9f" if PHASE == "phase10" else PHASE}/odom_tf.py')
    nav2_params = project_path('ROBOT_NAV2_PARAMS', 'simulation/phase9d/nav2_params.yaml')
    child_env = os.environ.copy()
    child_env['ROBOT_NAV2_PARAMS'] = str(nav2_params)
    if child_env.get('SCENARIO_LOCALIZATION') == 'amcl':
        overlay = ROOT / 'runtime/ros2-jazzy/overlays/amcl'
        if not (overlay / 'lib/nav2_amcl/amcl').exists():
            raise RuntimeError('PROJECT_AMCL_OVERLAY_MISSING')
        child_env['AMENT_PREFIX_PATH'] = str(overlay) + ':' + child_env.get('AMENT_PREFIX_PATH', '')
        child_env['LD_LIBRARY_PATH'] = str(overlay / 'lib') + ':' + str(prefix / 'lib') + ':' + child_env.get('LD_LIBRARY_PATH', '')
    commands = [
        ('gz-server', [str(prefix / 'bin/gz'), 'sim', '-s', '-r', '-v', '3',
                       *(['--headless-rendering'] if PHASE in ('phase9e', 'phase9f', 'phase10', 'final_rescue') else []),
                       str(world)]),
        ('ros-gz-bridge', [str(prefix / 'bin/ros2'), 'run', 'ros_gz_bridge', 'parameter_bridge', '--ros-args', '-p',
                           'config_file:=' + str(bridge)]),
        ('odom-tf', [sys.executable, str(odom_tf)]),
        ('nav2', [str(prefix / 'bin/ros2'), 'launch', str(ROOT / 'simulation/phase9d/launch/phase9d_nav2.launch.py')]),
    ]
    if PHASE == 'final_rescue' and os.environ.get('SCENARIO_DISABLE_DYNAMIC_CONTROLLER') != '1':
        dynamic = project_path('SCENARIO_DYNAMIC_CONTROLLER', 'simulation/final_rescue/dynamic_scenario.py')
        commands.append(('dynamic-scenario', [sys.executable, str(dynamic)]))
    children = []
    streams = []
    try:
        for name, command in commands:
            stream = (ROOT / f'logs/{PHASE}/{name}.log').open('w')
            streams.append(stream)
            child = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL,
                                     stdout=stream, stderr=stream, start_new_session=True, env=child_env)
            children.append(child)
            entry = identity(child.pid)
            value = load()
            value['entries'].append({**entry, 'name': name, 'group': True})
            save(value)
        readiness = wait_for_readiness()
        print(PHASE.upper() + '_STACK_READY ' + json.dumps(readiness, separators=(',', ':')), flush=True)
        print(PHASE.upper() + '_STACK_STARTED', flush=True)
        while not done.wait(0.2):
            if any(child.poll() is not None for child in children):
                raise RuntimeError('STACK_CHILD_EXITED')
    finally:
        entries = load()['entries']
        for entry in entries:
            if entry['name'] != 'supervisor':
                try:
                    send(entry, signal.SIGINT if entry['name'] in ('gz-server', 'nav2', 'ros-gz-bridge', 'odom-tf') else signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for child in children:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                entry = next(e for e in entries if e['pid'] == child.pid)
                send(entry, signal.SIGTERM)
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    send(entry, signal.SIGKILL)
                    child.wait(timeout=3)
        for stream in streams:
            stream.close()
        save({'entries': []})


def stop():
    entries = load()['entries']
    supervisor = next((e for e in entries if e['name'] == 'supervisor'), None)
    if supervisor and matches(supervisor):
        try:
            send(supervisor, signal.SIGTERM)
        except ProcessLookupError:
            pass
    else:
        for entry in entries:
            try:
                send(entry, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 20
    while any(matches(e) for e in entries) and time.monotonic() < deadline:
        time.sleep(0.1)
    remaining = [e['pid'] for e in entries if matches(e)]
    print(json.dumps({'all_stopped': not remaining, 'remaining_pids': remaining}), flush=True)
    if remaining:
        raise RuntimeError('STACK_STOP_INCOMPLETE')


def register(pid, group):
    entry = identity(pid)
    if not entry or entry['ppid'] != os.getppid():
        raise RuntimeError('NOT_CALLERS_CHILD')
    if group and entry['pgid'] != pid:
        raise RuntimeError('NOT_SESSION_LEADER')
    value = load()
    value['entries'].append({**entry, 'name': 'acceptance-child', 'group': group})
    save(value)


def readiness_probe():
    probe = subprocess.run([sys.executable, str(ROOT / 'scripts/phase9d/check_stack.py')], cwd=ROOT,
                           env=os.environ.copy(), text=True, capture_output=True, timeout=30)
    lines = [line for line in probe.stdout.splitlines() if line.strip()]
    payload = None
    if lines:
        try:
            payload = json.loads(lines[-1])
        except json.JSONDecodeError:
            payload = {'stdout': lines[-1]}
    return probe.returncode == 0, payload or {'stderr': probe.stderr[-1000:]}


def wait_for_readiness(timeout=120):
    deadline = time.monotonic() + timeout
    last = {'failure_reasons': ['readiness_probe_not_run']}
    while time.monotonic() < deadline:
        try:
            ready, details = readiness_probe()
            last = details
            if ready:
                return details
        except subprocess.TimeoutExpired:
            last = {'failure_reasons': ['readiness_probe_timeout']}
        time.sleep(1)
    raise RuntimeError('STACK_READINESS_TIMEOUT:' + json.dumps(last, separators=(',', ':')))


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'serve':
            serve()
        elif sys.argv[1] == 'stop':
            stop()
        elif sys.argv[1] == 'register':
            register(int(sys.argv[2]), sys.argv[3] == 'group')
        else:
            raise RuntimeError('INVALID_COMMAND')
    except Exception as error:
        print('PHASE9D_STACK_OPERATION_FAILED: ' + str(error), file=sys.stderr)
        sys.exit(1)
