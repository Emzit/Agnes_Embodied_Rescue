Phase 9D: official Nav2 / headless Gazebo navigation MVP

Package constraint:
- The channel's navigation2 meta-package depends on nav2-rviz-plugins / RViz.
- Its nav2-bringup meta-package also depends on SLAM Toolbox and sample robots.
- Those dependencies are prohibited by this phase. Neither meta-package is
  installed. Instead, Pixi installs the eight official runtime/plugin packages
  declared in the project manifest. Nothing is repackaged or dependency-forged.
- Channel query evidence: logs/phase9d/search-ros2-navigation2.log and
  logs/phase9d/search-ros2-nav2-bringup.log. Installed records: packages.json.

The project launch file starts official map_server, planner_server,
controller_server, behavior_server, bt_navigator and lifecycle_manager binaries.
Planning uses NavFn; control uses RegulatedPurePursuit. The navigator loads its
installed official behavior tree. Both costmaps use static and inflation layers;
no obstacle observation sources, /scan publisher, AMCL, SLAM or sensors exist.

The map and physical walls bound the same 20 m square. Gazebo uses the Phase9C
robot geometry, DiffDrive and real physics. The only TF helper subscribes to
real /odom and broadcasts odom→base_link. map→odom is static identity for this
drift-free MVP assumption; this is not a final localization solution.
ROS-GZ bridges real /odom, /cmd_vel and /clock. Nav2, TF and the rclpy action
bridge use simulation time. No custom navigation controller/action server exists.

Run:

```sh
source scripts/use-phase9d-env.sh
PHASE9D_NAV2_TEST=1 tools/node/bin/node --test services/robot-mcp/tests/nav2.test.ts
```

The acceptance first uses a standalone real rclpy action client A→B, returns to
A through Nav2 (no teleport), then uses the official MCP client for A→B and a
distant goal/cancel/zero-Twist test. It reads real graph ownership, lifecycle,
path publications, commands, odometry and Gazebo model pose. Five unsupported
tools remain ROS2_MVP_NOT_IMPLEMENTED. All owned process groups are cleaned up.

Attempt 1 evidence is retained under artifacts/phase9d/attempt-1. Its real
navigation succeeded but the evaluator incorrectly required the *last* path to
have >2 points, ignoring valid shortening near the goal. The collector now
records the maximum observed path length as well as the final length.

Attempt 2 completed the ROS2 and MCP checks successfully. Its navigation/stop
receipts are retained under attempt-2. Attempt 3, with syscall instrumentation,
hit the initial cold-start bridge deadline; its partial evidence is under
attempt-3. The initial direct-client wait now accommodates cold Python startup;
the 30-second goal deadline and 0.25 m navigation tolerance are unchanged.

Current component-route continuation accepts the official standalone packages
as the intended installation, rather than treating absent meta-packages as a
failure. `package-plan.json` contains fresh channel queries, installed versions,
direct dependencies, transitive forbidden-package checks, disk space and lock
hash. No additional Gazebo installation is required.

Reusable stack commands (foreground supervisor; use another terminal to stop):

```sh
./scripts/phase9d/start-stack.sh
./scripts/phase9d/check-stack.sh
./scripts/phase9d/stop-stack.sh
```

The supervisor records PID/start-time identities under `.runtime-phase9d` and
reaps its own children. It only signals registered process groups or explicit
acceptance children, validating UID, start-time and session ownership. It does
not use process-name based kill commands. Stale registry entries do not authorize
killing a reused PID. The acceptance itself executes all three wrapper scripts.

`waypoints.json` provides A/B/C. Clock progression, publisher ownership, official
BT feedback, lifecycle and TF checks precede navigation. Phase9B protocol and
three-tool transport checks are exercised against **real Nav2**; the old fixture
action-server test is explicitly skipped because it is prohibited. Phase9C
headless smoke and mock regression are separately run without modifying their
safety checks. Current attempts/results are in debug-attempts.json/regression.json.

Official references consulted:
- https://docs.nav2.org/jazzy/configuration_and_development/configuration_guide/core_servers/controller_server/
- https://docs.nav2.org/jazzy/configuration_and_development/configuration_guide/core_servers/costmap_2d/costmap_plugins/static/
- https://github.com/ros-navigation/navigation2/tree/jazzy/nav2_bt_navigator
