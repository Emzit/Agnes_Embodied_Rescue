import copy,sys,unittest,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"ros2_bridge"))
from doorway_navigation import plan_doorway_route,DoorwayRouteError
class DoorwayTests(unittest.TestCase):
 def setUp(self):
  self.g={"doors":[{"id":"FrontDoor","at":[4.5,5.7],"width":1.25,"connects":["Hall","Room"],"interaction_pose":{"x":3.4,"y":5.7,"yaw":0},"initial_state":"CLOSED"}]}
  self.r={"locations":[{"id":"Room","type":"room","bounds":{"min_x":4.5,"max_x":9,"min_y":3.8,"max_y":8}}, {"id":"Hall","type":"corridor"}]}
  self.t={"x":6.75,"y":5.9,"yaw":0,"frame_id":"map"}
 def route(self,start=None):return plan_doorway_route(self.g,self.r,start or {"x":3,"y":4},"Room",self.t)
 def test_bad_approach_and_open_leaf_are_not_used_as_final_room_goal(self):
  a=self.route({"x":4.413,"y":5.481})
  self.assertEqual([v["stage"]for v in a],["doorway_approach","doorway_center","doorway_inside","target"])
  self.assertEqual((a[1]["pose"]["x"],a[1]["pose"]["y"]),(4.5,5.7))
  self.assertGreater(a[2]["pose"]["x"]-4.5,1.17+.42)
 def test_aligned_robot_does_not_backtrack(self):
  self.assertEqual(self.route({"x":4.3,"y":5.65})[0]["stage"],"doorway_center")
 def test_exit_aligns_before_leaving_room(self):
  a=plan_doorway_route(self.g,self.r,{"x":6.7,"y":5.9},"Hall",{"x":2,"y":2,"yaw":0})
  self.assertEqual(a[0]["stage"],"doorway_exit_inside");self.assertAlmostEqual(abs(a[1]["pose"]["yaw"]),math.pi)
 def test_same_room_and_corridor_do_not_add_doors(self):
  self.assertEqual(len(self.route({"x":6.7,"y":5.9})),1)
  self.assertEqual(len(plan_doorway_route(self.g,self.r,{"x":2,"y":5},"Hall",{"x":1,"y":1})),1)
 def test_ambiguous_door_fails_closed(self):
  self.g["doors"].append(copy.deepcopy(self.g["doors"][0]))
  with self.assertRaises(DoorwayRouteError):self.route()
 def test_other_skeleton_orientation(self):
  self.g["doors"][0].update(at=[3,0],interaction_pose={"x":3,"y":-1.1,"yaw":math.pi/2})
  self.r["locations"][0]["bounds"]={"min_x":0,"max_x":6,"min_y":0,"max_y":5}
  a=self.route({"x":3,"y":-2})
  self.assertAlmostEqual(a[1]["pose"]["yaw"],math.pi/2)
  self.assertEqual(a[2]["pose"]["x"],3);self.assertGreater(a[2]["pose"]["y"],1.17+.42)
if __name__=="__main__":unittest.main()
