# Robot MCP boundary

## Phase 10 ROS2 backend

All eight MCP tools have real ROS2 implementations. Phase10 uses real Gazebo RGB
pixels for demo marker perception, official Nav2 physical scans and active object
reinspection, and the Phase9F static registry plus observation-derived memory.
There is no mock fallback. Names and input schemas are shared with the mock backend.
See `simulation/phase10/README.md` for limits, odometry source and acceptance.

## Phase 9B historical transport baseline

`ROBOT_GATEWAY=ros2` selects `Ros2RobotGateway`; the default `mock` backend stays
available. Both backends expose the same eight MCP names and input schemas.
At the Phase9B milestone, the ROS2 backend implemented only `get_robot_state`, `navigate_to`, and
`stop_robot`. The other five were unavailable at that milestone;
no mock world is instantiated in ROS2 mode.

`Ros2RobotGateway` manages a persistent rclpy JSONL subprocess. The bridge reads
`/odom`, calls `/navigate_to_pose` with the standard `NavigateToPose` action type,
and cancels goals while publishing a zero `Twist` on `/cmd_vel` when stopped.
Requests have ids and deadlines; stdout is JSONL only. MCP results retain
`status` and `target`, adding action acceptance, goal id and action result.
ROS2 pose/velocity/timestamp are measured; no mock battery or world is invented.

`ROBOT_WAYPOINTS_FILE` points to a project-owned JSON registry mapping location
names to `{x, y, yaw?, frame_id?}`. This keeps `navigate_to({location})` unchanged.
Unregistered locations fail explicitly. A later actual Nav2 server can provide
the same action without changing the MCP input contract.

The fixture `ros2_bridge/phase9b_nav_fixture.py` is **not Nav2**: it verifies real
ROS2 action/pub-sub transport and cancellation only. It does not model physics,
collision avoidance, localization or Nav2 planning. No Gazebo is used.

Run the isolated acceptance and regression tests from the project root:

```bash
source scripts/use-phase9b-env.sh
PHASE9B_ROS2_TEST=1 tools/node/bin/node --test \
  packages/embodied-rescue-plugin/tests/*.test.ts services/robot-mcp/tests/*.test.ts
```

The acceptance starts its own fixture, official MCP server and SDK client,
verifies A-to-B, cancels a long goal and checks a new zero Twist and stationary
odometry. It preserves evidence in `artifacts/phase9b`, logs in `logs/phase9b`,
and closes only the processes it starts. DDS uses loopback UDP, with isolated
HOME/TMP/log directories and no ROS CLI daemon. Test waypoint names are fixture
configuration, not an agent planner or rescue route.

The remaining sections describe the original Step 3 baseline.

这是独立于 `embodied-rescue-plugin` 的机器人能力边界。Step 3 只提供稳定的
contract、纯内存 Mock World/Robot 和 in-process gateway，不连接真实 Agnes、
MCP SDK、ROS2、Gazebo 或 Webots。

## 已实现

- `src/contract/`：工具名、输入输出类型、错误码、schema 文档
- `src/mock/`：基于图结构和 BFS 的 Mock World、Mock Robot、确定性观察
- `src/transport/in-process-gateway.ts`：当前可用的进程内 adapter
- `src/transport/mcp-gateway.ts`：未来 transport 的明确未配置占位

Robot 能力只暴露高层导航、观察、房间检查和对象检查。没有
`cmd_vel`、wheel velocity、joint position 或 motor torque 接口。

`McpRobotGateway` 没有伪造 MCP 协议或 JSON-RPC。当前状态是：Contract
compatible，但 MCP transport 未验证。
