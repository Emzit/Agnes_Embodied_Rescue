Phase 10: real camera perception and real physical inspection, not rescue orchestration.

Audit found official agnes-3.0-flash image support and verified real image calls via
the official SDK, without reading credentials. Its live demo benchmark produced
spurious person hypotheses in an empty room and missed visible objects. Failed
evidence is retained under artifacts/phase10/vlm-failed-evidence. Final acceptance
explicitly selects CV, not a mock fallback. VLM remains an opt-in implementation.

The CV route uses existing NumPy on actual RGB Camera Image messages. It recognizes
public demo appearance conventions: magenta coat marker on human-shaped geometry,
tall saturated red extinguisher geometry, and a blue toolbox case. This is
marker/color/contour-based synthetic-demo recognition, NOT general person/object
recognition, researcher identity verification, or calibrated confidence.
It reads no entity names, simulator occupants, registry labels or truth files.
The room registry remains Phase 9F's static coordinate source.

Confidence is measured from color purity, connected-component fill, pixel size
and image-edge clipping. No fixed before/after confidence is injected. Active
inspection uses three actual Nav2 rotations and fresh images; mean confidence
may decrease. Fewer than two matching frames or confidence below 0.80 produces
still_uncertain=true. Objects must have been observed previously; references are
detection IDs. Approximate image ray bearing is derived from intrinsics/pixels
and actual odometry; stale/far-away references are rejected rather than teleported.

Room inspection validates the region and actual pose, then executes eight overlapping official
Nav2 yaw goals. Every view records real odometry yaw, image timestamp and pixel
detections. Result inspected=true means the multi-view protocol completed, not
that visibility is exhaustive. Runtime memory records only completed inspections
and actual detections, with evidence and confidence history.

The eight MCP names and input schemas are unchanged. inspect_object still accepts
object_id, a previous detection reference or observed label. Camera captures are
internal test-only bridge requests, not extra MCP tools. Raw sensor summaries are
preserved. Failures are real structured errors, never mock data.

Ground truth is test-only: artifacts/phase10/ground-truth-test-only.json. Runtime
perception never reads it. Objects have neutral Gazebo entity names and are
visual geometry; no learned assets or large models were downloaded.

Run from the project root:
```sh
source scripts/use-phase10-env.sh
PHASE10_PERCEPTION_TEST=1 tools/node/bin/node --test services/robot-mcp/tests/real-perception.test.ts
```
All cache/home/log/temp paths are project-local. Existing Step 7 daemon is used
only for VLM feasibility checks and is not terminated by this phase; it was not
started by this phase. Final CV acceptance requires no model API calls.

Physical navigation correction: repeated wheel-integrated turns accumulated severe
odometry drift (test-only probe: reported x=5.84 vs physical x=3.06). Phase10
now uses Gazebo's official OdometryPublisher for robot-only physical /odom,
with wheel integration retained separately at /wheel/odom. This is simulated
ideal robot odometry, not localization robustness validation. Perception still
reads only RGB pixels and robot odometry; no object/scene truth is subscribed.
Reference: https://gazebosim.org/api/sim/8/posecomponent.html
