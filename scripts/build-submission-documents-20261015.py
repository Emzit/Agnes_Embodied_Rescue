from pathlib import Path
import json,hashlib,re,sys,subprocess
R=Path('/data-ssd/zhongchengkai/agnes');O=R/'artifacts/submission-materials-20261015';D=O/'package';sys.path.insert(0,str(O/'tooling/python-libs'))
from docx import Document
from docx.shared import Mm,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from PIL import Image,ImageDraw,ImageFont
PH=lambda key:'【待填_'+key+'】'
fontfile=R/'artifacts/demo-video-20261013/assets/fonts/NotoSansCJKsc-Regular.otf'
fig=D/'02_项目报告/图示';fig.mkdir(parents=True,exist_ok=True)
im=Image.new('RGB',(1500,680),'#F5F6F7');draw=ImageDraw.Draw(im)
def font(n):return ImageFont.truetype(str(fontfile),n)
def box(b,title,subtitle):
 x,y,w,h=b;draw.rounded_rectangle((x+3,y+8,x+w+3,y+h+8),radius=25,fill='#E6E8EA');draw.rounded_rectangle((x,y,x+w,y+h),radius=25,fill='white',outline='#CBD0D5',width=2);draw.line((x+25,y+20,x+70,y+20),fill='#F4772D',width=5);draw.text((x+25,y+35),title,font=font(29),fill='#1C1F23');draw.text((x+25,y+82),subtitle,font=font(21),fill='#656B73')
