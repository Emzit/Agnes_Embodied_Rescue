import math
import unittest
import xml.etree.ElementTree as ET
from simulation.visual_assets.door_geometry import door_elements, door_sdf


class HingedDoorTests(unittest.TestCase):
    def door(self, orientation=0, jammed=False):
        return {"id": "test", "at": [4.5, -6], "width": 1.25,
                "height": 2.15, "orientation": orientation,
                "runtime_jammed": jammed}

    def test_closed_panel_occupies_aperture_and_uses_edge_hinge(self):
        model, anchor = door_elements(self.door())
        panel = model.find("link[@name='panel']")
        joint = model.find("joint")
        self.assertEqual(joint.find("pose").attrib["relative_to"], "panel")
        width = float(panel.findtext("collision/geometry/box/size").split()[0])
        hinge_x = float(joint.findtext("pose").split()[0])
        self.assertAlmostEqual(hinge_x, -width / 2)
        self.assertAlmostEqual(width, 1.17)
        self.assertEqual(joint.findtext("axis/limit/lower"), "0")
        self.assertEqual(anchor.findtext("parent"), "world")
        self.assertEqual(anchor.findtext("child"), "door_test::frame")

    def test_full_open_clearance_and_swing_into_north_room(self):
        model, _ = door_elements(self.door())
        panel = model.find("link[@name='panel']")
        width, thickness, _ = map(float, panel.findtext("collision/geometry/box/size").split())
        angle = float(model.findtext("joint/axis/limit/upper"))
        # Closed leaf spans x=[-.585,+.585]. Rotation about its west edge
        # places it against the left jamb, leaving a robot-inflated passage.
        x_extent = width * abs(math.cos(angle)) + thickness * abs(math.sin(angle))
        clear = 1.25 - .04 - x_extent
        self.assertGreater(clear, 1.05)
        self.assertGreater(math.sin(angle) * width, 1.16)

    def test_right_hand_layout_opens_east_not_into_hallway(self):
        model, _ = door_elements(self.door(-math.pi / 2))
        orientation = float(model.findtext("link[@name='panel']/pose").split()[5])
        width = float(model.findtext("link[@name='panel']/collision/geometry/box/size").split()[0])
        hinge = (4.5 - width / 2 * math.cos(orientation), -6 - width / 2 * math.sin(orientation))
        open_tip = (hinge[0] + width * math.cos(orientation + math.pi / 2),
                    hinge[1] + width * math.sin(orientation + math.pi / 2))
        self.assertGreater(open_tip[0], 4.5 + 1.16)
        self.assertAlmostEqual(open_tip[1], -6 + width / 2)

    def test_jammed_physical_limit_remains(self):
        model, _ = door_elements(self.door(jammed=True))
        self.assertEqual(float(model.findtext("joint/axis/limit/upper")), 0)

    def test_xml_name_escaping(self):
        door = self.door(); door["id"] = 'door & "corner"'
        world = ET.fromstring("<world>" + door_sdf(door) + "</world>")
        self.assertEqual(world.find("model").attrib["name"], 'door_door & "corner"')

    def test_handle_is_articulated_without_new_collision_or_door_closer(self):
        model, _ = door_elements(self.door())
        panel = model.find("link[@name='panel']")
        handle = model.find("link[@name='handle']")
        self.assertEqual(handle.find("pose").get("relative_to"), "panel")
        self.assertEqual(len(handle.findall("visual")), 2)
        self.assertEqual(handle.findall("collision"), [])
        self.assertEqual(len(model.findall(".//collision")), 1)
        joint = model.find("joint[@name='test_handle']")
        self.assertEqual(joint.findtext("parent"), "panel")
        self.assertEqual(joint.findtext("child"), "handle")
        self.assertEqual(joint.findtext("axis/xyz"), "0 -1 0")
        self.assertEqual(joint.findtext("axis/limit/lower"), "0")
        self.assertAlmostEqual(float(joint.findtext("axis/limit/upper")), .48)
        self.assertEqual(model.find("joint").get("name"), "test_hinge")
        self.assertEqual(model.findall(".//spring_stiffness"), [])
        telemetry = model.find("plugin[@name='gz::sim::systems::JointStatePublisher']")
        self.assertEqual(telemetry.findtext("topic"), "/model/door_test/joint_state")
        self.assertEqual([n.text for n in telemetry.findall("joint_name")], ["test_hinge", "test_handle"])
        self.assertTrue(all(v.get("name", "").startswith("handle_plate") or not v.get("name", "").startswith("handle_") for v in panel.findall("visual")))

    def test_invalid_geometry_rejected(self):
        for key, value in (("width", 0), ("height", float("nan")), ("orientation", float("inf"))):
            door = self.door(); door[key] = value
            with self.assertRaises(ValueError): door_elements(door)


if __name__ == "__main__":
    unittest.main()
