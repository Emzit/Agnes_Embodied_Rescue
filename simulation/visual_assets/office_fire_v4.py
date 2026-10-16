"""Native volumetric fire, retaining the established office fuel and smoke.

The flame density is evaluated in 3D by the Gazebo sensor renderer. There are
no flame sprites. This is an appearance model, not a combustion solver.
"""
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from simulation.visual_assets.office_fire_v3 import ROOT, apply_fire_effects as legacy_effects, child

NATIVE = ROOT / "simulation/visual_assets/volumetric_fire"
LIBRARY = NATIVE / "build/libagnes_volume_fire.so"
PLUGIN_NAME = "agnes::VolumetricFire"
# Vertical plumes and shallow ceiling flows meet at z=2.44, without overlapping
# proxy volumes. All volumes are on the room side of the walls and roof.
VOLUMES = [
    dict(name="front_records", center=[-1.8,3.40,1.67], size=[1.40,.55,1.54],
         kind=0, seed=1.7, direction=[0,0,1], intensity=1.0, source="front_records"),
    dict(name="right_cable", center=[4.17,-.51,1.66], size=[.46,.88,1.56],
         kind=0, seed=6.1, direction=[0,0,1], intensity=.9, source="right_cable"),
    dict(name="workstation", center=[-4.40,.40,1.395], size=[1.50,1.57,2.09],
         kind=0, seed=11.3, direction=[0,0,1], intensity=1.0, source="workstation"),
    dict(name="ceiling_records", center=[-1.8,2.63,2.615], size=[1.45,2.09,.35],
         kind=1, seed=1.7, direction=[.08,-1,0], intensity=.86, source="front_records"),
    dict(name="ceiling_cable", center=[3.30,-.51,2.615], size=[2.20,.88,.35],
         kind=1, seed=6.1, direction=[-1,.05,0], intensity=.80, source="right_cable"),
    dict(name="ceiling_workstation", center=[-3.73,.80,2.615], size=[2.84,1.53,.35],
         kind=1, seed=11.3, direction=[1,.16,0], intensity=.88, source="workstation"),
]

def apply_fire_effects(world, out):
    out = Path(out).resolve()
    if not out.is_relative_to(ROOT):
        raise ValueError("OFFICE_FIRE_OUTPUT_OUTSIDE_WORKSPACE")
    if not LIBRARY.is_file():
        raise FileNotFoundError("Build the native fire renderer first: " + "python3 " + str(NATIVE / "build.py"))
    metadata = legacy_effects(world, out)
    # Preserve smoke and tiny embers, but remove every whole-flame image layer.
    for model in list(world.findall("model")):
        if not model.get("name", "").startswith("office_fire_"):
            continue
        for link in model.findall("link"):
            for emitter in list(link.findall("particle_emitter")):
                if emitter.get("name") not in ("buoyant_smoke", "embers", "upper_smoke", "lower_wisp"):
                    link.remove(emitter)
        if not model.findall(".//visual") and not model.findall(".//particle_emitter"):
            world.remove(model)
    for plugin in list(world.findall("plugin")):
        if plugin.get("name") == PLUGIN_NAME:
            world.remove(plugin)
    plugin = ET.SubElement(world, "plugin", name=PLUGIN_NAME, filename=str(LIBRARY))
    child(plugin, "shader_dir", str(NATIVE / "shaders"))
    child(plugin, "status_path", str(out / "office-fire-volume-runtime.json"))
    child(plugin, "steps", 36)
    for spec in VOLUMES:
        volume = ET.SubElement(plugin, "volume", name=spec["name"])
        for key in ("center", "size", "kind", "seed", "direction", "intensity"):
            value = spec[key]
            child(volume, key, " ".join(map(str,value)) if isinstance(value,list) else value)
    kept = {(m.get("name"),e.get("name")) for m in world.findall("model") for e in m.findall(".//particle_emitter")}
    metadata["emitters"] = [e for e in metadata["emitters"] if (e["model"],e["emitter"]) in kept]
    budget = sum(e["rate"]*e["lifetime"] for e in metadata["emitters"])
    metadata.update(
        schema="agnes.office-fire-effects.v4",
        renderer="native-ogre2-volume-raymarch",
        flame_billboards=0,
        volumes=VOLUMES,
        volume_count=len(VOLUMES),
        volume_steps=36,
        volume_library=str(LIBRARY),
        volume_status_path=str(out / "office-fire-volume-runtime.json"),
        dynamic_emitters=[],
        particle_emitters=len(metadata["emitters"]),
        approx_steady_live_particles=round(budget),
        max_live_particle_budget=round(budget,2),
        fire_ceiling_sources=sum(v["kind"] == 1 for v in VOLUMES),
        limitations="Procedural volumetric appearance; no heat, combustion or smoke-flow solver.",
    )
    (out / "office-fire-effects.json").write_text(json.dumps(metadata,indent=2)+"\n")
    return metadata
