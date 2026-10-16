# Office damage asset source

All assets are authored by the project's deterministic Python/NumPy generator; there are no model-generated images or third-party textures.

The original office plaster, acoustic tile and furniture colors are sampled into a unique compact PBR atlas for each affected existing visual. Heat/soot masks use the surface's real world coordinates and face direction. Surface geometry remains opaque and continuous. Each atlas contains albedo, normal and roughness maps with duplicated border texels; it does not use separate scorch planes.

Integration: call apply_office_damage(world, out) from office_damage.py after office architecture, glazing and lintels, before the fire-module's cabinet replacement. The function preserves all collision elements and entire door models, writes generated atlases under out/office-damage-assets, writes meshes under out/office-damage-meshes and returns the out/office-damage.json manifest. Generated files record source and SHA-256 hashes.

Current burn alignment: front wall, right cable wall, workstation 6 (cabinet shell/contents are owned by the fire module), and matching upper smoke paths. Two small sagging roof sheets and failed lamp covers are visual details only. No floor clutter is added.

Run tests from the project root using the bundled Python:
    runtime/ros2-jazzy/.pixi/envs/default/bin/python -B -m unittest simulation.visual_assets.office_damage_test

The test reads and clones the current active office world and writes only its own artifact directory. It never reloads or commands the running simulator.
