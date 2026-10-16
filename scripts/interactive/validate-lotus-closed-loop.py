"""Post-run evidence validation. Never publishes or changes simulation state."""
import argparse
import bisect
import datetime
import hashlib
import json
import math
from pathlib import Path

ROOT = Path('/data-ssd/zhongchengkai/agnes')
DEST = ROOT / 'artifacts/indoor-rescue-upgrade'


def read(p, default=None):
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def rows(p, start=0, end=float('inf')):
    if not p.exists():
        return []
    result = []
    with p.open() as stream:
        for line in stream:
            try:
                row = json.loads(line)
                t = row.get('wall_time', start)
                if start <= t <= end:
                    result.append(row)
            except json.JSONDecodeError:
                pass
    return result


def stamp(m):
    s = m['header']['stamp']
    return s['sec'] + s['nanosec'] / 1e9


def yaw(q):
    x,y,z,w = (q.get(k,0) for k in ('x','y','z','w'))
    return math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z))


def box_distance(p, center, size):
    return math.hypot(max(0,abs(p[0]-center[0])-size[0]/2),
                      max(0,abs(p[1]-center[1])-size[1]/2))


def path_distance(p, points):
    best = float('inf')
    for a,b in zip(points,points[1:]):
        dx,dy = b[0]-a[0],b[1]-a[1]
        sq = dx*dx+dy*dy
        t = max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/sq)) if sq else 0
        best = min(best,math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy))
    return best


