# Robot MCP Contract

## Step 3 状态

- Contract 已定义
- Mock Robot 已实现
- Mock World 已实现
- InProcess gateway 已实现
- 真实 MCP transport 尚未接入

Contract compatible ≠ MCP transport verified。

`McpRobotGateway` 仅保留未来 transport 的接口边界。当官方 MCP SDK 或真实
transport 尚未配置时，它返回 `NOT_CONFIGURED` / `UNAVAILABLE`，不自行实现
冒充 MCP SDK 的协议。

## 工具

工具定义、输入输出名称、错误枚举、只读性、副作用和安全重试属性位于
`services/robot-mcp/src/contract/tools.ts`，schema 文档位于 `schemas.ts`。

- `get_robot_state`：读取结构化机器人状态，只读、无副作用、可重试
- `get_world_state`：读取 Agent-visible 地图，只读、无副作用、可重试
- `get_observation`：读取当前普通观察，只读、无副作用、可重试
- `navigate_to`：按地图图结构导航，有副作用，当前不安全自动重试
- `inspect_room`：主动检查当前房间，有副作用，可安全重试
- `inspect_object`：主动检查对象，有副作用，可安全重试
- `stop_robot`：停止机器人，有副作用，可安全重试
- `list_known_locations`：读取已知位置，只读、无副作用、可重试

所有接口都返回结构化数据。导航失败支持 `PATH_BLOCKED`、`UNREACHABLE`、
`TIMEOUT`、`ROBOT_STOPPED`、`UNKNOWN` 等原因，并可带有 `blocked_route` 和
`obstacle_id`。

## 安全边界

LLM 或上层 Agent 只能调用这些高层工具。Contract 不暴露 `cmd_vel`、wheel
velocity、joint position 或 motor torque，因此未来 ROS2/Gazebo adapter 也
必须在该边界之后实现。

## Gateway 切换

```text
InProcessRobotGateway
        -> RobotGateway contract
McpRobotGateway
        -> future Robot MCP Server
        -> future ROS2 adapter
```

Plugin 只依赖统一 `RobotGateway` / `RobotClient` 类型，不依赖 MockRobot 的
内部实现。
