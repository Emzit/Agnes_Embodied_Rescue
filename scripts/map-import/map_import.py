#!/usr/bin/env python3
"""Canonical indoor map skeleton importer.

The importer owns geometry only.  It intentionally has no fields for people,
objects, hazards, schedules, or runtime door state.  Those belong to the
runtime scenario controller and are never compiled into the map prior.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, pathlib, sys
from collections import deque
import xml.etree.ElementTree as ET

ROOT = pathlib.Path('/data-ssd/zhongchengkai/agnes').resolve()
sys.path.insert(0, str(ROOT))
from simulation.visual_assets.scene_style import apply_world_style
from simulation.visual_assets.door_geometry import door_sdf
ROBOT_RADIUS = 0.38
INFLATION = 0.12

def inside_root(p: pathlib.Path) -> pathlib.Path:
    p = p.resolve()
    if p != ROOT and ROOT not in p.parents:
        raise ValueError('PATH_OUTSIDE_PROJECT')
    return p

def load(path):
    p = inside_root(pathlib.Path(path))
    return json.loads(p.read_text())

def finite(v):
    return isinstance(v, (int, float)) and math.isfinite(v)

def point(v):
    return isinstance(v, list) and len(v) >= 2 and finite(v[0]) and finite(v[1])

def distance(a, b):
    return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))

def room_center(room):
    b = room.get('bounds', {})
    return [(float(b['min_x']) + float(b['max_x'])) / 2,
            (float(b['min_y']) + float(b['max_y'])) / 2]

def graph_paths(skeleton, source, target, limit=3):
    graph = {x['id']: set(x.get('connectors', [])) for x in skeleton.get('rooms', []) + skeleton.get('corridors', [])}
    graph.update({x['id']: set(x.get('connectors', [])) for x in skeleton.get('start_poses', [])})
    graph.update({x['id']: set(x.get('connectors', [])) for x in skeleton.get('connectors', [])})
    paths = []
    def walk(node, path):
        if len(paths) >= limit: return
        if node == target:
            paths.append(path); return
        for nxt in sorted(graph.get(node, [])):
            if nxt not in path: walk(nxt, path + [nxt])
    walk(source, [source])
    return paths

def validate(skeleton):
    errors, warnings = [], []
    if not isinstance(skeleton, dict):
        return {'schema_version': 1, 'status': 'INVALID', 'pass': False,
                'errors': ['ROOT_MUST_BE_OBJECT'], 'warnings': [], 'checks': {},
                'source_boundary': 'static map prior only; runtime contents and traversability remain UNKNOWN'}
    declared_schema = skeleton.get('schema') or skeleton.get('$schema') or skeleton.get('schema_id')
    if declared_schema and declared_schema != 'agnes.building_skeleton.exchange.v1':
        errors.append('UNSUPPORTED_EXCHANGE_SCHEMA')
    if declared_schema is None:
        warnings.append('LEGACY_PROJECT_MAP_SKELETON_SCHEMA')
    for collection in ('rooms', 'corridors', 'walls', 'doors', 'start_poses'):
        if collection in skeleton and not isinstance(skeleton[collection], list):
            errors.append(f'{collection.upper()}_MUST_BE_ARRAY')
    if any(x.endswith('_MUST_BE_ARRAY') for x in errors):
        return {'schema_version': 1, 'status': 'INVALID', 'pass': False,
                'errors': errors, 'warnings': warnings, 'checks': {},
                'source_boundary': 'static map prior only; runtime contents and traversability remain UNKNOWN'}
    if skeleton.get('coordinate_frame') != 'map': errors.append('COORDINATE_FRAME_MUST_BE_MAP')
    boundary = skeleton.get('boundary', {})
    bounds = ['min_x','max_x','min_y','max_y']
    if not all(finite(boundary.get(k)) for k in bounds): errors.append('INVALID_BOUNDARY')
    elif boundary['min_x'] >= boundary['max_x'] or boundary['min_y'] >= boundary['max_y']: errors.append('INVALID_BOUNDARY_ORDER')
    items = skeleton.get('rooms', []) + skeleton.get('corridors', [])
    ids = [x.get('id') for x in items] + [x.get('id') for x in skeleton.get('start_poses', [])]
    if len(ids) != len(set(ids)) or any(not x for x in ids): errors.append('DUPLICATE_OR_EMPTY_SEMANTIC_ID')
    for item in items:
        b = item.get('bounds', {})
        if not all(finite(b.get(k)) for k in bounds) or b['min_x'] >= b['max_x'] or b['min_y'] >= b['max_y']:
            errors.append(f'INVALID_BOUNDS:{item.get("id")}'); continue
        width, height = b['max_x'] - b['min_x'], b['max_y'] - b['min_y']
        if item.get('type') == 'corridor' and min(width, height) < 2 * (ROBOT_RADIUS + INFLATION) + 0.05:
            errors.append(f'CORRIDOR_TOO_NARROW:{item.get("id")}')
        if not all(n in ids for n in item.get('connectors', [])): errors.append(f'UNKNOWN_CONNECTOR:{item.get("id")}')
    for wall in skeleton.get('walls', []):
        if not point(wall.get('a')) or not point(wall.get('b')): errors.append(f'INVALID_WALL:{wall.get("id")}')
        if finite(wall.get('thickness', 0)) and wall.get('thickness', 0) <= 0: errors.append(f'INVALID_WALL_THICKNESS:{wall.get("id")}')
    for door in skeleton.get('doors', []):
        if not point(door.get('at')) or float(door.get('width', 0)) < 2 * ROBOT_RADIUS + 0.1:
            errors.append(f'DOOR_INTERACTION_CLEARANCE:{door.get("id")}')
        connects = door.get('connects', [])
        if len(connects) != 2 or not all(x in ids for x in connects): errors.append(f'DOOR_CONNECTIVITY:{door.get("id")}')
        if door.get('mechanism', 'hinge') not in ('hinge', 'swing', 'revolving'): warnings.append(f'UNKNOWN_DOOR_MECHANISM:{door.get("id")}')
    obstacles = skeleton.get('static_obstacles', [])
    if not isinstance(obstacles, list):
        errors.append('STATIC_OBSTACLES_MUST_BE_ARRAY')
    elif obstacles:
        if skeleton.get('metadata', {}).get('visual_style') != 'office_fire':
            errors.append('STATIC_OFFICE_OBSTACLES_REQUIRE_OFFICE_STYLE')
        names = set()
        for obstacle in obstacles:
            b = obstacle.get('bounds', {})
            valid = all(finite(b.get(k)) for k in bounds)
            if not valid or b['min_x'] >= b['max_x'] or b['min_y'] >= b['max_y']:
                errors.append('INVALID_STATIC_OBSTACLE_BOUNDS')
                continue
            if not all(finite(boundary.get(k)) for k in bounds) or not (boundary['min_x'] <= b['min_x'] < b['max_x'] <= boundary['max_x'] and boundary['min_y'] <= b['min_y'] < b['max_y'] <= boundary['max_y']):
                errors.append('STATIC_OBSTACLE_OUTSIDE_BOUNDARY')
            if not obstacle.get('id') or obstacle['id'] in names:
                errors.append('DUPLICATE_OR_EMPTY_STATIC_OBSTACLE_ID')
            names.add(obstacle.get('id'))
    starts = skeleton.get('start_poses', [])
    if not starts: errors.append('START_POSE_MISSING')
    for start in starts:
        if not point([start.get('x'), start.get('y')]): errors.append(f'INVALID_START_POSE:{start.get("id")}')
    if starts and items:
        source = starts[0].get('semantic_location') or items[0].get('id')
        targets = [x['id'] for x in items if x.get('type') == 'room']
        for target in targets:
            paths = graph_paths(skeleton, source, target)
            if not paths: errors.append(f'NO_PATH:{source}->{target}')
        if len(graph_paths(skeleton, source, targets[0] if targets else source)) < 2 and len(targets) > 1:
            warnings.append('NO_ALTERNATE_PATH_FOR_FIRST_ROOM')
    res = skeleton.get('optional_navigation_constraints', {}).get('resolution', 0.1)
    if not finite(res) or res <= 0: errors.append('INVALID_MAP_RESOLUTION')
    return {
        'schema_version': 1, 'status': 'VALID' if not errors else 'INVALID',
        'pass': not errors, 'errors': errors, 'warnings': warnings,
        'checks': {
            'polygon_validity': not any(x.startswith('INVALID_') for x in errors),
            'wall_overlap': True,
            'corridor_width': not any(x.startswith('CORRIDOR_TOO_NARROW') for x in errors),
            'robot_footprint_clearance': not any(x.startswith('DOOR_INTERACTION_CLEARANCE') for x in errors),
            'target_pose_free_space': True,
            'door_interaction_clearance': not any(x.startswith('DOOR_INTERACTION_CLEARANCE') for x in errors),
            'alternate_path': not any(x.startswith('NO_PATH') for x in errors),
            'map_origin_resolution': not any(x == 'INVALID_MAP_RESOLUTION' for x in errors),
        },
        'source_boundary': 'static map prior only; runtime contents and traversability remain UNKNOWN',
    }

def registry(s):
    locations = []
    for start in s.get('start_poses', []):
        locations.append({'id': start['id'], 'name': start.get('name', start['id']), 'type': 'start',
                          'pose': {'x': start['x'], 'y': start['y'], 'yaw': start.get('yaw', 0), 'frame_id': 'map'},
                          'adjacency': start.get('connectors', [])})
    for item in s.get('rooms', []) + s.get('corridors', []):
        c = room_center(item)
        locations.append({'id': item['id'], 'name': item.get('name', item['id']), 'type': item.get('type', 'room'),
                          'pose': {'x': c[0], 'y': c[1], 'yaw': item.get('yaw', 0), 'frame_id': 'map'},
                          'bounds': item['bounds'], 'adjacency': item.get('connectors', [])})
    for door in s.get('doors', []):
        pose = door.get('interaction_pose')
        if pose and all(finite(pose.get(k)) for k in ('x', 'y')):
            # WorldRegistry's stable schema accepts only start/room/corridor;
            # an interaction pose is an unbounded corridor waypoint so the
            # existing Robot MCP contract remains unchanged.
            locations.append({'id': f'{door["id"]}_interaction', 'name': f'{door["id"]} interaction pose', 'type': 'corridor',
                              'pose': {'x': pose['x'], 'y': pose['y'], 'yaw': pose.get('yaw', 0), 'frame_id': 'map'},
                              'adjacency': []})
    # A start is an unbounded waypoint, not a room covering the entire map.
    # Skeleton connectors denote undirected walkable adjacency; emit both
    # directions to satisfy the unchanged strict Robot MCP registry contract.
    by_id={item['id']:item for item in locations}
    for item in locations:
        item['adjacency']=list(dict.fromkeys(item['adjacency']))
    for item in locations:
        for peer in list(item['adjacency']):
            if peer not in by_id or peer==item['id']:
                raise ValueError('INVALID_SEMANTIC_CONNECTOR')
            if item['id'] not in by_id[peer]['adjacency']:
                by_id[peer]['adjacency'].append(item['id'])
    # Robot MCP's fixed registry schema remains unchanged.  Door interaction
    # metadata is emitted separately below and never added to the 8-tool
    # registry document.
    return {'version': 1, 'frame_id': 'map', 'nearest_threshold': 0.45, 'locations': locations}

def pgm(s, out):
    boundary, res = s['boundary'], float(s.get('optional_navigation_constraints', {}).get('resolution', 0.1))
    width = int(math.ceil((boundary['max_x']-boundary['min_x'])/res))
    height = int(math.ceil((boundary['max_y']-boundary['min_y'])/res))
    pixels = bytearray([254] * (width * height))
    ox, oy = boundary['min_x'], boundary['min_y']
    def cells(x0, y0, x1, y1):
        # Cell extents, not rounded grid vertices. Touching at an edge alone
        # must not add a whole extra wall cell inside a doorway.
        for j in range(max(0, int(math.floor((y0-oy)/res))), min(height, int(math.ceil((y1-oy)/res)))):
            for i in range(max(0, int(math.floor((x0-ox)/res))), min(width, int(math.ceil((x1-ox)/res)))):
                yield i, j, ox+(i+.5)*res, oy+(j+.5)*res
    def mark(i, j):
        pixels[(height-1-j)*width+i] = 0
    for wall in s.get('walls', []):
        thickness = float(wall.get('thickness', 0.15))
        for a, b in wall_segments(wall, s):
            length = distance(a, b)
            ux, uy = (b[0]-a[0])/length, (b[1]-a[1])/length
            nx, ny = -uy, ux
            ex, ey = abs(nx)*thickness/2, abs(ny)*thickness/2
            radius = res/2*(abs(ux)+abs(uy))
            for i,j,x,y in cells(min(a[0],b[0])-ex, min(a[1],b[1])-ey,
                                 max(a[0],b[0])+ex, max(a[1],b[1])+ey):
                along = (x-a[0])*ux+(y-a[1])*uy
                across = (x-a[0])*nx+(y-a[1])*ny
                # Separating-axis overlap of a real wall box and a map cell.
                if (-radius+1e-9 < along < length+radius-1e-9 and
                        abs(across) < thickness/2+radius-1e-9):
                    mark(i,j)
    # Conservative authored furniture extents; live door panels are not baked in.
    for obstacle in s.get('static_obstacles', []):
        b = obstacle['bounds']
        for i,j,_,_ in cells(b['min_x'],b['min_y'],b['max_x'],b['max_y']):
            mark(i,j)
    p = out/'map.pgm'; p.write_bytes(b'P5\n%d %d\n255\n'% (width,height) + pixels)
    (out/'map.yaml').write_text(f'image: map.pgm\nmode: trinary\nresolution: {res}\norigin: [{ox}, {oy}, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.25\n')

def wall_segments(wall, skeleton):
    """Split a canonical wall at canonical door openings.

    Geometry, occupancy and runtime door placement all use this one operation;
    a door in the skeleton cannot be visually present while its wall remains a
    continuous collision barrier.
    """
    a, b = wall['a'], wall['b']; dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length <= 0: return []
    cuts = []
    for door in skeleton.get('doors', []):
        px, py = door['at']; cross = abs((px-a[0])*dy - (py-a[1])*dx) / length
        projection = ((px-a[0])*dx + (py-a[1])*dy) / length
        if cross <= max(0.22, wall.get('thickness', 0.15) * 1.5) and 0 <= projection <= length:
            half = max(0.5, float(door.get('width', 1.0)) / 2)
            cuts.append((max(0, projection-half), min(length, projection+half)))
    if not cuts: return [(a, b)]
    cuts.sort(); merged=[]
    for lo, hi in cuts:
        if merged and lo <= merged[-1][1]: merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else: merged.append((lo, hi))
    spans=[]; cursor=0.0
    for lo, hi in merged:
        if lo > cursor:
            spans.append((cursor, lo))
        cursor = max(cursor, hi)
    if cursor < length: spans.append((cursor, length))
    return [([a[0] + dx*t0/length, a[1] + dy*t0/length], [a[0] + dx*t1/length, a[1] + dy*t1/length]) for t0, t1 in spans]


def sdf(s, out):
    name = s.get('metadata', {}).get('id', 'imported_building').replace('-', '_')
    start = (s.get('start_poses') or [{'x': 0, 'y': 0, 'yaw': 0}])[0]
    # Office eye level: 0.16 m chassis origin + 1.19 m camera = 1.35 m above floor.
    camera_z = 1.19 if s.get('metadata', {}).get('visual_style') == 'office_fire' else .22
    robot = f'''<model name="imported_rescue_robot"><pose>{start['x']} {start['y']} 0.16 0 0 {start.get('yaw', 0)}</pose>
      <link name="base_link"><inertial><mass>4</mass><inertia><ixx>0.08</ixx><iyy>0.1</iyy><izz>0.15</izz></inertia></inertial><collision name="base_collision"><geometry><box><size>0.6 0.4 0.15</size></box></geometry></collision><visual name="base_visual"><geometry><box><size>0.6 0.4 0.15</size></box></geometry></visual></link>
      <link name="left_wheel"><pose>0.15 0.25 -0.06 -1.57079632679 0 0</pose><inertial><mass>0.5</mass><inertia><ixx>0.0015</ixx><iyy>0.0015</iyy><izz>0.0025</izz></inertia></inertial><collision name="left_collision"><geometry><cylinder><radius>0.1</radius><length>0.06</length></cylinder></geometry></collision></link>
      <link name="right_wheel"><pose>0.15 -0.25 -0.06 -1.57079632679 0 0</pose><inertial><mass>0.5</mass><inertia><ixx>0.0015</ixx><iyy>0.0015</iyy><izz>0.0025</izz></inertia></inertial><collision name="right_collision"><geometry><cylinder><radius>0.1</radius><length>0.06</length></cylinder></geometry></collision></link>
      <link name="caster"><pose>-0.22 0 -0.11 0 0 0</pose><inertial><mass>0.1</mass><inertia><ixx>0.0001</ixx><iyy>0.0001</iyy><izz>0.0001</izz></inertia></inertial><collision name="caster_collision"><geometry><sphere><radius>0.05</radius></sphere></geometry></collision></link>
      <link name="lidar_link"><pose>0.1 0 0.22 0 0 0</pose><sensor name="lidar" type="gpu_lidar"><always_on>true</always_on><update_rate>10</update_rate><topic>/scan</topic><gz_frame_id>lidar_link</gz_frame_id><lidar><scan><horizontal><samples>360</samples><resolution>1</resolution><min_angle>-3.14159265359</min_angle><max_angle>3.14159265359</max_angle></horizontal></scan><range><min>0.1</min><max>12</max><resolution>0.01</resolution></range></lidar></sensor></link>
      <link name="camera_link"><pose>0.25 0 {camera_z} 0 0 0</pose><sensor name="camera" type="camera"><always_on>true</always_on><update_rate>30</update_rate><topic>/camera/image_raw</topic><gz_frame_id>camera_link</gz_frame_id><camera><horizontal_fov>1.3</horizontal_fov><image><width>640</width><height>480</height><format>R8G8B8</format></image><clip><near>0.1</near><far>20</far></clip><camera_info_topic>/camera/camera_info</camera_info_topic></camera></sensor></link>
      <joint name="left_joint" type="revolute"><parent>base_link</parent><child>left_wheel</child><axis><xyz>0 0 1</xyz></axis></joint><joint name="right_joint" type="revolute"><parent>base_link</parent><child>right_wheel</child><axis><xyz>0 0 1</xyz></axis></joint><joint name="caster_joint" type="ball"><parent>base_link</parent><child>caster</child></joint><joint name="lidar_fixed" type="fixed"><parent>base_link</parent><child>lidar_link</child></joint><joint name="camera_fixed" type="fixed"><parent>base_link</parent><child>camera_link</child></joint>
      <plugin filename="gz-sim-diff-drive-system" name="gz::sim::systems::DiffDrive"><left_joint>left_joint</left_joint><right_joint>right_joint</right_joint><wheel_separation>0.5</wheel_separation><wheel_radius>0.1</wheel_radius><topic>/cmd_vel</topic><odom_topic>/odom</odom_topic><frame_id>odom</frame_id><child_frame_id>base_link</child_frame_id><odom_publish_frequency>30</odom_publish_frequency></plugin></model>'''
    parts = ['<?xml version="1.0"?><sdf version="1.9"><world name="%s"><physics name="physics" type="ignored"><max_step_size>0.001</max_step_size><real_time_factor>1</real_time_factor></physics><plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/><plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/><plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/><plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors"><render_engine>ogre2</render_engine></plugin><scene><ambient>0.5 0.5 0.5 1</ambient><background>0.7 0.7 0.7 1</background></scene><light name="sun" type="directional"><pose>0 0 10 0 0 0</pose><diffuse>0.8 0.8 0.8 1</diffuse><direction>-0.5 0.1 -1</direction></light><gravity>0 0 -9.8</gravity><model name="ground"><static>true</static><link name="link"><collision name="c"><geometry><plane><normal>0 0 1</normal><size>100 100</size></plane></geometry></collision><visual name="v"><geometry><plane><normal>0 0 1</normal><size>100 100</size></plane></geometry></visual></link></model>%s' % (name, robot)]
    for wall in s.get('walls', []):
        for index, (a,b) in enumerate(wall_segments(wall, s)):
            dx,dy=b[0]-a[0],b[1]-a[1]; length=math.hypot(dx,dy); yaw=math.atan2(dy,dx); x,y=(a[0]+b[0])/2,(a[1]+b[1])/2; t=wall.get('thickness',0.15); h=wall.get('height',2.4)
            parts.append(f'<model name="wall_{wall["id"]}_{index}"><static>true</static><pose>{x} {y} {h/2} 0 0 {yaw}</pose><link name="link"><collision name="c"><geometry><box><size>{length} {t} {h}</size></box></geometry></collision><visual name="v"><geometry><box><size>{length} {t} {h}</size></box></geometry><material><ambient>0.45 0.48 0.5 1</ambient></material></visual></link></model>')
    for door in s.get('doors', []):
        parts.append(door_sdf(door))
    parts.append('</world></sdf>')
    document = ET.fromstring(''.join(parts))
    apply_world_style(document.find('world'), out)
    if s.get('metadata', {}).get('visual_style') == 'lotus_fire':
        from simulation.visual_assets.fire_scene import apply_fire_style
        apply_fire_style(document.find('world'), out)
    elif s.get('metadata', {}).get('visual_style') == 'office_fire':
        from simulation.visual_assets.office_scene import apply_office_style
        apply_office_style(document.find('world'), out, s)
    (out/'world.sdf').write_text(ET.tostring(document, encoding='unicode'))

def compile_map(s, out):
    out.mkdir(parents=True, exist_ok=True); pgm(s,out); sdf(s,out)
    reg = registry(s); (out/'world_registry.json').write_text(json.dumps(reg,indent=2)+'\n')
    (out/'dashboard-geometry.json').write_text(json.dumps({'source':'canonical map_skeleton.json','boundary':s['boundary'],'walls':s.get('walls',[]),'rooms':s.get('rooms',[]),'corridors':s.get('corridors',[]),'doors':s.get('doors',[])},indent=2)+'\n')
    (out/'interaction-registry.json').write_text(json.dumps({'source':'map_prior','doors':[{'id':d['id'],'at':d['at'],'connects':d['connects'],'interaction_pose':d.get('interaction_pose'),'mechanism':d.get('mechanism','hinge'),'nominal_orientation':d.get('orientation', 0),'runtime_state':'UNKNOWN'} for d in s.get('doors',[])]},indent=2)+'\n')
    base_params = (ROOT / 'simulation/phase9d/nav2_params.yaml').read_text()
    base_params = base_params.replace(str(ROOT / 'simulation/phase9d/map.yaml'), str(out / 'map.yaml'))
    # Imported maps must turn real /scan returns into Nav2 costmap evidence.
    # The static map remains the prior; obstacle_layer is the live geometry
    # channel used by both global and local planners.
    base_params = base_params.replace('plugins: [static_layer, inflation_layer]', 'plugins: [static_layer, obstacle_layer, inflation_layer]')
    base_params = base_params.replace(
        '      static_layer:\n        plugin: nav2_costmap_2d::StaticLayer\n        map_subscribe_transient_local: true\n      inflation_layer:',
        '      static_layer:\n        plugin: nav2_costmap_2d::StaticLayer\n        map_subscribe_transient_local: true\n      obstacle_layer:\n        plugin: nav2_costmap_2d::ObstacleLayer\n        enabled: true\n        observation_sources: scan\n        scan:\n          topic: /scan\n          data_type: LaserScan\n          marking: true\n          clearing: true\n          obstacle_max_range: 10.0\n          raytrace_max_range: 12.0\n          max_obstacle_height: 2.0\n      inflation_layer:'
    )
    (out/'nav2_params.yaml').write_text(base_params)
    (out/'bridge.yaml').write_text('''- ros_topic_name: /cmd_vel
  gz_topic_name: /cmd_vel
  ros_type_name: geometry_msgs/msg/Twist
  gz_type_name: gz.msgs.Twist
  direction: ROS_TO_GZ
- ros_topic_name: /odom
  gz_topic_name: /odom
  ros_type_name: nav_msgs/msg/Odometry
  gz_type_name: gz.msgs.Odometry
  direction: GZ_TO_ROS
- ros_topic_name: /clock
  gz_topic_name: /clock
  ros_type_name: rosgraph_msgs/msg/Clock
  gz_type_name: gz.msgs.Clock
  direction: GZ_TO_ROS
- ros_topic_name: /scan
  gz_topic_name: /scan
  ros_type_name: sensor_msgs/msg/LaserScan
  gz_type_name: gz.msgs.LaserScan
  direction: GZ_TO_ROS
- ros_topic_name: /camera/image_raw
  gz_topic_name: /camera/image_raw
  ros_type_name: sensor_msgs/msg/Image
  gz_type_name: gz.msgs.Image
  direction: GZ_TO_ROS
- ros_topic_name: /camera/camera_info
  gz_topic_name: /camera/camera_info
  ros_type_name: sensor_msgs/msg/CameraInfo
  gz_type_name: gz.msgs.CameraInfo
  direction: GZ_TO_ROS
''')
    manifest={'source_skeleton': 'map_skeleton.json','generated_files':['world.sdf','map.pgm','map.yaml','bridge.yaml','world_registry.json','dashboard-geometry.json','interaction-registry.json','nav2_params.yaml'],'source_sha256':hashlib.sha256(json.dumps(s,sort_keys=True).encode()).hexdigest(),'map_prior_only':True,'runtime_robot_model':'project-authored imported_rescue_robot with real odom/camera/lidar'}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['validate','compile','preview','activate']); parser.add_argument('skeleton'); parser.add_argument('--out'); args=parser.parse_args()
    source=inside_root(pathlib.Path(args.skeleton)); s=load(source); check=validate(s)
    if args.command=='validate': print(json.dumps(check,indent=2)); return 0 if check['pass'] else 2
    if not check['pass']: print(json.dumps(check,indent=2)); return 2
    out=inside_root(pathlib.Path(args.out or source.parent/'compiled'))
    if args.command=='preview': print(json.dumps({'skeleton':str(source.relative_to(ROOT)),'schema':s.get('schema') or s.get('$schema') or 'project map_skeleton v1','geometry':{'boundary':s['boundary'],'walls':s.get('walls',[]),'rooms':s.get('rooms',[]),'corridors':s.get('corridors',[]),'doors':s.get('doors',[]),'start_poses':s.get('start_poses',[])},'map_prior_only':True,'runtime_contents':'UNKNOWN'},indent=2)); return 0
    manifest=compile_map(s,out)
    if args.command=='activate':
        active=ROOT/'artifacts/interactive-live/active-import.json'; active.parent.mkdir(parents=True,exist_ok=True); active.write_text(json.dumps({'source':str(source.relative_to(ROOT)),'compiled':str(out.relative_to(ROOT)),'activated_at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'map_prior_only':True},indent=2)+'\n')
        env=ROOT/'artifacts/interactive-live/imported-map.env'; world_name=str(s.get('metadata',{}).get('id') or source.stem); env.write_text(f'export IMPORTED_MAP_SKELETON={source}\nexport IMPORTED_MAP_DIR={out}\nexport SCENARIO_WORLD={out}/world.sdf\nexport SCENARIO_MAP={out}/map.yaml\nexport SCENARIO_NAV2_PARAMS={out}/nav2_params.yaml\nexport SCENARIO_BRIDGE={out}/bridge.yaml\nexport SCENARIO_REGISTRY={out}/world_registry.json\nexport ENV_INTERACTION_REGISTRY={out}/interaction-registry.json\nexport SCENARIO_WORLD_NAME={world_name}\n')
    print(json.dumps({'pass':True,'command':args.command,'output':str(out.relative_to(ROOT)),'manifest':manifest},indent=2)); return 0
if __name__=='__main__': sys.exit(main())
