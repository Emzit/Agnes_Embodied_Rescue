Phase 9E uses the Phase 9D differential-drive robot and official Nav2 servers.
The world adds real Gazebo GPU LiDAR and RGB Camera sensors (Ogre2/EGL,
`gz sim -s -r --headless-rendering`). No GUI or DISPLAY is used.

Run acceptance from the project root:

```sh
source scripts/use-phase9e-env.sh
PHASE9E_SENSORS_TEST=1 tools/node/bin/node --test services/robot-mcp/tests/sensors.test.ts
```

Scan: 360 rays, 10 Hz, 0.1–12 m; sensor offset x=0.1 m, z=0.22 m.
Camera: RGB 320×240, 5 Hz; sensor offset x=0.25 m, z=0.22 m.
The red box's front face at x=2.7 m gives an initial front scan of about 2.6 m.
The blue cylinder provides a second distinct visible geometry.
These are geometry/pixel validation targets, not semantic recognition results.

The bridge preserves all eight MCP tools and their input schemas. Observation
retains location/observations/object_observations, with additive raw sensor
summaries and `source=ros2_real_sensors`. Semantic arrays are always empty.
Unavailable/stale sensors are explicitly marked unavailable, never mocked.
NumPy computes image statistics; OpenCV/cv_bridge are not needed.

`/scan` is NOT configured as a Nav2 obstacle source. The unchanged Phase 9D
static/inflation costmaps, official NavFn/RPP, and identity map→odom assumption
remain a minimal fixed-map test, not a production localization/safety system.
Sensor mounting TF is static; odom→base_link comes from actual Gazebo odometry.
The test turns the real robot with an official Nav2 goal to validate view change.
camera-frame.png is encoded directly from ROS2 Image bytes, not a screenshot.

Process supervision uses a separate Phase 9E PID/start-time registry and only
stops owned processes. Logs and caches stay inside the project.

Official references:
- https://gazebosim.org/docs/harmonic/sensors/
- https://gazebosim.org/api/sim/8/headless_rendering.html
- https://gazebosim.org/docs/harmonic/migrating_gazebo_classic_ros2_packages/
