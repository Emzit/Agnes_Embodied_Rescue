Phase 9C-A: headless physics / transport acceptance

This world uses real Gazebo Harmonic Physics and DiffDrive systems. It has no
sensor, GUI, Nav2 action server, LLM or rescue scenario. All geometry is local;
no Fuel model downloads are needed. ROS-GZ dependencies may include Qt/rendering
libraries due to RoboStack packaging; the test never starts these subsystems.

Installed roots: ros-jazzy-ros-gz-sim and ros-jazzy-ros-gz-bridge, alongside the
existing ROS base/message environment. The resolved gz-sim8 dependency is Harmonic.
Package provenance and versions are saved from real conda-meta records.

Run from the workspace root:

```sh
source scripts/use-phase9c-env.sh
PHASE9C_GAZEBO_TEST=1 tools/node/bin/node --test services/robot-mcp/tests/gazebo.test.ts
```

The test launches `gz sim -s -r` and the actual `ros_gz_bridge parameter_bridge`.
The YAML config makes `/cmd_vel` ROS_TO_GZ and `/odom` GZ_TO_ROS only. The Python
probe subscribes to odometry and publishes test velocity; it never creates odometry
or implements a simulator. Each sampling request requires three fresh messages.
MCP uses the existing ROS2 gateway, selecting `ROBOT_ROS2_ENV=phase9c` to keep the
bridge on the same isolated ROS_DOMAIN_ID. `navigate_to` returns
`NAV2_NOT_AVAILABLE` when the standard action server is absent. No Phase9B fixture
is launched. Other unimplemented capabilities remain explicitly unavailable.

The acceptance test checks motion, zero velocity, MCP-observed pose and MCP stop,
then closes its SDK/probe and signals only its own Gazebo/bridge process groups.
Artifacts and logs are stored in `artifacts/phase9c` and `logs/phase9c` respectively.

References consulted:
- https://gazebosim.org/docs/harmonic/getstarted/ (server-only `-s`)
- https://gazebosim.org/docs/harmonic/moving_robot/ (DiffDrive)
- https://github.com/gazebosim/ros_gz/tree/jazzy/ros_gz_bridge (bridge)
- https://robostack.github.io/jazzy.html (RoboStack Jazzy packages)