def event_cells(row, center, size):
    m = row['message']
    raw = row['topic'].endswith('_raw')
    info = m['metadata'] if raw else m['info']
    w,h = (info['size_x'],info['size_y']) if raw else (info['width'],info['height'])
    res = info['resolution']
    ox,oy = info['origin']['position']['x'],info['origin']['position']['y']
    result = []
    for k,v in enumerate(m['data']):
        if v <= 0 or v == 255:
            continue
        p = [ox+(k%w+.5)*res,oy+(k//w+.5)*res]
        if box_distance(p,center,size) <= .12:
            result.append({'cell':[k%w,k//w],'point':p,'value':v})
    return result


def iso_time(v):
    return datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()


parser = argparse.ArgumentParser()
parser.add_argument('--session', required=True, type=Path)
parser.add_argument('--attempt', required=True, type=int)
parser.add_argument('--mission', required=True)
parser.add_argument('--physical', type=Path, default=ROOT/'artifacts/interactive-live/full-mission')
args = parser.parse_args()
mission_dir = ROOT/'artifacts/interactive-live/missions'/args.mission
events = rows(mission_dir/'events.jsonl')
current = read(mission_dir/'current.json',{})
mission_start = iso_time(current['started_at']) if current.get('started_at') else 0
mission_end = iso_time(current['finished_at']) if current.get('finished_at') else float('inf')
stream = rows(args.session/f'attempt{args.attempt}-onboard.jsonl', mission_start, mission_end)
physical = args.physical
old_target = read(physical/'lotus-old-path-target.json',{})
geometry = read(physical/'lotus-event-target-geometry.json',{})
closed = read(physical/'lotus-event-closed-loop-validation.json',{})
if not closed.get('pass') or not old_target:
    raise SystemExit('No completed closed-loop event in this run')
old = old_target['old_plan']
center,size = closed['actual']['center'],geometry['collision_size']
t1 = closed['physical_event_reached_target']
if t1 < mission_start:
    raise SystemExit('Stale event from a different mission')
audit = rows(ROOT/'artifacts/final_rescue/manual/onboard-path-events.jsonl')
audit = [r for r in audit if r['wall_time'] >= mission_start]
robot = None
hits = []
pre_target_hits = []
physical_history = []
carrier_samples = []
robot_sim_samples = []
for row in stream:
    m = row['message']
    if row['topic']=='evaluator_only_gazebo_carrier_pose':
        model=next((p for p in m['pose'] if p['name']=='runtime_event_carrier'),None)
        body=next((p for p in m['pose'] if p['name'].endswith('::body')),None)
        if model and body:
            origin,pos=model['position'],body['position'];s=body['header']['stamp']
            carrier_samples.append({'wall_time':row['wall_time'],
                'sim_time':float(s.get('sec',0))+s.get('nsec',0)/1e9,
                'center':[origin.get('x',0)+pos.get('x',0),origin.get('y',0)+pos.get('y',0)]})
    if row['topic'] == 'evaluator_only_gazebo_robot_pose':
        p = m['poses'][0]
        robot = (p['position'].get('x',0),p['position'].get('y',0),yaw(p['orientation']))
        physical_history.append({'wall_time':row['wall_time'],'pose':robot})
        s=m['stamp']
        robot_sim_samples.append({'sim_time':float(s.get('sec',0))+s.get('nsec',0)/1e9,'center':robot[:2]})
    if row['topic'] != '/scan' or robot is None:
        continue
    x,y,a = robot
    matches = []
    for i,r in enumerate(m['ranges']):
        if not math.isfinite(r):
            continue
        b = a+m['angle_min']+i*m['angle_increment']
        p = [x+.1*math.cos(a)+r*math.cos(b),y+.1*math.sin(a)+r*math.sin(b)]
        if box_distance(p,center,size) < .04:
            # Surface match, rather than a generic near-range scan change.
            surface = min(abs(abs(p[0]-center[0])-size[0]/2),
                          abs(abs(p[1]-center[1])-size[1]/2))
            if surface < .05:
                matches.append({'beam':i,'range':r,'endpoint':p})
    if len(matches) >= 2:
        hit={'wall_time':row['wall_time'],'sim_stamp':stamp(m),
             'physical_robot_pose_evaluator_only':robot,'matches':matches}
        (hits if row['wall_time']>t1 else pre_target_hits).append(hit)
first_hit = hits[0] if hits else None
marked = []
raw_baselines = [r for r in stream if r['topic']=='/global_costmap/obstacle_layer_raw' and r['wall_time']<old['wall_time']]
raw_baseline = raw_baselines[-1]['message']['data'] if raw_baselines else []
for row in stream:
    if row['topic'] != '/global_costmap/obstacle_layer_raw' or row['wall_time'] < t1:
        continue
    width=row['message']['metadata']['size_x']
    cells = [c for c in event_cells(row,center,size) if c['value']==254
             and raw_baseline and raw_baseline[c['cell'][1]*width+c['cell'][0]]!=254]
    if cells:
        marked.append({'wall_time':row['wall_time'],'cells':cells})
first_mark = marked[0] if marked else None
inflation = []
master_baselines = [r for r in stream if r['topic']=='/global_costmap/costmap' and r['wall_time']<old['wall_time']]
master_baseline=master_baselines[-1]['message']['data'] if master_baselines else []
for row in stream:
    if row['topic']!='/global_costmap/costmap' or not first_hit or row['wall_time']<first_hit['wall_time']:
        continue
    m=row['message'];info=m['info'];width=info['width'];res=info['resolution']
    ox,oy=info['origin']['position']['x'],info['origin']['position']['y']
    cells=[]
    for k,value in enumerate(m['data']):
        if not (0<value<100) or not master_baseline or master_baseline[k]>=value:
            continue
        point=[ox+(k%width+.5)*res,oy+(k//width+.5)*res]
        if .12<box_distance(point,center,size)<.8:
            cells.append({'cell':[k%width,k//width],'point':point,'before':master_baseline[k],'after':value})
    if cells:
        inflation.append({'wall_time':row['wall_time'],'cells':cells})
        break
updates = [r for r in audit if r['type']=='live_world_updated' and r['wall_time']>t1]
update = updates[0] if updates else None
invalids = [r for r in audit if r['type']=='old_plan_invalidated' and r.get('accepted') and r['wall_time']>t1]
invalid = invalids[0] if invalids else None
original_requests = [r for r in audit if r['type']=='new_plan_requested' and r['wall_time'] < t1]
original_target = original_requests[-1]['target'] if original_requests else None
recovery_requests = [r for r in audit if r['type']=='new_plan_requested' and invalid and r['wall_time']>invalid['wall_time']]
# Compare a real replan to the original destination, rather than crediting a
# retreat to a different destination as the requested alternative route.
requests = [r for r in recovery_requests if r.get('target') == original_target]
request = requests[0] if requests else None
plans = []
for row in stream:
    if row['topic']=='/plan' and request and row['wall_time']>request['wall_time']:
        pts = [[p['pose']['position']['x'],p['pose']['position']['y']] for p in row['message']['poses']]
        if not pts or math.dist(pts[-1], old['points'][-1]) > .15:
            continue
        deviation = max((path_distance(p,old['points']) for p in pts),default=0)
        clearance = min((box_distance(p,center,size) for p in pts),default=0)
        plans.append({'wall_time':row['wall_time'],'points':pts,
                      'directed_deviation_from_old_path_m':deviation,
                      'min_collision_clearance_m':clearance})
new = plans[0] if plans else None
new_goal_id = None
terminal_action = None
if new and request:
    created=[r for r in audit if r['type']=='old_plan_created' and r['wall_time']>=request['wall_time']
             and r.get('points')==new['points'] and r.get('goal_id')]
    new_goal_id=created[0]['goal_id'] if created else None
    new['goal_id']=new_goal_id
    for row in stream:
        if row['topic']!='/navigate_to_pose/_action/status' or row['wall_time']<new['wall_time']:
            continue
        matched=[s for s in row['message']['status_list'] if
                 bytes(s['goal_info']['goal_id']['uuid']).hex()==new_goal_id and s['status'] in [4,5,6]]
        if matched:
            terminal_action={'wall_time':row['wall_time'],'goal_id':new_goal_id,
                             'status':matched[0]['status']}
            break
execution = None
follow = None
if new:
    matching_success = [r for r in audit if r['type']=='navigation_succeeded' and
                        r.get('target')==original_target and r.get('goal_id')==new_goal_id
                        and r['wall_time']>=new['wall_time']]
    route_end = (terminal_action['wall_time'] if terminal_action else
                 matching_success[0]['wall_time'] if matching_success else mission_end)
    poses = [p for p in physical_history if new['wall_time']<=p['wall_time']<=route_end]
    if poses:
        distances = [path_distance(p['pose'][:2],new['points']) for p in poses]
        close = [(p,d) for p,d in zip(poses,distances) if d <= .65]
        for p,d in close:
            if math.dist(p['pose'][:2],poses[0]['pose'][:2]) >= .4:
                execution = {'wall_time':p['wall_time'],'pose':p['pose'],
                             'distance_to_new_path_m':d,'source':'real Gazebo physical robot pose history'}
                break
        follow = {'samples_near_first_new_path':len(close),'total_physical_samples':len(poses),
                  'tolerance_m':.65,'first_execution':execution,
                  'fraction_near_path':len(close)/len(poses),
                  'max_distance_m':max(distances),
                  'final_physical_pose':poses[-1],
                  'final_physical_distance_to_goal_m':math.dist(poses[-1]['pose'][:2],new['points'][-1]),
                  'min_physical_collision_clearance_m':min(box_distance(p['pose'][:2],center,size) for p in poses)}
success = [r for r in audit if r['type']=='navigation_succeeded' and r.get('target')==original_target
           and new and r.get('goal_id')==new_goal_id and r['wall_time']>new['wall_time']]
t9 = success[-1]['wall_time'] if success else None
memory_updates = [e for e in events if e.get('type')=='tool_result' and e.get('tool')=='world_memory_update'
                  and first_hit and iso_time(e['timestamp'])>=first_hit['wall_time']]
memory = memory_updates[0] if memory_updates else None
chain = {'T0_old_plan_created':old['wall_time'],
         'T1_physical_event_reached_target':t1,
         'T2_first_onboard_detection':first_hit['wall_time'] if first_hit else None,
         'T3_global_costmap_marked':first_mark['wall_time'] if first_mark else None,
         'T4_live_world_updated':update['wall_time'] if update else None,
         'T5_old_plan_invalidated':invalid['wall_time'] if invalid else None,
         'T6_new_plan_requested':request['wall_time'] if request else None,
         'T7_new_plan_created':new['wall_time'] if new else None,
         'T8_robot_executes_new_route':execution['wall_time'] if execution else None,
         'T9_navigation_succeeded':t9}
times = list(chain.values())
ordering = all(t is not None for t in times) and times[0]<times[1]<times[2] and all(
    a<=b for a,b in zip(times[2:],times[3:]))
conflicts = update.get('evidence',{}).get('conflicts',[]) if update else []
conflicts_at_event = [c for c in conflicts if box_distance(c['point'],center,size)<=.6]
agent_text = '\n'.join((mission_dir/f).read_text() for f in ['events.jsonl','agnes-events.jsonl'] if (mission_dir/f).exists())
hidden_leak = any(key in agent_text for key in ['"hidden_ground_truth":','"person_target_room":','"dynamic_obstacle_event":'])
collision_witnesses = [p for p in old['points'] if box_distance(p,center,size)<geometry['robot_radius']-.02]
def maximum_speed(samples):
    return max((math.dist(a['center'],b['center'])/(b['sim_time']-a['sim_time'])
                for a,b in zip(samples,samples[1:]) if b['sim_time']>a['sim_time']),default=float('inf'))
carrier_speed=maximum_speed(carrier_samples)
robot_speed=maximum_speed(robot_sim_samples)
hold_samples=[p for p in carrier_samples if p['wall_time']>=t1]
hold_drift=max((math.dist(p['center'],center) for p in hold_samples),default=float('inf'))
checks = {'closed_loop_physical_event':closed.get('pass') is True,
          'old_plan_before_event':old['wall_time']<t1,
          'future_segment':old_target['selection']['future_arc_distance_m']>=1,
          'alternate_route':old_target['selection']['alternate_route_exists'],
          'collision_in_old_corridor':bool(collision_witnesses),
          'lidar_surface_evidence':first_hit is not None,
          'no_target_surface_detection_before_T1':not pre_target_hits,
          'global_raw_marking':first_mark is not None,
          'global_inflation_from_obstacle':bool(inflation),
          'old_path_inflation_conflict_at_event':bool(conflicts_at_event),
          'live_world_from_onboard':bool(update and update['evidence']['source']=='live_nav2_path_costmap_and_lidar'
               and update.get('world_model')=='RuntimeWorldState.blocked_routes'
               and update.get('world_model_entry',{}).get('source')=='live_nav2_path_costmap_and_lidar'
               and update.get('gateway_updated_at',0)<=update['wall_time']),
          'real_goal_cancellation':invalid is not None,
          'real_nav2_request':request is not None,
          'measurable_new_path':bool(new and new['directed_deviation_from_old_path_m']>.25),
          'new_path_avoids_collision':bool(new and new['min_collision_clearance_m']>=geometry['robot_radius']-.05),
          'physical_robot_executes_new_path':bool(execution and follow and follow['fraction_near_path']>=.95
               and follow['final_physical_distance_to_goal_m']<=.6
               and follow['min_physical_collision_clearance_m']>=geometry['robot_radius']-.05),
          'navigation_succeeded':t9 is not None,
          'continuous_physical_motion_no_teleport':carrier_speed<=1.6 and robot_speed<=.8,
          'event_remains_stable_after_controller_stops':len(hold_samples)>100 and hold_drift<=.04,
          'strict_chronology':ordering,
          'no_hidden_truth_leak':not hidden_leak}
report = {'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'mission_id':args.mission,'attempt':args.attempt,'chronology':chain,'checks':checks,
          'ordering':{'required':'T0 < T1 < T2 <= T3 <= T4 <= T5 <= T6 <= T7 <= T8 <= T9','satisfied':ordering},
          'old_plan':old,'physical_event':closed,'first_onboard_detection':first_hit,
          'first_global_marking':first_mark,'onboard_world_update':update,'invalidation':invalid,
          'global_inflation':inflation,'pre_target_surface_hits':pre_target_hits[:3],
          'new_request':request,'new_path':new,'followed_path':follow,
          'matched_new_nav2_goal_terminal_action':terminal_action,
          'agent_memory_update':memory,'event_region_path_conflicts':conflicts_at_event,
          'agent_memory_update_before_new_request_informational':bool(memory and request and iso_time(memory['timestamp'])<=request['wall_time']),
          'T4_scope':'Externally readable live RuntimeWorldState, acknowledged before old-goal cancellation; Agent memory is updated independently and its later timestamp is not backdated.',
          'mission_status':current.get('status'),'pass':all(checks.values()),
          'original_target':original_target,'intermediate_recovery_requests':recovery_requests,
          'physical_continuity':{'max_carrier_speed_mps':carrier_speed,'max_robot_speed_mps':robot_speed,
              'post_target_hold_samples':len(hold_samples),'post_target_max_drift_m':hold_drift,
              'source':'independent native Gazebo pose stream, simulation-time finite differences; evaluator only'},
          'collision_old_path_witnesses':collision_witnesses,
          'evidence_stream':str(args.session/f'attempt{args.attempt}-onboard.jsonl')}
snapshot = args.session/f'attempt{args.attempt}-validation.json'
snapshot.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'mission_id':args.mission,'chronology':chain,'checks':checks,'pass':report['pass']},indent=2))
