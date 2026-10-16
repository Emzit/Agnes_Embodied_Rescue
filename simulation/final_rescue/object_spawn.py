"""Bounded EntityFactory creation with auditable, read-only fallback evidence."""
from pathlib import Path
import math,re,subprocess,time

ROOT=Path('/data-ssd/zhongchengkai/agnes')
GZ=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin/gz'
POSE_TOLERANCE=.02

def expected_models(spec):
    person=spec['person_pose_orientation']
    objects=spec['object_placements']
    assert len(objects)==3
    rows=[{'model':'scenario_person','label':'person','pose':{**person,'z':0.,'roll':0.,'pitch':0.}}]
    rows.extend({'model':v['id'],'label':v.get('label','object'),'pose':{**v,'z':0.,'roll':0.,'pitch':0.}} for v in objects)
    assert len({r['model'] for r in rows})==4
    for row in rows:
        row['pose']={k:float(row['pose'].get(k,0.)) for k in ('x','y','z','roll','pitch','yaw')}
        assert all(math.isfinite(v) for v in row['pose'].values())
    return rows

def poses_match(actual,expected):
    try:
        values=[float(actual[k]) for k in ('x','y','z','roll','pitch','yaw')]
        target=[float(expected.get(k,0.)) for k in ('x','y','z','roll','pitch','yaw')]
        if not all(math.isfinite(v) for v in values+target):return False
        if math.dist(values[:3],target[:3])>POSE_TOLERANCE:return False
        return all(abs(math.atan2(math.sin(a-b),math.cos(a-b)))<=POSE_TOLERANCE for a,b in zip(values[3:],target[3:]))
    except (KeyError,TypeError,ValueError):return False

def parse_entity_observation(stdout,returncode,model,world,expected_pose):
    """Only an exact Gazebo world/name/id/pose read can establish existence."""
    result={'status':'UNKNOWN','source':'read-only gz model -m -p'}
    if returncode!=0 or not isinstance(stdout,str):return result
    found=re.search(r'Requesting state for world \[([^\]]+)\]',stdout)
    if not found or found.group(1)!=world:return result
    result['world_name']=world
    if f'No model named <{model}> was found' in stdout:
        return {**result,'status':'MISSING','model':model}
    identity=re.search(r'Model:\s*\[(\d+)\]\s*-\s*Name:\s*([^\r\n]+)',stdout)
    pose=re.search(r'- Pose \[ XYZ \(m\) \] \[ RPY \(rad\) \]:\s*\[([^\]]+)\]\s*\[([^\]]+)\]',stdout)
    if not identity or identity.group(2).strip()!=model or int(identity.group(1))<=0 or not pose:return result
    try:
        xyz=[float(v) for v in pose.group(1).split()]
        rpy=[float(v) for v in pose.group(2).split()]
        if len(xyz)!=3 or len(rpy)!=3 or not all(math.isfinite(v) for v in xyz+rpy):return result
    except ValueError:return result
    actual=dict(zip(('x','y','z','roll','pitch','yaw'),xyz+rpy))
    return {**result,'status':'EXISTS_AT_EXPECTED_POSE' if poses_match(actual,expected_pose) else 'EXISTS_AT_DIFFERENT_POSE',
            'model':model,'entity_id':int(identity.group(1)),'actual_pose':actual}

def creation_acknowledged(returncode,stdout):
    return returncode==0 and isinstance(stdout,str) and bool(re.search(r'^\s*data:\s*true\s*$',stdout,re.M))

