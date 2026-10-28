# Agnes Embodied Rescue 复现指南

[English](REPRODUCING.md) | 简体中文

[项目介绍](../README.zh-CN.md) · [系统架构](../README.zh-CN.md#系统架构) · [集成标准](../README.zh-CN.md#集成标准)

本指南区分离线源码检查与实时仿真，两条路径的要求与验收标准不同。

| 路径 | 要求 | 可以确认什么 |
| --- | --- | --- |
| 离线检查 | Node.js 24.10+；Python 已测版本为 3.12 | 选定逻辑与接口边界，不调用模型或驱动机器人 |
| 实时仿真 | Linux、授权 Agnes Provider、ROS2/Nav2/Gazebo 与已配置的本地运行环境 | 当前相机/位姿证据、原生会话与真实仿真工具连通 |

实时链路已在演示服务器上运行验证，全新机器的完整安装尚未独立验证。已安装工具链、私有配置、办公室 AMCL overlay 和生成的原生二进制不随源码分发。

## 1. 获取源码并运行离线检查

```bash
git clone https://github.com/Emzit/Agnes_Embodied_Rescue.git
cd Agnes_Embodied_Rescue

node --version
python3 --version

node --test \
  services/robot-mcp/tests/navigation-lifecycle.test.ts \
  services/robot-mcp/tests/perception-output.test.ts \
  services/robot-mcp/tests/vlm-turn.test.ts \
  packages/embodied-rescue-plugin/tests/runtime-entry.test.ts

python3 -B -m unittest discover \
  -s services/robot-mcp/tests -p 'test_doorway_navigation.py'
```

选定测试预期为 19 项 Node 测试与 6 项 Python 测试。它们使用测试替身，不能代表实时任务成功率。根目录 `pnpm test` 选择的文件范围不同，不能作为等价替代。

Harness 源码直接包含在 `third_party/agnes-harness`，不需要初始化 Git submodule。

## 2. 核查路径与运行前提

| 组件 | 已演示配置 |
| --- | --- |
| 操作系统 | Ubuntu / Linux x86_64，Pixi 工作区为 `linux-64` |
| Node.js / pnpm | 24.10.0 / 10.34.5 |
| Pixi | 0.81.0 |
| 机器人软件 | ROS2 Jazzy、Nav2、Gazebo Sim 8 |
| 模型 | 授权的 `agnes-ai` Provider，任务与视觉均使用 `agnes-3.0-flash` |
| 隔离 | 默认栈使用 `ROS_DOMAIN_ID=106`、`GZ_PARTITION=agnes_final_rescue` |

部分脚本仍包含原工作区绝对路径，启动实时环境前应逐项迁移；设置一个根目录变量不会自动改写它们。可用以下命令定位：

```bash
git grep -nE '/data-ssd/[^/]+/agnes' -- \
  scripts services demo packages simulation runtime
```

上述离线检查可在普通克隆目录运行，完整栈与地图导入器有更严格的路径依赖。Windows 浏览器可访问 Linux 部署；Windows 本机原生运行完整栈不在验证范围内。

## 3. 安装工具链与依赖

从官方发行渠道取得 [Node.js 24.10](https://nodejs.org/dist/v24.10.0/) 与 [Pixi 0.81.0](https://github.com/prefix-dev/pixi/releases/tag/v0.81.0)，核对校验和，准备 `pnpm@10.34.5`。启动器预期本地结构为：

```text
tools/
├── node/bin/node
├── node/bin/pnpm
└── pixi/bin/pixi
```

可执行文件准备完成后，从仓库根目录运行：

```bash
source scripts/use-local-toolchain.sh

pnpm --dir third_party/agnes-harness install --frozen-lockfile
pnpm --dir services/robot-mcp install --frozen-lockfile

tools/pixi/bin/pixi install --locked \
  --manifest-path runtime/ros2-jazzy/pixi.toml

pnpm --dir third_party/agnes-harness --filter @agnes/cli build:local
```

Harness 原生构建要求见随附[安装指南](../third_party/agnes-harness/docs/guide/install.zh-CN.md)。环境 MCP 复用 `services/robot-mcp/node_modules` 下的依赖。

办公室额外要求：

- **AMCL overlay：**运行环境预期 `runtime/ros2-jazzy/overlays/amcl/lib/nav2_amcl/amcl`，需准备 Jazzy 兼容构建；该本地 overlay 不在当前 Pixi 清单内，见 [stack.py](../scripts/phase9d/stack.py) 与 [office-localization.mjs](../scripts/interactive/office-localization.mjs)。
- **原生火焰渲染插件：**先核查[构建要求](../simulation/visual_assets/volumetric_fire/README.md)，再执行 `python3 -B simulation/visual_assets/volumetric_fire/build.py`；需单独准备 Gazebo/Ogre 开发依赖与着色器校验工具。
- **渲染与传感器：**核对主机的 Gazebo/Ogre 相机渲染、图像编码与模型连通性，不能用 Pixi 安装成功替代这些验证。

## 4. 配置 Agnes、插件与 MCP

按随附[首次运行指南](../third_party/agnes-harness/docs/guide/quickstart.zh-CN.md)配置自己的模型授权。项目使用 `AGH_HOME=<项目根目录>/.agh-home-step7` 与 Profile `local-dev`，图像适配器要求 Provider 为 `agnes-ai`、模型为 `agnes-3.0-flash`。

API Key、账号 Profile、daemon 认证文件和会话数据库不得提交到 Git，不要复制其他安装实例的私有运行目录。

通过 Harness 包管理流程安装、信任并启用 `file:./packages/embodied-rescue-plugin`。该插件注册后端工具、搜救 Skill 和图像会话预设。使用受支持的 [MCP 配置接口](../third_party/agnes-harness/docs/guide/mcp.zh-CN.md)设置两个受管服务：

| 字段 | Robot MCP | 环境 MCP |
| --- | --- | --- |
| `serverId` | `robot-mcp` | `envdoor` |
| `transport.kind` | `stdio` | `stdio` |
| `transport.executable` | `<项目根目录>/tools/node/bin/node` | `<项目根目录>/tools/node/bin/node` |
| `transport.args` 入口 | `<项目根目录>/scripts/final-rescue/mcp-launch.mjs` | `<项目根目录>/scripts/final-rescue/environment-interaction-launch.mjs` |
| `secretBinding` | `{"kind":"none"}` | `{"kind":"none"}` |

将 `<项目根目录>` 换为已核对的绝对路径。服务继承项目隔离环境；MCP 无独立 secret binding 不代表模型 Provider 不需要授权。

核查插件可信且运行、两个服务 ready、Robot MCP 暴露八个预期工具。工具名称不能单独证明后端为真实 ROS，应同时检查启动器与 `ROBOT_GATEWAY=ros2`。历史 `scripts/step7-prepare.mts` 注册 mock 机器人工具，不能作为实时初始化入口。

## 5. 启动配置完成的实时环境

先核对活动任务、导航 Goal 与运动 lease，尽量复用已确认归属的项目服务，不因端口占用就停止无关进程。

在项目根目录的一个终端启动原生 Web：

```bash
bash scripts/start-step7-agnes.sh
```

已配置的冷启动环境使用第二个终端：

```bash
bash scripts/interactive/start.sh
```

第二个入口会启动/复用仿真、配置并启用受管资源、执行真实 Provider/工具探测、启动相机适配并更新本地状态，不是仅启动 UI，需要模型和网络。其历史准入探测引用 `D_A_Link`；若当前地图无此房门，应诊断 ID 不匹配，不能推断所有门都不可用或反复重跑启动。

单独执行 `bash scripts/final-rescue/start-stack.sh` 只启动机器人栈，不代表模型、原生 Session 或相机展示已经准备完成。

启动或复用演示 UI 与只读监控：

```bash
python3 scripts/demo-ui-final/start.py
```

该 UI 入口不重置仿真、不初始化模型凭据、不发导航。访问 **http://127.0.0.1:4177/demo**。

远程访问时使用自己的 SSH 账号和主机：

```bash
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:4177:127.0.0.1:4177 YOUR_USER@YOUR_SERVER
```

当前代码通过 `/agh-rpc` 代理原生 WebSocket，正常只需转发 4177；旧部署可能还需单独转发 daemon 实际 WebSocket 端口。不要将未鉴权的机器人或模型服务暴露到公网。

## 6. 核对状态并发起任务

读取本地状态接口：

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:4177/api/demo-ui/state
```

核对原生 Session 关联、ROS/TF 位姿与相机帧新鲜、导航空闲、无活动 Goal、运动 lease 可用。响应含本机运行标识，分享前需检查和脱敏。

先问“现在机器人在哪里？”，将真实 `get_robot_state` 结果与地图对应，再发送“请找到一个待救援人员。”。若验收还包括开门、入室、接近、复检和停止，应明确要求并保留追加指令。

成功应由相关工具终态、位姿、当前图片和停止状态证明，不能只根据模型回合结束或组件 `READY` 推断所有物理子目标完成。

## 7. 导入并切换布局

使用[办公室骨架](../maps/imported/office_fire/office_skeleton.json)了解格式，上传、命名和预览后再显式确认物理切换。切换要求任务/导航空闲及运动锁检查，之后核对新地图、位姿、相机和 Session 关联。

在已经完成路径适配的项目工作区，可不启动 Gazebo 而单独校验几何：

```bash
python3 -B scripts/map-import/map_import.py validate \
  maps/imported/office_fire/office_skeleton.json
```

导入器仍校验配置的工作区边界，该命令不属于第 1 节可在任意克隆目录执行的离线测试。空间先验与初始门状态不能证明当前门状态，也不能提供当前人员视觉证据。

## 8. 排障与问题反馈

| 现象 | 优先核查 |
| --- | --- |
| 页面打开但原生对话不响应 | Provider 配置、Session 连通性、`/agh-rpc` 握手；旧部署再核对实际 daemon 端口 |
| 能对话但无机器人工具 | `local-dev` Profile、救援插件启用、真实 MCP 启动器 |
| 相机黑屏或陈旧 | 帧时间和 `/api/demo-ui/camera.jpg`，区分呈现故障与采集/推理故障 |
| 办公室定位失败 | AMCL overlay、当前地图参数与 `map` / `odom` / `base_link` 变换 |
| 场景切换被拒绝 | 活动 Goal、运动 lease、原生待审批项与观察器时效 |
| 导航超时或任务部分完成 | 实际 Nav2 终态与操作所有权，不重复下发 Goal，不从超时推断到达 |
| 历史媒体/提交页面不可用 | 依赖本地产物，使用[公开演示](https://www.bilibili.com/video/BV1F1J66YEkB/) |

反馈时记录提交、环境版本、地图、复现步骤及离线/实时测试类型。删除凭据、私有会话数据、联系方式和未审查的轨迹，保持 ROS/Gazebo 隔离，仅对已确认归属的项目进程执行恢复。
