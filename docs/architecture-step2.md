# Step 2 架构

## 边界

`embodied-rescue-plugin` 负责救援任务的高层能力：mission 状态、World Memory、
候选行动决策、Skill 方法和 RobotClient 调用抽象。它不修改 Agnes Core，当前
也不依赖真实 Agnes runtime。

```text
Mission Control panel
        |
        v
backend tools -> MissionState / WorldMemory
        |
        +-> DecisionProvider -> Jev (可用时)
        |                    -> fallback (默认可用)
        |
        +-> RobotClient -> 未来的 Robot MCP / ROS2 adapter
```

前端 panel、Robot MCP、ROS2/Gazebo 和 Jev 都是独立边界。插件只依赖稳定的
TypeScript 接口，因此未来接入真实实现时不需要改变任务状态模型。

## 当前实现

- backend tools 是纯内存闭包，接口命名可映射到未来的 `registerTool()`。
- `WorldMemory` 用结构化字段保存位置、房间、路线、对象、危险和动作历史。
- fallback 使用可调权重的确定性评分。
- Jev provider 只返回 `NOT_CONFIGURED` / `UNAVAILABLE`，没有伪造集成。
- `MockRobotClient` 仅用于本地接口演示，不执行网络或机器人调用。
