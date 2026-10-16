# Indoor office fire visual assets

The office finishes and furniture follow the user's supplied office walkthrough:
painted light walls, gray commercial carpet, a 600 mm suspended ceiling grid,
flat light panels, glass office doors with a blue privacy band, and white desks
with green dividers, LCD monitors and black swivel chairs. The footage supplies
appearance reference; no video frames or third-party models were extracted into
texture assets. Dimensions are an interpretation of the user's schematic, not a
survey of the real office.

office_scene.py exports apply_office_style(world, out, skeleton). Call it after
the standard imported-map styling for the indoor office map only. It replaces
surface appearance, adds the ceiling and six workstations, and styles the
existing physical hinged doors without changing their collisions or hinges.

The indoor camera sits 1.35 m above the floor (the chassis model origin is
0.16 m and camera_link is 1.19 m above it), above the 0.7425 m desktops and
1.01 m door handles. The lens stays level with its existing field of view and
30 Hz capture setting. The TF publisher reads camera height from the selected
world SDF, including when a scene is rolled back; lidar calibration is unchanged.

Doors animate through measured physical joints: press the handle, ease the leaf
open toward 90 degrees, then return the handle. The leaf remains open with zero
commanded velocity; no automatic closing is added. The production open_door
tool still requires a recent Agnes camera observation and a nearby robot, and
reports success only after physical opening and stop verification.

OFFICE_OBSTACLES declares six conservative workstation footprints. The map
compiler must rasterize matching skeleton.static_obstacles; the helper rejects
missing or different bounds. Actual individual furniture parts have collisions
and stay within those bounds. The center aisle remains clear.

Wall-attached and ceiling-attached fire uses the project-authored office_fire_textures:
three asymmetric wall-flame variants, two horizontal ceiling-roll variants, soft
gray/brown smoke, sparks and lifetime color/opacity ramps. Wall fire rises toward
the roof, then broad, shallow fire ribbons move laterally below it. There are no
downward ceiling columns, floor fire piles, or opaque scorch/soot mesh overlays.
The references guide shape and warm lighting; their pixels are not texture assets.
Approximately 504 simultaneous particles and seven shadowless point lights bound
rendering load. Particle laser scatter is zero. These are visual effects, not a
fire-growth, temperature, toxic-gas, or evacuation-safety simulation.

office_fire_generate.py reproducibly creates the ten RGBA assets with project
NumPy; office_fire_manifest.json records hashes and provenance. All sprite borders
are transparent. Rebuild and validate with:

    runtime/ros2-jazzy/.pixi/envs/default/bin/python -B simulation/visual_assets/office_fire_generate.py
    python3 -B -m unittest simulation.visual_assets.office_fire_test simulation.visual_assets.office_test -v

The new PNG assets are authored deterministic procedural textures, generated
without model calls or downloads. office_manifest.json records their SHA-256
hashes and sources. Normal compilation needs only the generated files and the
Python standard library. To regenerate textures inside the project:

    runtime/ros2-jazzy/.pixi/envs/default/bin/python -B simulation/visual_assets/office_generate.py
    python3 -B -m unittest simulation.visual_assets.office_test -v

The tests verify real PNG chunks and decompression, referenced assets, ceiling
enclosure, particle budgets, upward wall fire and horizontal ceiling rolls, original collision and
hinge preservation, physical furniture inside the occupancy footprints, and
rejection of mismatched occupancy bounds.