def line(a,b):draw.line([a,b],fill='#F4772D',width=3);draw.ellipse((a[0]-5,a[1]-5,a[0]+5,a[1]+5),fill='#F4772D');draw.ellipse((b[0]-5,b[1]-5,b[0]+5,b[1]+5),fill='#F4772D')
box((55,35,1390,120),'人员通过 AGH 原生对话提出目标','请找到一个待救援人员。   任务会话负责组织观察与行动，保留真实执行记录。')
box((55,205,660,145),'Agnes 模型与 Rescue Plugin','任务拆解  ·  MissionState  ·  WorldMemory  ·  结果核查')
box((785,205,660,145),'Agnes 视觉子会话','当前 Camera 图片输入  ·  人员与房门线索  ·  不调用工具')
box((55,400,660,145),'Robot MCP 与环境交互 MCP','状态读取  ·  导航与主动复核  ·  检查和开启物理房门')
box((785,400,660,145),'ROS2 Nav2 与 Gazebo','激光定位和 TF  ·  执行动作  ·  相机与铰链状态反馈')
line((385,155),(385,205));line((715,277),(785,277));line((385,350),(385,400));line((715,472),(785,472));line((1115,400),(1115,350));draw.text((60,595),'每次判断都关联新的观测、操作编号与动作终态；生成的文字不替代传感器或执行证据。',font=font(25),fill='#1C1F23');im.save(fig/'系统工作链.png')
V=R/'artifacts/demo-project-film-20261015/continuous-narration-v16';F=R/'runtime/ros2-jazzy/.pixi/envs/default/bin/ffmpeg'
subprocess.run([str(F),'-v','error','-n','-ss','193.1','-i',str(V/'project-film-continuous-v16.mp4'),'-frames:v','1',str(fig/'人员复核实录帧.jpg')],check=True)
BASIC=[['作品名称','具身救援 · 从指令到行动'],['作品题目','基于 Agnes 多模态任务会话与地图骨架的室内人员搜寻系统'],['组别与参赛编号',PH('报名组别')+' / '+PH('官方参赛编号')],['队伍名称与队长',PH('队伍名称')+' / '+PH('队长姓名')],['学校与学籍',PH('学校学院')+' / '+PH('学籍身份')],['联系方式',PH('队长电话')+' / '+PH('队长邮箱')],['参考方向','具身智能与机器人；科学工程仿真；多模态交叉应用 '+PH('最终勾选方向')]]
brief='面向已知室内骨架的人员搜寻，将远程自然语言目标交给 Agnes 原生会话。系统结合实时图像、地图位姿与动作反馈，组织观察、导航、开门和复核，并保留可核查记录。'
DOCS=[]
def page(title,blocks):return{'title':title,'blocks':blocks}
def para(t):return{'kind':'paragraph','text':t}
def table(head,rows):return{'kind':'table','head':head,'rows':rows}
def picture(file,caption,width=156):return{'kind':'picture','file':str(file),'caption':caption,'width':width}
DOCS.append({'path':'01_提交表/参赛提交信息','title':'具身救援参赛提交信息','pages':[
 page('基本信息与项目说明',[table(['字段','填写内容'],BASIC),para('作品简介：'+brief),para('场景与目标：救援人员先获得建筑或办公室的房间、走廊、墙体、门洞与出生点骨架，再通过 AGH 给机器人提出人员搜寻目标。机器人利用当前视觉线索选择后续搜索动作；工具负责导航及门操作，新的观测用于核查动作和目标。当前成果为 Gazebo 仿真人员搜寻、接近和视觉确认，不包含人员搬运、撤离或真机火场作业。'),para('成员信息：'+PH('成员1姓名学校学籍分工')+'；'+PH('成员2姓名学校学籍分工')+'；'+PH('其他成员或删除本项'))]),
 page('视频链接和提交附件',[table(['提交字段','待提交内容'],[['演示视频主链接',PH('无需账号登录的视频主链接')],['备用视频链接',PH('备用链接或填无')],['视频访问密码',PH('如需密码填写否则填无')],['视频标题和时长','具身救援 · 从指令到行动；V16 连贯旁白版；3分41.73秒'],['代码或体验链接',PH('代码仓库评委可访问链接或使用随包源码')],['公开内容','内容名称 '+PH('公开内容标题')+'；平台 '+PH('公开发布平台')],['公开内容有效链接',PH('公开内容链接')],['公开发布时间',PH('公开发布年月日时分及时间区')]]),para('演示主视频只填写一个主链接，可选一个备用链接。须在评审期间持续有效，评委不需要登录参赛者个人账号。项目内播放页 /demo-project-film-continuous 用于本机预览，不能替代对外视频地址。按赛事截图要求，正式提交视频为链接；本包不嵌入 MP4，以便保留源码与证据并控制体积。'),para('实录由两个真实阶段剪辑组成。阶段一重置出生点、关闭四扇门并创建新会话，只发“请找到一个待救援人员。”，模型自行搜索并观察到人员；阶段二在同一场景追加明确开门、入室、接近和复核的指令。影片含节奏剪辑、技术动画与后期旁白，不是未经剪辑的一轮单句全程自主救援。'),para('附件阅读顺序：02_项目报告 → 03_复现与测试 → 04_可核查运行证据。05_源码与配置含当前源文件快照、AGH 适配补丁和文件哈希。06_声明与公开材料供成员审核、签署及补齐发布证明。')])
]})
DOCS.append({'path':'02_项目报告/具身救援项目技术报告','title':'具身救援项目技术报告','pages':[
 page('使用场景和已完成的工作',[para('本项目尝试把远程人员提出的大任务变成室内机器人能够执行、观察和核查的步骤。建筑骨架提供房间连通关系和安全的导航先验，Agnes 负责语义任务组织及图像理解，ROS2 与 Gazebo 提供可量测的位姿、相机、动作状态和门扇物理反馈。'),para('我们已建立 AGH 原生聊天、机器人第一视角与实时位置导航的联合界面。真实日志记录了搜寻到人员线索、开启右前房门、进入房间、多视角复核及主动停止。单句搜寻与追加指令复核分别核查，不把两阶段的剪辑合成说明为同一个自主任务。'),picture(fig/'系统工作链.png','图1 任务会话 视觉子会话与机器人执行之间的工作链'),para('四房间办公室场景依据团队提供的骨架草图和室内视频进行程序化建模。平面推定为 18×16 米，包含四扇初始关闭的侧铰链门及六套工位。火焰、烟雾、室内材质和人物用于机器人视觉演示。')]),
 page('Agnes 模型如何处理任务和图像',[table(['环节','模型与实际调用','依据'],[['任务组织','agnes-ai / agnes-3.0-flash；AGH 原生会话 standard','阶段一 session-plan 与原生事件'],['视觉分析','agnes-ai / agnes-3.0-flash；sensor-image 子会话','vlm-worker.mts 与图像调用结果'],['权重细分版本','API 请求名已核实；更细权重版本 '+PH('主办方权重版本确认'),'不从请求别名推断权重修订号']]),para('任务会话读取技能、MissionState 和 WorldMemory，结合已知位置、当前观测及可调用工具来组织行动。Rescue Plugin 提供状态、记忆和候选行动相关工具；模型通过 MCP 调用导航和观察接口，不直接生成电机转矩或速度命令。'),para('视觉工作器通过官方 SDK 将当前 Camera PNG 作为 image 内容发送给 Agnes。视觉子会话只分析画面，不允许调用机器人工具；输出人员、门等标签、像素边界框和模型置信度。无效 JSON、超时和取消不能被当成“没有目标”。真实证据关联帧时间戳、SHA256、图像尺寸及所处观察位姿。'),para('图像中的位置属于像素坐标，不能直接当作地图坐标。办公室使用激光、里程计及 AMCL 支持定位，TF 给出 map 到 base_link 的机器人位姿。系统结合图像线索、已知语义区域和可量测位姿选择下一处观察位置；当前画面未见人员，不代表整个房间无人。'),para('本地 AGH 适配覆盖图像能力透传、MCP 结果图像及产物投影、worker/Web 接口与回归测试。固定上游提交为 fe90962a6b8561d8cae7e5d451905604fcf475cf；随包源码已包含当前修改，补丁用于审核，不重复应用。')]),
 page('动作反馈 任务记忆与骨架切换',[para('Robot MCP 公开八个高层工具：get_robot_state、get_world_state、get_observation、navigate_to、inspect_room、inspect_object、stop_robot、list_known_locations。环境交互 MCP 提供门检查和开门等接口。导航、环视及开门返回 PENDING 时，继续跟踪同一操作编号；状态不明不等于成功，也不应重复下发另一个目标。'),para('inspect_door 需要相机观测与近门条件；open_door 操作真实侧铰链及门把手动画，核查门扇角度、动作后的新相机帧和停止状态后才报告 DOOR_OPEN_VERIFIED。开门后保持开启。停止既检查 stop_robot 工具反馈，也读取 ROS 线速度、角速度和活动目标，区分模型回合结束与机器人完成。'),para('WorldMemory 记录搜索区域、已知线索、受阻路线、行动历史及当前计划。MissionState 整理任务状态与验收信息；Gazebo 保存几何、门状态和传感器等物理世界状态。这些组成可更新的结构化场景与任务记忆。本项目没有训练可预测未来图像或动力学的生成式世界模型，不把程序化 Gazebo 场景称作这种模型。'),para('骨架用 JSON 描述房间、走廊、墙体、门洞、出生点与静态障碍，编译生成 Gazebo 场景、导航栅格及语义位置。上传、命名和预览不自动激活；显式确认且任务空闲、运动锁可用时才切换，并检查新地图、TF 与 Camera，关联新的会话。当前界面保留经典地图和室内办公室，删除莲华选项。'),para('地图切换的真实记录包含经典→办公室、办公室→经典、恢复办公室，均有 SUCCEEDED 与地图、出生点及相机核查。该记录证明已验证布局之间能够切换，不代表任意上传骨架均已完成全场景搜救验证。')]),
 page('可核查结果与能力边界',[table(['场景','实际观测结果','证据范围'],[['单句自主搜寻','初始门关闭、空会话；person 0.90 线索','阶段一完整原生工具记录'],['追加开门与复核','门打开、入室、多视角复核约0.953、STOPPED','阶段二工具与最终 ROS 状态'],['真实失败','两次入室及一次恢复导航 ABORTED/104；部分扫描相机不可用','历史失败原生摘录和相机帧'],['边界单元测试','本次15项视觉/导航边界 + 4项 Plugin 验收测试通过','人工构造输入；不属于实机任务测试']]),para('多视角复核的置信度为模型输出，不是标定准确率。演示人员是仿真目标，不等于真实研究员身份核验；完成的是人员搜寻、接近与视觉确认。真机部署、烟热条件下的鲁棒性和实际救援动作仍需要另外验证。'),para('失败案例中，工具实际记录是两次 Right_Front_Room 和一次 Upper_Connector 导航失败，并非模型总结的“三次均到右前房间”。SENSOR_UNAVAILABLE_OR_STALE 与 error_code=104 是状态或症状，单独不能证明相机硬件故障或具体导航根因。材料保留模型总结及核查差异。'),para('第三方基础包括 Agnes Harness、ROS2 Jazzy、Nav2、Gazebo Sim、MCP SDK、Node、Pixi、字体和视频编码工具。室内材质、火焰和人物程序资产有本项目来源记录；视频和图片只作外观参考，未提取成场景纹理。火场效果不计算燃烧、温度或毒气传播。'),para('后期旁白使用已选的 Qwen3 TTS 通用合成女声09；Codex 参与代码、调试、媒体与材料整理。它们不参与本次机器人运行的视觉和决策，但仍需如实披露。赛事公告限制模型调用，成员应向主办方确认后期配音的适用要求；若不允许，应改用人工录音或主办方允许的方案。')])
]})
DOCS.append({'path':'03_复现与测试/运行复现与测试说明','title':'具身救援运行复现与测试说明','pages':[
 page('复现层次和环境',[para('先复核已保存材料，再运行离线单元测试；真实仿真任务属于另一个层次。源码快照不包含模型 Key、账户 Profile、已安装 ROS 环境或运行指针，不能据此承诺在任意路径一键启动。现有脚本多数固定 /data-ssd/zhongchengkai/agnes，迁移时须先审计和替换路径。'),table(['层次','运行方法','验证什么'],[['离线材料核查','python3 00_审核入口/verify_bundle.py','ZIP CRC、文件 SHA256、证据关联'],['离线边界回归','Node 24.10+ 执行随附测试命令','生命周期、视觉空值与验收边界'],['已有演示机复现','进入指定服务器工作区并检查已有服务','Camera、地图、TF、原生 AGH 工具'],['干净环境重建','依锁文件安装并构建；配置授权 Agnes Key','新部署须重新做完整集成验证']]),para('平台：Ubuntu linux-64；Node 24.10.0、pnpm 10.34.5、Pixi 0.81.0、ROS2 Jazzy、Gazebo Sim 8。Pixi 环境清单与锁文件位于 runtime/ros2-jazzy；额外 AMCL overlay 与运行脚本一起审查。MCP SDK 使用服务 package.json/pnpm-lock 指定的版本。'),para('依赖准备示例：source scripts/use-local-toolchain.sh；pnpm --dir third_party/agnes-harness install --frozen-lockfile；pnpm --dir services/robot-mcp install --frozen-lockfile；tools/pixi/bin/pixi install --locked --manifest-path runtime/ros2-jazzy/pixi.toml。工具可执行文件需按对应官方发行版本先准备。Harness Web/CLI 构建按随包上游说明执行。'),para('隔离标识：ROS_DOMAIN_ID=106，GZ_PARTITION=agnes_final_rescue。只管理本项目进程，不能停止其他 ROS domain 或未知服务。密钥留在本机安全配置，不填写进提交表、不放源码或日志包。')]),
 page('从初始状态开始观察任务',[para('1 检查当前任务、导航目标和运动锁空闲；选择室内办公室骨架。通过现有受控复位入口恢复出生点、四扇 CLOSED 门以及新 AGH 会话。复核当前地图、TF、相机新帧及场景 generation，不直接复制旧会话历史。复位脚本管理真实运行态，运行前应读脚本并确认状态。'),para('2 打开 /demo 原生聊天、机器人第一视角与位置导航界面；原生 WebSocket 使用当前 daemon 实际端口转发。只向新会话发送“请找到一个待救援人员。”，不注入路径顺序。收集实际 UI 消息、模型事件、工具输入输出、ROS 状态及帧时间戳。'),para('3 根据任务验收范围读取结果。人员标签或单帧置信度只是线索。若要求入室接近与多视角确认，在搜索结束后给出明确追加任务，并把它记成第二阶段；核查门扇打开状态、目标房间入室、inspect_object 复核和 stop_robot。'),para('4 下载实录并保留原件，剪辑副本用于展示。记录每段来源、输入任务、提示词追加、删除等待时段以及旁白模型。材料中保存阶段一和阶段二完整日志，不用演示视频代替执行证据。'),para('演示机已有入口：scripts/start-step7-agnes.sh 启动 AGH Web；scripts/final-rescue/start-stack.sh 管理原仿真栈。不要重复启动已运行栈。/demo 的 READY 仅表示页面组件可用，不能当作任务成功。骨架上传不会自动开始导航。'),para('干净服务器需要重新准备工具链、AMCL、Agnes Provider 与 Web 构建，并核查硬编码路径。本材料已验证现有演示机行为，没有重新安装一个全新机器环境；跨机部署不标记为已通过。')]),
 page('正常 边界和失败三类样例',[table(['编号与类别','输入和预期','实际结果与证据'],[['N01 正常','重置后只发搜寻任务；目标为获得人员线索','阶段一 get_observation 显示 person 0.90；原生任务无预设路线'],['N02 正常子任务','追加开门、入室、接近、复核、停止','DOOR_OPEN_VERIFIED；多视角约0.953；最终速度0、无活动目标'],['B01 边界','视觉返回 {} 或空 detections；导航终态未知或迟到','19项构造输入回归通过，空结果不伪造成无人，未知终态不算成功'],['F01 失败','有人员线索后导航入室和恢复；环视要求新帧','两次 Right_Front_Room 与一次 Upper_Connector ABORTED/104；扫描 PARTIAL/0视图']]),para('本次边界测试命令：tools/node/bin/node --test services/robot-mcp/tests/navigation-lifecycle.test.ts services/robot-mcp/tests/perception-output.test.ts services/robot-mcp/tests/vlm-turn.test.ts；共15项。另 tools/node/bin/node --test packages/embodied-rescue-plugin/tests/runtime-entry.test.ts；共4项。完整输出见 04_可核查运行证据/boundary-regression-1.tap 和 -2.tap。构造输入不是故障注入或真实场景准确率实验。'),para('F01 是真实历史失败子项与端到端部分完成案例，没有新造或注入故障。开门后单帧人员线索0.95存在，但未完成入室和近距离复核。最后一次采样速度0、无导航目标；当轮没有 stop_robot 调用，stopped=false，不能写成已验证主动停止。'),para('N02 原生验收器仍报告 PARTIAL，包含路径或约束解析原因；原始结果保留。独立物理状态核查证明门开启、入室、复核和主动停止这些子目标。材料不会把解析器的 PARTIAL 删除或改写为整体 SUCCEEDED。'),para('“正常子目标通过”“失败证据存在”和“19项边界回归通过”各有独立含义，不能据此计算系统总体成功率。后续应扩大骨架、起点、遮挡和传感器失效测试，并在真机上另立验收标准。')])
]})
DOCS.append({'path':'06_声明与公开材料/成员声明与第三方来源','title':'具身救援成员声明与第三方来源','pages':[
 page('成员审核和签署',[table(['声明信息','填写内容'],[['作品','具身救援 · 从指令到行动'],['报名信息',PH('报名组别')+' / '+PH('官方参赛编号')+' / '+PH('队伍名称')],['队长和成员',PH('队长姓名')+'；'+PH('全部成员姓名')],['学校和学籍',PH('学校学院与各成员学籍身份')]]),para('供成员核实后签署：本队对作品需求、方案选择、系统集成、验证方法和提交内容承担责任。成员已理解关键代码和实验结果，并按学校及比赛要求填写真实个人与学籍信息。本声明不得在未审核、未签署时标注为已完成。'),para('本队将如实说明第三方代码、模型、软件、数据、图像、字体及三维资产的来源与使用方式；保留原许可和版权通知。AI 辅助参与代码实现、调试、媒体和材料整理，实际范围见下一页。成员应补充自有工作和分工，不将 AI 辅助或第三方工作表述为全部自行编写。'),para('运行和实验材料保留成功、部分完成及失败结果。剪辑视频含两阶段真实实录、技术动画和后期旁白，追加提示词及验收差异已披露。代码中的历史阶段说明不代替当前证据。项目尚未完成真机火场部署，也没有演示搬运或撤离人员。'),para('成员分工：'+PH('成员1具体负责模块')+'；'+PH('成员2具体负责模块')+'；'+PH('其他成员具体负责模块或删除')),para('队长签名：'+PH('队长手写或电子签名')+'    成员签名：'+PH('所有成员签名')),para('签署日期：'+PH('实际签署年月日')+'    信息审核人：'+PH('审核成员姓名')),para('公开材料记录：'+PH('公开内容标题')+'；'+PH('平台')+'；'+PH('有效链接')+'；'+PH('真实发布时间')+'。公开页面截图由成员发布后保存到本目录；目前没有伪造公开链接、发布时间或截图。')]),
 page('第三方来源与 AI 辅助范围',[table(['来源','使用环节','来源和许可记录'],[['Agnes Harness','原生会话、权限、MCP、执行记录','github.com/AgnesAI-Labs/agnes-harness；固定提交与 Apache-2.0 随源码保留'],['Agnes agnes-3.0-flash','机器人任务决策及图像理解','主办方模型接口；请求名已核实，细分权重版本待确认'],['ROS2 Jazzy Nav2 Gazebo','机器人状态、激光定位、导航和物理仿真','docs.ros.org；docs.nav2.org；gazebosim.org；各上游许可分别适用'],['MCP SDK Node Pixi','接口、运行环境和依赖锁定','官方发行和随包锁文件；不自称项目原创组件'],['程序化场景资产','办公室、材质、门、人形、火焰和烟','simulation/visual_assets 来源说明与 manifest；参考素材未提取为纹理'],['Noto Sans CJK 与 Inter','界面和动画字体','github.com/notofonts/noto-cjk；github.com/rsms/inter；OFL 许可'],['Qwen3 TTS 通用声线09','后期视频旁白，未参与机器人视觉/决策','github.com/QwenLM/Qwen3-TTS；Apache-2.0；合成参考与生成记录保留'],['Codex AI 编码辅助','代码、测试、排错、录像剪辑和材料整理','本次协作记录；成员审核并理解实现'],['背景音乐和图像处理','演示后期音画处理','本地合成 ambient 音频；FFmpeg Pillow NumPy；按实际组件许可使用']]),para('用户提供的骨架、办公室视频及火灾参考图用于外观和布局参考。未将参考视频帧或图库照片直接提取为地图纹理。素材权属和授权：'+PH('团队提供素材的权属及授权说明')+'。若公开发布演示片，成员应确认引用展示及品牌、素材许可适用范围。'),para('赛事规则对模型调用作了限制。Qwen 后期配音和 AI 制作辅助单独披露，不能将它们隐去或称为 Agnes 输出。后期配音是否被赛事允许：'+PH('主办方确认或更换配音结果')+'。这不是机器人核心任务模型变更。'),para('项目自有代码发布许可证：'+PH('团队审核选择的许可证')+'。第三方代码、权重、字体和工具保持各自许可，来源清单不赋予未有的再分发权。')])
]})
# All documents generated from the same explicit content, with editable Markdown alongside.
(O/'document-content.json').write_text(json.dumps(DOCS,ensure_ascii=False,indent=2)+'\n')
def shade(cell,color):
 tcpr=cell._tc.get_or_add_tcPr();x=OxmlElement('w:shd');x.set(qn('w:fill'),color);tcpr.append(x)
