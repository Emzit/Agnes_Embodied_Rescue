# Native volumetric office fire

This project-authored C++ / GLSL module ray marches continuous 3D density inside
closed proxy boxes in Gazebo Sim 8 / Ogre2. It uses no billboard flame sprites,
downloaded assets, third-party model calls, or browser overlays. The result is
an artistic appearance model, not combustion / thermal / fluid simulation.

Build inside the project:

    python3 -B simulation/visual_assets/volumetric_fire/build.py

The script checks both GLSL stages with the existing project glslangValidator,
compiles against the existing Gazebo / Ogre headers and libraries, and atomically
replaces build/libagnes_volume_fire.so only after successful linking. It installs
nothing. Build provenance and SHA-256 values are recorded in build/manifest.json.

Attach a world plugin named agnes::VolumetricFire with filename set to the absolute
library path. Provide shader_dir, status_path (both within the project), optional
steps (default 36; 16–64), and one to sixteen volume elements. Each volume has a
unique name attribute and center, size, kind (0 rising flame; 1 ceiling rollover),
seed, optional direction, intensity (0–2) and per-volume steps override. Coordinates
are world-aligned; size is full XYZ extent in metres. Proxy geometry is rendering
only and never enters ECM physics, collisions, contacts, doors or navigation.

The shader uses three-dimensional time-advected procedural noise and a thin
reaction boundary, stretched along the gas flow to make rising tongues and
horizontal curls. Same-seed main/ceiling domains use the main source center/size
as their common noise anchor. Only the source inlet bends down to meet the rising
plume; unrelated ceiling edges remain transparent. The sample budget stays at
36 by default. Material depth testing remains enabled, depth writes are
disabled, and the proxies render in transparency queue 200. Private visibility
bit 24 is assigned to the actual Ogre object and removed from all GPU-ray masks,
so the fire does not become a false lidar obstacle. RGB camera visibility is kept.

Status is written to the configured file with RUNNING / FAILED / STOPPED,
shader_mode=raymarch_3d, billboards=0, volumes, render_frames, sim_time,
world_name, updated_at, masked_lidar_sensors and JSON-escaped error. Shader compilation errors are
checked offline because Ogre internally asserts on invalid GLSL.

The isolated probe uses its own GZ_PARTITION, two RGB cameras, an opaque foreground
bar and a GPU lidar at 1.15 m through the fire. It writes only under probe/ and
terminates only its own process group. Run after sourcing scripts/final-rescue/env.sh:

    python3 -B simulation/visual_assets/volumetric_fire/probe/run_probe.py
    python3 -B simulation/visual_assets/volumetric_fire/probe/run_probe.py --baseline
    python3 -B simulation/visual_assets/volumetric_fire/probe/test_probe.py

The baseline removes only the volume plugin. Evidence checks compare all 101
GPU-ray ranges, opaque bar interior pixels, both fixed camera time sequences,
physical XML and compiled/shader hashes. Silhouette edge pixels are excluded from
the opaque-pixel check because multisample antialiasing correctly mixes their
background fire coverage. Results are saved in probe/verification.json.

The checked-in capture evidence was produced before the final office-specific
reaction-width / directional-flow / source-inlet tuning. It verifies the same
unchanged material, proxy, visibility-mask and camera-depth path; it does not
represent the final office appearance or measure its final FPS. Final integrated
office frames are captured separately by the controlled office-preview/live
validation workflow. The manifest check verifies current build files separately
from that historical render evidence.

Limit: current proxy rendering depth-tests its entry surface. Opaque objects
entirely in front occlude correctly. Full per-sample scene-depth clipping for
geometry crossing inside a fire volume is not implemented. The isolated camera
test covers external viewpoints, not a camera placed inside a flame domain.
Place fire domains on
the exposed side of walls, and inspect fuel intersections in the native camera.
Performance must be measured in the integrated world; standalone probe FPS is
not an end-user performance guarantee.
