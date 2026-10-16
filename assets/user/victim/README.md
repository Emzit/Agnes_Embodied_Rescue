# Victim visual hot-swap

This directory accepts a user-provided, legally usable victim visual asset in
`glb`, `gltf`, `dae`, or `obj` format. Configure it with:

```yaml
victim_visual_asset: assets/user/victim/wawa.glb
```

The runtime semantic class remains `person` / `victim_target`; navigation,
collision, perception evidence, and rescue logic do not depend on the mesh.
No Wawa asset is bundled here. Until a permitted asset is supplied and loaded,
the current project-authored victim visual remains active:
`WAWA_ASSET_PENDING`.
