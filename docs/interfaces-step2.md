# Step 2 接口

## Backend tools

以下函数是高层结构化工具的最小形状：

- `mission_get_state()` -> `MissionState`
- `mission_reset()` -> `MissionState`
- `world_memory_get()` -> `WorldMemory`
- `world_memory_update(update)` -> `WorldMemory`
- `decision_score_candidates(input)` -> `DecisionResult`
- `robot_get_state()` -> `RobotState`
- `robot_navigate_to(location)` -> `NavigateResult`
- `robot_inspect_room(location)` -> `InspectRoomResult`
- `robot_inspect_object(object_id)` -> `InspectObjectResult`

这些函数没有长篇自然语言 reasoning，后续可以逐个映射到 Agnes 的
`registerTool()`。

## DecisionProvider

输入包含 `goal`、`world_state` 和 `candidates`。输出包含
`selected_action`、`scores`、`reason_codes` 和 `provider_name`。

fallback 的默认公式如下：

`score = 0.4*safety + 0.35*success + 0.1*(1-cost) + 0.15*information_gain`

所有特征先限制在 0 到 1。分数越高越优；候选顺序用于相同分数时的确定性
选择。Jev 没有真实 API 时返回 `NOT_CONFIGURED` 和 `UNAVAILABLE`，系统选择
fallback，并通过结果中的 `provider_name` 记录实际 provider。

## RobotClient

RobotClient 只有 `getState`、`navigateTo`、`inspectRoom`、`inspectObject` 和
`stop`。它不包含 ROS2 类型或网络细节。导航失败可带有
`PATH_BLOCKED`、`UNREACHABLE`、`TIMEOUT` 和 `obstacle_id`。

## World Memory 更新

更新通过 `updateWorldMemory(memory, update)` 完成，返回新对象，不依赖 LLM
文本。房间、路线和对象采用结构化数组，并对已知房间和路线做去重。
