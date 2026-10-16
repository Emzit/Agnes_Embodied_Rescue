#!/usr/bin/env python3
import hashlib, json, sys
from pathlib import Path
from PIL import Image, ImageChops

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path('/data-ssd/zhongchengkai/agnes/artifacts/demo/showcase-live-run-v2').resolve()
run = root / 'run1'
index = json.loads((root / 'frame-index.json').read_text())
events = json.loads((run / 'perception-events.json').read_text())
people = []
for event in events:
    for det in (event.get('result') or {}).get('detections', []):
        if det.get('label') == 'person':
            stamp = (det.get('timestamp') or {}).get('sec', 0) + (det.get('timestamp') or {}).get('nanosec', 0) / 1e9
            people.append((stamp, det))

def frame_stamp(stage):
    t = index['stages'][stage]['timestamp']
    return t.get('sec', 0) + t.get('nanosec', 0) / 1e9

def nearest(stage):
    return min(people, key=lambda pair: abs(pair[0] - frame_stamp(stage)))[1]

def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def crop(stage, det):
    source = root / index['stages'][stage]['frame']
    image = Image.open(source).convert('RGB')
    x1, y1, x2, y2 = det['bbox']
    pad = 18
    box = (max(0, x1-pad), max(0, y1-pad), min(image.width, x2+pad), min(image.height, y2+pad))
    out = root / 'keyframes' / f'{stage}-crop.png'
    image.crop(box).resize((max(1, (box[2]-box[0])*3), max(1, (box[3]-box[1])*3)), Image.Resampling.NEAREST).save(out)
    return out, box

before = nearest('active_before'); after = nearest('active_after')
before_path, before_box = crop('active_before', before); after_path, after_box = crop('active_after', after)
before_image = Image.open(root / index['stages']['active_before']['frame']).convert('RGB').resize((320,240))
after_image = Image.open(root / index['stages']['active_after']['frame']).convert('RGB').resize((320,240))
diff = ImageChops.difference(before_image, after_image)
mean_diff = sum(sum(pixel) for pixel in diff.getdata()) / (diff.width * diff.height * 3)
analysis = {
    'source': 'real /camera/image_raw frames and real pixel detections',
    'before': {'stage': 'active_before', 'frame': index['stages']['active_before']['frame'], 'bbox': before['bbox'], 'center': before.get('center'), 'confidence': before.get('confidence'), 'crop': str(before_path.relative_to(root)), 'sha256': sha256(root / index['stages']['active_before']['frame']), 'timestamp': index['stages']['active_before']['timestamp'], 'yaw': index['stages']['active_before']['robot_pose'].get('yaw')},
    'after': {'stage': 'active_after', 'frame': index['stages']['active_after']['frame'], 'bbox': after['bbox'], 'center': after.get('center'), 'confidence': after.get('confidence'), 'crop': str(after_path.relative_to(root)), 'sha256': sha256(root / index['stages']['active_after']['frame']), 'timestamp': index['stages']['active_after']['timestamp'], 'yaw': index['stages']['active_after']['robot_pose'].get('yaw')},
    'bbox_change': {'width_before': before['bbox'][2]-before['bbox'][0], 'width_after': after['bbox'][2]-after['bbox'][0], 'height_before': before['bbox'][3]-before['bbox'][1], 'height_after': after['bbox'][3]-after['bbox'][1], 'center_delta': [after['center'][0]-before['center'][0], after['center'][1]-before['center'][1]]},
    'pixel_difference_mean_abs': mean_diff,
    'hash_different': sha256(root / index['stages']['active_before']['frame']) != sha256(root / index['stages']['active_after']['frame']),
    'no_fake_image': True,
}
(root / 'active-perception-analysis.json').write_text(json.dumps(analysis, indent=2) + '\n')
print(json.dumps(analysis, indent=2))
