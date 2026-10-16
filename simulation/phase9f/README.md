Phase 9F static world model (no rescue targets, dynamic cabinet or recognition).

world_registry.json is the single active source for semantic navigation poses,
bounds and adjacency. It contains Start, Room_A, Corridor_A, Room_B, Room_C and
Side_Corridor in the fixed map frame. The JSON format avoids a new YAML dependency.
Unknown/dynamic metadata is rejected; region transitions/outside areas can be
unknown. Nearest-waypoint matching applies only to unbounded waypoints and is
thresholded, never unconditional.

geometry.json describes fixed walls; world.sdf and map.pgm use matching geometry.
Acceptance compares every cell of the live ROS /map to SDF collision geometry,
checks all waypoint cells are free, and navigates through real door openings.
The empty Phase 9D A→B coordinates (0,0)→(2,1) remain Start→Room_A here.
Identity map→odom is still a fixed-map MVP assumption; odom and sensors are real.
LiDAR is not yet an obstacle-layer source. Static map topology/traversability is
explicitly labelled static_map_only, not a claim that unobserved routes are clear.

RuntimeWorldState is per MCP/gateway process and only records confirmed bridge
events. Success requires accepted=true and real action_status=SUCCEEDED. Timeout
does not establish physical blockage. No Gazebo entity state is read by runtime.
visited_locations lists successful navigation targets, not guessed room visits.
get_world_state reports sensor availability, numeric summaries and empty semantic
objects. inspect_room/inspect_object remain explicitly unimplemented.

Default/new ROS2 backend uses this registry. Set ROBOT_WORLD_REGISTRY explicitly
for another static map. ROBOT_WAYPOINTS_FILE is retained only for historical
Phase 9B/9D/9E regression reproduction; those old coordinate files are NOT a
second active Phase 9F source. Both environment sources together are rejected.
Future semantics must come from confirmed perception events, not registry labels.

Run:
```sh
source scripts/use-phase9f-env.sh
PHASE9F_WORLD_TEST=1 tools/node/bin/node --test services/robot-mcp/tests/world-model.test.ts
```
The supervisor uses a separate Phase 9F PID/start-time registry and project-local
HOME/cache/log/tmp. It only stops owned processes. No new packages are installed.