def validate_spawn_evidence(payload,spec,world_name,observed_after=None):
    """Shared strict scene-switch gate; reparse raw fallback, never trust flags."""
    try:
        expected=expected_models(spec)
        rows=payload['objects_spawned']
        if payload.get('seed')!=spec['seed'] or payload.get('world_name')!=world_name or len(rows)!=4:return False
        if {r['model'] for r in rows}!={e['model'] for e in expected}:return False
        if observed_after is not None and not (float(payload['recorded_at'])>=observed_after):return False
        targets={e['model']:e for e in expected}
        for row in rows:
            target=targets[row['model']]
            if row.get('label')!=target['label'] or row.get('world_name')!=world_name:return False
            if not poses_match(row.get('requested_pose'),target['pose']):return False
            if observed_after is not None and not (float(row['completed_at'])>=observed_after):return False
            if creation_acknowledged(row.get('returncode'),row.get('gazebo_response')):continue
            verification=row.get('verification') or {}
            if observed_after is not None and not (float(verification['observed_at'])>=observed_after):return False
            actual=parse_entity_observation(verification.get('raw_stdout'),verification.get('returncode'),row['model'],world_name,target['pose'])
            if actual['status']!='EXISTS_AT_EXPECTED_POSE':return False
        return True
    except (AssertionError,KeyError,TypeError,ValueError,OverflowError):return False

def create_model_verified(model,label,pose,sdf,world,run=subprocess.run,sleep=time.sleep,now=time.time,max_attempts=3):
    """Never retry creation unless a real state read has confirmed absence."""
    sdf=Path(sdf).resolve()
    if not sdf.is_relative_to(ROOT):raise ValueError('OBJECT_SDF_OUTSIDE_WORKSPACE')
    if not re.fullmatch(r'[A-Za-z0-9_-]+',model) or not re.fullmatch(r'[A-Za-z0-9_-]+',world):raise ValueError('UNSAFE_GAZEBO_ID')
    if not 1<=max_attempts<=3:raise ValueError('INVALID_RETRY_BOUND')
    record={'model':model,'label':label,'world_name':world,'requested_pose':dict(pose),
            'gazebo_response':'','returncode':None,'attempts':[],'spawn_verified':False}
    def call(args,timeout):
        try:
            out=run([str(GZ),*args],cwd=ROOT,capture_output=True,text=True,timeout=timeout)
            return {'returncode':out.returncode,'stdout':out.stdout,'stderr':out.stderr}
        except subprocess.TimeoutExpired as error:
            text=lambda value:value.decode(errors='replace') if isinstance(value,bytes) else value or ''
            return {'returncode':None,'stdout':text(error.stdout),'stderr':text(error.stderr),'error':'TimeoutExpired'}
        except OSError as error:
            return {'returncode':None,'stdout':'','stderr':str(error),'error':type(error).__name__}
    for attempt in range(max_attempts):
        create=call(['service','-s',f'/world/{world}/create','--reqtype','gz.msgs.EntityFactory','--reptype','gz.msgs.Boolean','--timeout','4000','--req',f'sdf_filename: "{sdf}"'],6)
        evidence={'create':create,'read_only_observations':[]}
        record['attempts'].append(evidence)
        record.update(gazebo_response=create['stdout'],returncode=create['returncode'])
        if creation_acknowledged(create['returncode'],create['stdout']):
            record.update(spawn_verified=True,verification={'status':'CREATED_ACKNOWLEDGED','source':'Gazebo EntityFactory raw Boolean response'})
            break
        for probe in range(2):
            observed=call(['model','-m',model,'-p'],6)
            verification={**parse_entity_observation(observed['stdout'],observed['returncode'],model,world,pose),
                          'raw_stdout':observed['stdout'],'raw_stderr':observed['stderr'],
                          'returncode':observed['returncode'],'observed_at':now()}
            evidence['read_only_observations'].append(verification)
            record['verification']=verification
            if verification['status']!='UNKNOWN':break
            if probe==0:sleep(.2)
        if verification['status']=='EXISTS_AT_EXPECTED_POSE':
            record['spawn_verified']=True
            break
        if verification['status']!='MISSING':
            # Unknown transport state or an existing different entity/pose is
            # never permission to duplicate, remove, relocate or overwrite it.
            break
        if attempt+1<max_attempts:sleep(.4)
    record['completed_at']=now()
    return record
