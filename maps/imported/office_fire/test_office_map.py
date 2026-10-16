"""Office layout checks using the actual importer occupancy and registry."""
import collections
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

ROOT = Path('/data-ssd/zhongchengkai/agnes')
MODULE = ROOT / 'scripts/map-import/map_import.py'
spec = importlib.util.spec_from_file_location('office_map_importer', MODULE)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
SOURCE = ROOT / 'maps/imported/office_fire/office_skeleton.json'


class OfficeMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads(SOURCE.read_text())
        out = ROOT / 'artifacts/indoor-fire-20261012/map-tests'
        out.mkdir(parents=True, exist_ok=True)
        cls.tmp = tempfile.TemporaryDirectory(prefix='geometry-', dir=out)
        cls.output = Path(cls.tmp.name)
        importer.pgm(cls.source, cls.output)
        header, dimensions, maximum, pixels = (cls.output / 'map.pgm').read_bytes().split(b'\n', 3)
        assert header == b'P5' and maximum == b'255'
        cls.width, cls.height = map(int, dimensions.split())
        cls.pixels = pixels
        cls.registry = importer.registry(cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def cell(self, point):
        return (round((point['x'] + 9) / .1), self.height - 1 - round((point['y'] + 8) / .1))

    def test_schema_and_four_closed_rooms(self):
        self.assertTrue(importer.validate(self.source)['pass'])
        self.assertEqual(len(self.source['rooms']), 4)
        self.assertEqual(len(self.source['doors']), 4)
        self.assertTrue(all(d['initial_state'] == 'CLOSED' and d['mechanism'] == 'hinge' for d in self.source['doors']))
        self.assertTrue(all(len(r['connectors']) == 1 for r in self.source['rooms']))

    def test_spawn_and_relative_layout(self):
        spawn = self.source['start_poses'][0]
        self.assertEqual((spawn['x'], spawn['y']), (0, -6.7))
        self.assertAlmostEqual(spawn['yaw'], math.pi / 2)
        rooms = {r['id']: r['bounds'] for r in self.source['rooms']}
        self.assertGreater(rooms['Large_Room']['min_y'], spawn['y'])
        for name in ['Right_Near_Room', 'Right_Middle_Room', 'Right_Front_Room']:
            self.assertGreater(rooms[name]['min_x'], spawn['x'])
        self.assertLess(rooms['Right_Near_Room']['max_y'], rooms['Right_Middle_Room']['max_y'])
        self.assertLess(rooms['Right_Middle_Room']['max_y'], rooms['Right_Front_Room']['min_y'])

    def test_outer_enclosure_and_door_holes(self):
        outer = [w for w in self.source['walls'] if w['id'].startswith('outer_')]
        self.assertEqual(len(outer), 4)
        self.assertTrue(all(w['height'] == 2.8 for w in self.source['walls']))
        segments = [(w, importer.wall_segments(w, self.source)) for w in self.source['walls']]
        self.assertEqual(sum(len(parts) == 2 for _, parts in segments), 4)
        for door in self.source['doors']:
            matches = []
            x, y = door['at']
            for wall, parts in segments:
                if len(parts) != 2:
                    continue
                a, b = wall['a'], wall['b']
                if abs((x-a[0])*(b[1]-a[1]) - (y-a[1])*(b[0]-a[0])) < 1e-6:
                    if min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= y <= max(a[1], b[1]):
                        matches.append(wall)
            self.assertEqual(len(matches), 1, door['id'])

    def test_furniture_in_three_rows_to_left(self):
        furniture = self.source['static_obstacles']
        self.assertEqual(len(furniture), 6)
        expected = [(x, y) for y in [-4.5, -1.9, .7] for x in [-6.6, -4.4]]
        for item, (x, y) in zip(furniture, expected):
            self.assertEqual(item['bounds'], dict(min_x=round(x-.9, 3), max_x=round(x+.9, 3), min_y=round(y-1.12, 3), max_y=round(y+.43, 3)))
            i, j = self.cell(dict(x=x, y=y))
            self.assertLess(self.pixels[j * self.width + i], 127)
            self.assertLess(item['bounds']['max_x'], -3)

    def test_every_semantic_pose_reachable_in_inflated_static_prior(self):
        occupied = {(i, j) for j in range(self.height) for i in range(self.width) if self.pixels[j*self.width+i] < 127}
        inflated = {(i+dx, j+dy) for i, j in occupied for dx in range(-4, 5) for dy in range(-4, 5) if dx*dx+dy*dy <= 16}
        def free(c):
            i, j = c
            return 0 <= i < self.width and 0 <= j < self.height and c not in inflated
        by_id = {x['id']: x for x in self.registry['locations']}
        start = self.cell(by_id['Start']['pose'])
        self.assertTrue(free(start))
        queue, seen = collections.deque([start]), {start}
        while queue:
            i, j = queue.popleft()
            for nxt in ((i-1, j), (i+1, j), (i, j-1), (i, j+1)):
                if nxt not in seen and free(nxt):
                    seen.add(nxt)
                    queue.append(nxt)
        for loc in self.registry['locations']:
            self.assertIn(self.cell(loc['pose']), seen, loc['id'])

    def test_alternate_route_is_only_in_open_lobby(self):
        paths = importer.graph_paths(self.source, 'Large_Room', 'Right_Near_Room')
        self.assertGreaterEqual(len(paths), 2)
        for route in paths:
            self.assertEqual(route[:2], ['Large_Room', 'Cross_Hall'])
            self.assertEqual(route[-2:], ['Entry_Hall', 'Right_Near_Room'])


if __name__ == '__main__':
    unittest.main()