def style_doc(doc):
 section=doc.sections[0];section.page_width=Mm(210);section.page_height=Mm(297);section.top_margin=Mm(20);section.bottom_margin=Mm(20);section.left_margin=Mm(22);section.right_margin=Mm(22)
 for name,size in [('Normal',10.5),('Title',23),('Heading 1',15),('Heading 2',12)]:
  s=doc.styles[name];s.font.name='Noto Sans CJK SC';s.font.size=Pt(size);s.font.color.rgb=RGBColor(0,0,0);s.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Noto Sans CJK SC');s.paragraph_format.space_after=Pt(7 if name=='Normal'else 9)
 doc.styles['Normal'].paragraph_format.line_spacing=1.25
 footer=section.footer.paragraphs[0];footer.alignment=WD_ALIGN_PARAGRAPH.RIGHT;run=footer.add_run('具身救援   ');run.font.size=Pt(8);field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field)
 doc.core_properties.author=PH('队伍名称');doc.core_properties.last_modified_by=PH('审核成员姓名');doc.core_properties.subject='2026江苏省AI+科学与工程创新实践黑客松高校组提交材料'
for spec in DOCS:
 target=D/(spec['path']+'.docx');target.parent.mkdir(parents=True,exist_ok=True);doc=Document();style_doc(doc);doc.core_properties.title=spec['title'];doc.add_paragraph(spec['title'],'Title');doc.add_paragraph('2026年江苏省AI+科学与工程创新实践黑客松高校组',style='Subtitle');doc.styles['Subtitle'].font.color.rgb=RGBColor(0,0,0);doc.styles['Subtitle'].font.size=Pt(10)
 md=['# '+spec['title'],'']
 for index,p in enumerate(spec['pages']):
  if index:doc.add_page_break()
  doc.add_paragraph(p['title'],'Heading 1');md+=['## '+p['title'],'']
  for b in p['blocks']:
   if b['kind']=='paragraph':doc.add_paragraph(b['text']);md+=[b['text'],'']
   elif b['kind']=='picture':
    doc.add_picture(b['file'],width=Mm(b['width']));caption=doc.add_paragraph(b['caption']);caption.paragraph_format.space_after=Pt(7);caption.runs[0].font.size=Pt(8.5);md+=['!['+b['caption']+'](图示/'+Path(b['file']).name+')','']
   elif b['kind']=='table':
    t=doc.add_table(rows=1,cols=len(b['head']));t.autofit=False;t.style='Table Grid'
    for j,h in enumerate(b['head']):t.rows[0].cells[j].text=h;shade(t.rows[0].cells[j],'EDF0F2')
    repeat=OxmlElement('w:tblHeader');t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in b['rows']:
     cells=t.add_row().cells
     for j,s in enumerate(row):cells[j].text=s
    for row in t.rows:
     prop=row._tr.get_or_add_trPr();prop.append(OxmlElement('w:cantSplit'))
     for cell in row.cells:
      for p1 in cell.paragraphs:
       p1.paragraph_format.space_after=Pt(4);p1.paragraph_format.space_before=Pt(3);p1.paragraph_format.line_spacing=1.1
       for run in p1.runs:run.font.size=Pt(9);run.font.name='Noto Sans CJK SC';run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Noto Sans CJK SC')
    widths=[43,123]if len(b['head'])==2 else[32,61,73]
    for row in t.rows:
     for j,cell in enumerate(row.cells):cell.width=Mm(widths[j])
    md+=['| '+' | '.join(b['head'])+' |','| '+' | '.join('---'for _ in b['head'])+' |']+['| '+' | '.join(row)+' |'for row in b['rows']]+['']
 doc.save(target);(D/(spec['path']+'.md')).write_text('\n'.join(md)+'\n');print('DOCX_CREATED',target.relative_to(D),flush=True)
# machine readable field inventory; duplicates share a named placeholder so global editing stays consistent.
alltext='\n'.join((D/(s['path']+'.md')).read_text()for s in DOCS);placeholders=sorted(set(re.findall(r'【[^】]+】',alltext)));(D/'00_审核入口/待填字段.json').write_text(json.dumps({'fields':{p:''for p in placeholders},'note':'Replace matching named placeholders consistently in editable documents; never borrow example team identifiers or fabricate signatures.'},ensure_ascii=False,indent=2)+'\n')
print('DOCUMENTS_AND_PLACEHOLDERS',len(DOCS),len(placeholders),flush=True)
