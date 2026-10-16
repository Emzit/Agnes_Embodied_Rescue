# 火灾视觉资产

此模块给当前 50% Lotus 演示地图叠加火焰、烟羽、火星、暖色火光和焦黑痕迹。原有墙面/地面的 PBR 材质继续由 scene_style.py 负责。

这些是仿真视觉效果，不是燃烧、热传导、烟气流动或人员疏散求解器；不能作为真实火灾危险程度、温度或能见度的量测依据。火点是地图固定的演示布景，不替代场景控制器的 hazard 语义对象。所有新增模型无碰撞；所有粒子 particle_scatter_ratio 为 0，避免为现有激光导航引入未经验证的散射噪声。

## 接口

在 Lotus 地图的原有外观处理完成后调用：

    from simulation.visual_assets.fire_scene import apply_fire_style
    apply_fire_style(world_element, compiled_output_directory)

仅适用于当前 Lotus 24 × 20 米布局，应由调用者按地图 ID 限定，不应自动应用于任意导入地图。三处火点靠 B_Main / B_Site 两侧墙壁，默认相机 (0,-8)、朝北可见近端火点。中心通路未增加碰撞。函数可重复调用，不会重复添加模型或插件。

正常地图编译仅需 Python 标准库；全部 PNG 已由 fire_generate.py 生成并保存。生成路径和 SHA256 在 fire_manifest.json。全部视觉素材由项目程序生成，没有下载材质/模型，也未调用任何 AI 模型。

## 重建和离线检查

从项目根目录运行：

    runtime/ros2-jazzy/.pixi/envs/default/bin/python -B simulation/visual_assets/fire_generate.py
    python3 -B simulation/visual_assets/fire_check.py

生成器只使用项目现有 NumPy。离线检查验证原有模型的 pose、collision、sensor XML 不变；新增模型无 collision/sensor；粒子散射为 0；路径及资产 SHA256 有效；重复调用幂等；本项目 Gazebo 的 gz sdf -k 解析通过。检查输出在 fire_checks/，不会启动或切换实际运行场景。原有机器人 gz_frame_id SDF 扩展警告允许保留。

## 渲染与性能

使用 Gazebo Sim 8 内置 ParticleEmitter 插件，12 个发射器、约 250 个稳态活跃粒子、3 个不投射阴影的点光。火焰和烟雾是连续动画粒子，不是录制视频。烟羽由多频程序噪声和透明纹理形成；寿命色带使粒子逐渐变暗/消散。火光为常亮低开销点光，未声明为动态照度模拟。小幅远景雾只用于空间氛围。

真实启动后的相机画面、动画与帧率须另行在机器人实时页面核验。fire_checks/check.json 的 runtime_image_validated 为 false，仅表示本模块离线检查没有进行运行时画面认证。

## 支持依据

- 官方 Gazebo Sim 8 Particle Emitter 教程：https://gazebosim.org/api/sim/8/particle_emitter.html
- 官方 Gazebo Rendering 粒子材质/寿命色带说明：https://gazebosim.org/api/rendering/7/particles.html
- SDFormat 1.9 link / particle_emitter 定义：https://sdformat.org/spec/?elem=link&ver=1.9

项目安装包含 runtime/ros2-jazzy/.pixi/envs/default/lib/gz-sim-8/plugins/libgz-sim-particle-emitter-system.so，以及 share/sdformat14/1.9/particle_emitter.sdf。RGB 相机支持粒子画面；官方说明粒子可能影响深度/激光传感器，因此此演示明确将 scatter ratio 设为 0。火焰喷射方向使用官方定义的 +X，俯仰旋转 -pi/2 后向 +Z 上升。
