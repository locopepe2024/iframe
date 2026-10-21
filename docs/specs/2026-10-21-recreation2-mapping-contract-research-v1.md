# 源坐标到重定向的设计契约审计

2026-10-21。规格先行；只诊断，不改主builder/模型/rig/服务。

授权范围：公开MediaPipe、CVF/arXiv、公开GitHub仓库的搜索/读取，无登录/账号/私有数据。不得持久化抓取页面或截图；仅记录链接、检索日期和任务相关事实/简短引用。

审计输入图像归一化XY、髋相对估计Z、world坐标、相机内参/外参、骨骼rest/current/parent旋转及语义关节中心。权威来源优先MediaPipe官方契约、OpenCV相机模型、GVHMR/SMPLify-X原生实现；发现不能查证则标未验证。

合成证伪：已知针孔相机和无噪声3D线段，前向投影生成XY；人为给予精确相对Z且与X的局部尺度相容（比真实提取器更强的信息），比较直接XYZ差值、已补Y尺度差值、正确逐点反投影得到的方向。变化条件：横向位置、中心深度、朝向。验证正确反投影误差<1e−9、已知双点world方向；不声称合成Z即真实MediaPipe编码，不用结果估算原视频误差占比。独立验证方向到旋转缺少twist约束、局部旋转parent×rest×basis规则，并以真实rig实验报告为已有运行证据。

结果必须区分已确认设计契约问题、运行效果和最大根因未证明；结论应给出下一条最短修复边界，不继续堆补偿权重。

工具`docs/agents/tools/recreation2_mapping_contract_synthetic.py`；输出`docs/agents/raw/2026-10-21-mapping-contract/`；deliverable和rolling summary记录研究结论。

## 结果

已完成MediaPipe官方输出定义、SMPLify-X投影拟合、GVHMR相机/根位移/静态关节IK与Blender空间转换API核对。OpenCV页面403，未作为已验证来源。GVHMR读取SHA为`ee960bb6e2ea2d381aa97f08e9b71ef320b624b1`。

36组无噪声合成反投影XYZ误差<1e-12；补Y尺度后的proxy仍出现角度失真且不保持方向夹角，证明不能一般性地只靠统一转轴修复。合成编码不代表MediaPipe真实Z，也不量化本片因果贡献。

结论：混合图像XY/髋相对Z与欧氏方向、绝对root用途的契约缺口已确认；最大误差来源仍待分层量化。下一边界为隔离的观测/3D/相机/root/rig标定通道与零噪声闭环，不继续堆IK补偿。主链路未改。

[完整研究与验证边界](../agents/deliverables/2026-10-21-recreation2-mapping-contract-research-v1.md)。
