# Final real rescue demo

This environment extends the completed Phase10 world. The agent receives exactly
“进入实验室寻找失联研究员，并报告环境风险。” The official Agnes provider is
agnes-ai / agnes-3.0-flash. Only five cognitive plugin tools and eight Robot MCP
tools receive permission; file/shell tools are denied. No mission tool calls are
queued or scripted. The separate physical smoke is explicitly a test, not a mission.

Runtime semantics are NumPy color/contour detection on real Gazebo camera RGB.
Person denotes a synthetic demo appearance marker, not researcher identity.
Robot /odom uses Gazebo's robot-only physical OdometryPublisher, an ideal simulated
odometry source. Hidden object truth is never used by the perception or registry.
The world SDF necessarily contains rendering/collision geometry; it is not exposed
to the agent. The registry and static map contain only navigation regions/walls.

DynamicScenarioController subscribes only to real inspection-completed events.
A successful Room_A eight-view Nav2 scan triggers the actual Gazebo create service
for cabinet.sdf. The resulting box has collision and real LiDAR returns. No event
or entity name is sent to the LLM. Both Nav2 costmaps use the official obstacle layer.
PATH_BLOCKED requires a failed/cancelled real Nav2 goal plus lethal live goal-near
costmap occupancy and fresh LiDAR; timeout alone is insufficient.

The south doorway is widened to leave rotation clearance. build_static_map.py
regenerates the map only from static wall collision geometry; dynamic cabinet and
visual semantics are excluded. Routes and actual paths remain Nav2 decisions.

Commands (project root):
- scripts/final-rescue/start.sh
- scripts/final-rescue/status.sh
- scripts/final-rescue/run-acceptance.sh
- scripts/final-rescue/stop.sh

The scripts reuse the existing project-local Agnes account/profile without reading
or copying credentials. They restart its daemon for clean plugin state. The older
Step7 web UI is retained; all newly started simulation/daemon/MCP descendants are
tracked and cleaned. Every HOME, XDG, temp, ROS, Gazebo and SDK data path is local.

Official implementation references:
- https://gazebosim.org/api/sim/8/entity_creation.html
- https://docs.nav2.org/jazzy/configuration_and_development/configuration_guide/core_servers/costmap_2d/costmap_plugins/obstacle/
- https://gazebosim.org/api/sim/8/posecomponent.html
