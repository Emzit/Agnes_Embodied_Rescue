# 场景外观资产
所有网格、纹理由本项目脚本生成，没有下载游戏资产、人物扫描或第三方模型；来源及 SHA256 记录见 manifest.json。人物为通用成人示意模型，不代表真实人物。
墙面：交错砂岩石块、矿物颗粒、灰缝、风化色差。地面：磨损石板、细灰缝。布料、裤装、皮革和皮肤使用独立纹理。
纹理为 768 × 768 PNG，使用 SDF 1.9 PBR metallic/roughness、albedo、normal 与 roughness maps；墙面/地面 UV 按实际米制重复，石块约 0.6 × 0.3 米，地砖约 0.6 米。
scene_style.py 在编译时仅替换渲染网格、材质与灯光，不更改墙体/地面碰撞或导航先验。人物继承原场景的静态、无碰撞属性，仅改变外观和合理身高。
已提交生成资产，普通场景编译无需 NumPy。重新生成：从项目根运行 runtime/ros2-jazzy/.pixi/envs/default/bin/python -B simulation/visual_assets/generate_assets.py（使用现有 ROS 环境中的 NumPy，无新依赖）。

当前莲华场景以 metadata.visual_style=lotus_fire 显式启用火灾外观：Gazebo 原生动态火焰、烟羽、火星、点光、焦黑木材与墙面烟渍，文件和哈希见 fire_manifest.json。火灾效果为视觉演示，不计算燃烧、温度或烟气流场；粒子不影响激光碰撞，也不改变地图先验。火灾材质由 fire_generate.py 生成，未调用其他厂商模型或下载第三方素材。取消该外观标记后，编译恢复普通材质场景。

办公室 office_fire 当前外观 v4：office_fire_v4.py 保留第6工位纸柜、前墙纸架、右墙线缆的真实燃料几何和上层烟，去除所有整团火焰/顶火粒子图。volumetric_fire 内的小型 Gazebo Sim 系统插件在原生 Ogre2 相机渲染中以射线积分连续三维密度场，生成三处向上火体和三处水平贴顶火体；火体代理区域互不重叠，完整包络位于墙和天花板内侧。每体默认36步，只有烟和微小火星仍用粒子。实际表现与帧率以真实相机验证为准，不声称是燃烧流体模拟。

自写 GLSL 与 C++ 均无外部模型调用、无下载火焰图片。保留 v3 源文件供旧场景复现；普通 office_fire 编译使用 v4。先运行 python3 simulation/visual_assets/volumetric_fire/build.py 构建项目内原生插件，随后按现有场景切换事务生成场景。插件二进制和着色器均留在项目工作区。五盏源相关火光仍由现有控制器更新；不再运行火焰粒子几何/发射率更新。

 office_damage.py 与 office_damage_generate.py 在编译期调用项目已安装的 NumPy，把烟熏、起皮、裂纹法线和粗糙度烘焙到原有表面的不透明 PBR atlas。13个 atlas 含 mip 约25.1 MiB，只增加两块下垂吊顶的视觉网格；无黑色贴片、透明洞、地面碎片或新增碰撞。每次编译的 office-damage.json 与资源 manifest 记录来源、哈希和预算。

 simulation/final_rescue/office_fire_dynamics.py 运行在原有 dynamic_scenario 进程中，由现有 ROS /odom 消息时间戳提供仿真时间，发送受限的灯光和粒子消息；避免 Gazebo Python subscriber 与同步 RPC 的回调互锁。它不移动机器人或门，不改碰撞、导航、传感器或模型调用。缺少配置时不启用；配置/渲染通讯失败退回静态效果，不终止宿主控制器。实际更新率与失败计数写到编译目录的 office-fire-runtime.json；目标频率不代表实测帧率。
