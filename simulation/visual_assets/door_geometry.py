"""Physical side-hinged door geometry for canonical imported maps.

Door at is the closed aperture center, and orientation is the closed leaf
direction. A positive joint angle swings toward the left of that direction.
The joint pose is explicitly relative to the leaf, at its first edge; no
collision geometry is teleported when the door opens.
"""
from __future__ import annotations
import math
import xml.etree.ElementTree as ET


def door_elements(door):
    ident = door["id"]
    x, y = map(float, door["at"][:2])
    width = float(door.get("width", 1.0))
    height = float(door.get("height", 2.2))
    orientation = float(door.get("orientation", 0))
    if not all(math.isfinite(v) for v in (x, y, width, height, orientation)) or width <= .08 or height <= .1:
        raise ValueError("INVALID_DOOR_GEOMETRY")
    leaf_width, thickness, mass = width - .08, .065, 20.0
    upper = 0.0 if door.get("runtime_jammed") is True else math.pi / 2
    model = ET.Element("model", name=f"door_{ident}")
    ET.SubElement(model, "pose").text = f"{x} {y} 0 0 0 0"
    frame = ET.SubElement(model, "link", name="frame")
    fi = ET.SubElement(frame, "inertial")
    ET.SubElement(fi, "mass").text = "100"
    fin = ET.SubElement(fi, "inertia")
    for tag, value in (("ixx", 1), ("iyy", 1), ("izz", 1)):
        ET.SubElement(fin, tag).text = str(value)
    panel = ET.SubElement(model, "link", name="panel")
    ET.SubElement(panel, "pose").text = f"0 0 {height / 2 + .015} 0 0 {orientation}"
    inertial = ET.SubElement(panel, "inertial")
    ET.SubElement(inertial, "mass").text = str(mass)
    inertia = ET.SubElement(inertial, "inertia")
    for tag, value in (("ixx", mass * (height**2 + thickness**2) / 12),
                       ("iyy", mass * (height**2 + leaf_width**2) / 12),
                       ("izz", mass * (leaf_width**2 + thickness**2) / 12)):
        ET.SubElement(inertia, tag).text = str(value)
    def box(parent, tag, name, size, position=(0, 0, 0), color=None):
        element = ET.SubElement(parent, tag, name=name)
        ET.SubElement(element, "pose").text = " ".join(map(str, (*position, 0, 0, 0)))
        geometry = ET.SubElement(element, "geometry")
        ET.SubElement(ET.SubElement(geometry, "box"), "size").text = " ".join(map(str, size))
        if color is not None:
            material = ET.SubElement(element, "material")
            for key in ("ambient", "diffuse"):
                ET.SubElement(material, key).text = color
            ET.SubElement(material, "specular").text = ".08 .07 .06 1"
            ET.SubElement(element, "cast_shadows").text = "true"
        return element
    box(panel, "collision", "panel_collision", (leaf_width, thickness, height))
    box(panel, "visual", "panel_visual", (leaf_width, thickness, height), color=".26 .20 .15 1")
    # Recessed office-door panels and an actual handle silhouette make the
    # object legible to Agnes vision without demo-marker color classification.
    for face in (-1, 1):
        for index, z in enumerate((-.37, .38)):
            box(panel, "visual", f"recess_{face}_{index}",
                (leaf_width * .72, .008, height * .30), (0, face * .037, z),
                ".19 .145 .105 1")
        box(panel, "visual", f"handle_plate_{face}", (.07, .018, .18),
            (leaf_width * .36, face * .045, -.08), ".48 .46 .42 1")
    # The lever is a genuine articulated visible part; it adds no collision
    # shape and leaves the existing leaf, opening clearance and hinge intact.
    handle = ET.SubElement(model, "link", name="handle")
    ET.SubElement(handle, "pose", relative_to="panel").text = f"{leaf_width * .36} 0 -.08 0 0 0"
    hi = ET.SubElement(handle, "inertial")
    ET.SubElement(hi, "mass").text = ".06"
    hin = ET.SubElement(hi, "inertia")
    for tag in ("ixx", "iyy", "izz"):
        ET.SubElement(hin, tag).text = ".0001"
    for face in (-1, 1):
        box(handle, "visual", f"handle_{face}", (.15, .035, .026),
            (-.065, face * .072, 0), ".68 .67 .62 1")
    joint = ET.SubElement(model, "joint", name=f"{ident}_hinge", type="revolute")
    ET.SubElement(joint, "parent").text = "frame"
    ET.SubElement(joint, "child").text = "panel"
    ET.SubElement(joint, "pose", relative_to="panel").text = f"{-leaf_width / 2} 0 0 0 0 0"
    axis = ET.SubElement(joint, "axis")
    ET.SubElement(axis, "xyz").text = "0 0 1"
    limit = ET.SubElement(axis, "limit")
    ET.SubElement(limit, "lower").text = "0"
    ET.SubElement(limit, "upper").text = str(upper)
    dynamics = ET.SubElement(axis, "dynamics")
    ET.SubElement(dynamics, "damping").text = ".15"
    plugin = ET.SubElement(model, "plugin", filename="gz-sim-joint-controller-system",
                           name="gz::sim::systems::JointController")
    ET.SubElement(plugin, "joint_name").text = f"{ident}_hinge"
    handle_joint = ET.SubElement(model, "joint", name=f"{ident}_handle", type="revolute")
    ET.SubElement(handle_joint, "parent").text = "panel"
    ET.SubElement(handle_joint, "child").text = "handle"
    ET.SubElement(handle_joint, "pose", relative_to="handle").text = "0 0 0 0 0 0"
    ha = ET.SubElement(handle_joint, "axis")
    ET.SubElement(ha, "xyz").text = "0 -1 0"
    hl = ET.SubElement(ha, "limit")
    ET.SubElement(hl, "lower").text = "0"
    ET.SubElement(hl, "upper").text = ".48"
    hd = ET.SubElement(ha, "dynamics")
    ET.SubElement(hd, "damping").text = ".02"
    hp = ET.SubElement(model, "plugin", filename="gz-sim-joint-controller-system",
                       name="gz::sim::systems::JointController")
    ET.SubElement(hp, "joint_name").text = f"{ident}_handle"
    # Actual joint telemetry drives the animation and is also available to the
    # integration recorder. No estimated animation angle is used as evidence.
    telemetry = ET.SubElement(model, "plugin", filename="gz-sim-joint-state-publisher-system",
                              name="gz::sim::systems::JointStatePublisher")
    ET.SubElement(telemetry, "topic").text = f"/model/door_{ident}/joint_state"
    for joint_name in (f"{ident}_hinge", f"{ident}_handle"):
        ET.SubElement(telemetry, "joint_name").text = joint_name
    ET.SubElement(telemetry, "update_rate").text = "50"
    anchor = ET.Element("joint", name=f"anchor_{ident}", type="fixed")
    ET.SubElement(anchor, "parent").text = "world"
    ET.SubElement(anchor, "child").text = f"door_{ident}::frame"
    return model, anchor


def door_sdf(door):
    return "".join(ET.tostring(item, encoding="unicode") for item in door_elements(door))
