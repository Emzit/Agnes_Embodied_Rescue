# Step 3 Mock World

## 地图图结构

Mock World 使用无向图和 BFS，不用固定剧情分支：

```text
Start -- Room_A -- Corridor_A -- Room_B
             \-- Room_C -- Side_Corridor --/
```

主路线的 BFS 顺序是 `Start -> Room_A -> Corridor_A -> Room_B`。备用路径同样
存在于图中：`Room_A -> Room_C -> Side_Corridor -> Room_B`。

## 动态障碍

调用 `block_corridor_a()` 后，`Corridor_A` 被标为 blocked，相关路线绑定
`cabinet_01`。机器人不会偷偷改走备用路径；如果当前静态计划经过该障碍，
`navigateTo("Room_B")` 返回 `PATH_BLOCKED`。上层 Agent 必须记录失败、增加
重规划次数并生成新候选。

重规划候选中的 `route_via_room_c` 只是决策层候选名。机器人实际能否到达
每个位置仍由图搜索和当前障碍状态决定。

## Ground truth 隔离

模拟器内部知道 `researcher_01` 在 `Room_B`，但 `getWorldState()` 不返回该
信息。只有机器人进入 `Room_B` 并调用 `inspectRoom("Room_B")` 后，观察结果
才包含 researcher。普通观察不会自动提高 object_17 的置信度。

## 主动感知

在 `Room_A` 的普通观察中，object_17 的标签置信度为：

- `fire_extinguisher`: 0.55
- `toolbox`: 0.38

只有显式调用 `inspect_object("object_17")` 才会得到
`fire_extinguisher: 0.94`。这使主动感知计数和 World Memory 更新保持可追踪。
