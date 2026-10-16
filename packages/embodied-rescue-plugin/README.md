# Embodied Rescue Plugin

这是一个 Plugin-first 的 Agnes 插件骨架，承载具身救援任务的高层状态、
World Memory、决策接口和 RobotClient 抽象。当前实现只包含结构化接口与
纯内存 mock，不连接 Agnes runtime、MCP、ROS2、仿真器或 Jev 服务。

## 为什么采用 Plugin-first

插件负责任务领域能力，便于以后通过 Agnes 的注册接口接入，同时保持前端、
机器人适配器和决策提供方可以独立演进。核心系统不需要知道救援任务的具体
状态模型，也不需要绑定某一个决策引擎。

## Plugin 负责什么

- mission 状态读取与重置
- World Memory 的结构化读取与更新
- 候选行动的 DecisionProvider 调度
- fallback 决策和 Jev 可插拔占位
- 面向 Mission Control 的后端数据接口
- 面向 RobotClient 的高层机器人操作工具

## Plugin 不负责什么

- 不修改 Agnes Core，也不实现真实 `registerTool()` 调用
- 不实现 Robot MCP Server 或网络传输
- 不实现 ROS2、Gazebo、Webots 或视觉模型
- 不管理权限、身份认证或前端渲染
- 不把自然语言推理当作唯一状态来源

## Jev 为什么是可插拔的

决策接口先稳定下来，Jev 以后可以作为一个 provider 接入。当前没有真实 Jev
API，因此 `JevDecisionProvider` 只返回 `NOT_CONFIGURED` / `UNAVAILABLE`，
不会伪造官方集成。运行时应在 Jev 可用时选 Jev，否则选 fallback，并记录
实际使用的 provider。

## Robot MCP 为什么独立

Robot MCP 是机器人能力的边界，不应和任务编排、决策策略或 Agnes 插件绑死。
插件只依赖 `RobotClient`，以后可以接入真实 MCP/ROS2 adapter，而不改任务层。

## 后续 Step 3

Step 3 将定义 Mock Robot 和 MCP contract，验证工具输入输出、导航失败、房间
观察和状态更新的完整链路。本 Step 不提前实现那些运行时连接。
