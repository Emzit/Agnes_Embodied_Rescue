"""Geometry/cell regression: no synthetic navigation success."""
import importlib.util,math,unittest,uuid
from pathlib import Path
ROOT=Path('/data-ssd/zhongchengkai/agnes')
spec=importlib.util.spec_from_file_location('raster_importer',ROOT/'scripts/map-import/map_import.py');imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
class RasterTests(unittest.TestCase):
 def render(self,walls,doors=None,obstacles=None):
  s={"boundary":{"min_x":0,"max_x":10,"min_y":0,"max_y":10},"optional_navigation_constraints":{"resolution":.05},"walls":walls,"doors":doors or [],"static_obstacles":obstacles or []}
  out=ROOT/'artifacts/runtime-diagnostics-20261014/navigation-camera/raster-unit-tests'/uuid.uuid4().hex;out.mkdir(parents=True);imp.pgm(s,out)
  header,pixels=(out/'map.pgm').read_bytes().split(b'\n255\n',1);w,h=map(int,header.splitlines()[1].split());self.assertEqual((w,h),(200,200))
  return lambda x,y:pixels[(h-1-math.floor(y/.05))*w+math.floor(x/.05)]==0
 def test_doorway_endpoints_match_collision_wall(self):
  occ=self.render([{"id":"wall","a":[4.5,3.8],"b":[4.5,8],"thickness":.15}],[{"at":[4.5,5.7],"width":1.25}])
  self.assertTrue(occ(4.5,5.05));self.assertFalse(occ(4.5,5.125));self.assertFalse(occ(4.5,5.7));self.assertTrue(occ(4.5,6.35))
 def test_wall_thickness_and_diagonal_have_no_physical_holes(self):
  occ=self.render([{"id":"diagonal","a":[1,1],"b":[5,5],"thickness":.15}])
  for k in range(1,80):
   u=k/20
   for across in [-.07,0,.07]:self.assertTrue(occ(1+u-across/math.sqrt(2),1+u+across/math.sqrt(2)))
  self.assertFalse(occ(3,3.4))
 def test_furniture_does_not_round_upper_edge_into_next_cell(self):
  occ=self.render([],obstacles=[{"bounds":{"min_x":1,"max_x":2,"min_y":1,"max_y":2}}])
  self.assertTrue(occ(1.99,1.99));self.assertFalse(occ(2.025,1.5))
if __name__=='__main__':unittest.main()
