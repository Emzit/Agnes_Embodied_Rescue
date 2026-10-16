# Embodied Rescue 方法

本 Skill 只描述如何执行救援任务，不负责权限、身份认证或工具授权。

## 执行方法

### 通用安全与收尾规则

- 对环境安全、人员搜救或通行风险相关的观测，如果最高置信度低于
  `0.80` 且存在主动复检工具，先调用 `inspect_object`，复检之后仍低于阈值或 `still_uncertain=true` 时，只记录为可疑线索，
  不可写入 `found` 或宣称确认人员；应选择新的有效视角或继续搜索其他区域。
  `SUCCEEDED` 只代表检查动作成功，确认目标需 `target_verified=true` 和真实视觉证据。
- 确认目标已找到后，不要在同一任务中调用 `mission_reset`；只有开始
  新任务时才重置。任务完成前重新读取当前状态和 WorldMemory。
- 任务完成后的摘要应包含已确认的目标状态、阻塞路径或环境风险，以及
  主动复检确认的重要对象。

1. 读取当前 MissionState 和 WorldMemory。
2. 不重复搜索已经完成的房间。
3. 导航失败时，将失败路线和结构化原因写入 `blocked_routes`。
   如果连续 3 次底层导航出现相同的 `ABORTED`/`TIMEOUT`/`error_code=104`，停止尝试新的地点；检查 robot/world state，执行一次真实 recovery 后仍失败就返回 `NAVIGATION_SYSTEM_UNHEALTHY` 并报告系统故障。
   不要把上一任务的 current location、blocked route、target status 或历史 observation 当成本任务已确认事实；历史 world fact 必须带 provenance、observed_at 和 source，并在本任务重新观察后才能引用为当前事实。
4. 根据目标和当前状态生成多个候选行动。
5. 将候选行动交给 DecisionProvider 评分，不在 Skill 中写死策略。
6. 如果感知置信度低于阈值，主动调用 `inspect_object`。
7. 执行动作后优先验证工具返回的结构化终态和证据。
   导航返回 `SUCCEEDED` 时可直接使用该终态；`PENDING` 时只用
   `get_robot_state` 轮询相同 `navigation_operation_id`，直到
   `navigation_terminal_known` 且终态为 `SUCCEEDED`，不要重复发起导航。
   环视只轮询同一 `inspection_id`，完成后复用其真实八帧结果。
   `get_world_state` 和 `get_observation` 每次都会执行 Agnes 视觉识别，
   不用于廉价状态轮询。开门返回 `camera_after_motion=true` 且
   `verification.fresh_camera_observation.perception_status=AVAILABLE`
   时直接使用该新帧；继续移动或视觉失败后再获取新观测。
8. 将位置、观察、动作结果和计划变化写回 WorldMemory。
9. 任务完成后输出简短的结构化摘要。

房间和路线由当前 WorldMemory、传感器结果和候选行动决定，不把固定的
Room A / Room B 路线写成唯一脚本。
