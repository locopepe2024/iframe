# recreation2：坐标映射契约与公开实现核对

2026-10-21。只读主链路；新增隔离合成实验。没有修改 builder、rig、renderer 或服务，没有重新宣称接触/H3通过。

## Observed

### 官方契约与代码事实

以下链接于本日读取；当前官方文档/仓库不等于本次历史提取环境的完整版本复现。只记录相关事实，不保存抓取页面。

| 边界 | 可核实的来源事实 | 当前实现事实 |
| --- | --- | --- |
| 图像观测与三维位置 | [MediaPipe官方输出定义](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python)：landmarks的X/Y分别按图宽/高归一化，Z以髋中点为原点、数值尺度约同X；world landmarks另为米制、仍以髋中点为原点 | 已有提取器审计确认保存的是`pose_landmarks`。builder第11–20行把其XYZ差直接归一化为三维方向，没有源相机反投影 |
| 相机与人体 | [SMPLify-X fitting.py](https://github.com/vchoutas/smplify-x/blob/master/smplifyx/fitting.py)先将人体关节经camera投影，再用置信度加权的鲁棒二维残差及姿态/形状先验拟合；[camera.py](https://github.com/vchoutas/smplify-x/blob/master/smplifyx/camera.py)显式做旋转/平移、XY除Z、焦距与主点 | renderer固定目标镜头位置(0,-5.2,2.6)、55mm、640×360；builder的BASIS只做轴旋转。源相机与目标展示相机没有建立完整投影契约 |
| 根位移 | [GVHMR pipeline](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/hmr4d/model/gvhmr/pipeline/gvhmr_pipeline.py)显式使用`K_fullimg`、bbox、预测camera求相机空间transl，另解global参数 | builder第73行将图像髋XY按经验比例放置root，并用髋相对Z均值估前后位移；相对Z不能单独识别绝对根深度 |
| 静止、父空间与局部姿态 | [Blender Bone API](https://docs.blender.org/api/current/bpy.types.Bone.html#bpy.types.Bone.convert_local_to_pose)区分本骨rest矩阵、父骨rest/pose矩阵，并处理inherit scale等选项 | builder第64行名为rest的变量是已继承父旋转的当前world骨方向；第67–69行按骨名切换父骨/本骨旋转基底。已有隔离证明该差异影响目标和投影 |
| 接触 | [GVHMR postprocess](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/hmr4d/model/gvhmr/utils/postprocess.py)用预测static confidence处理指定踝/脚/腕的位移，再提供CCD IK；static-camera处理有独立分支 | 当前局部鞋底IK已能稳定指定patch，但不保证源踝投影改善；源真实地面尚未验收 |

GVHMR本次读取main SHA：`ee960bb6e2ea2d381aa97f08e9b71ef320b624b1`。其源码也明确注释可视化用`-min(y)`落地不考虑脚部高度，因此不能把这种落地处理当成目标鞋底接触标定。这里核实的是算法结构，没有运行GVHMR同片比较。SMPLify-X的肘膝角先验也不能被解释为已解决胸廓朝向。

### 无噪声合成反例：映射问题可以独立于识别噪声存在

工具：[recreation2_mapping_contract_synthetic.py](../tools/recreation2_mapping_contract_synthetic.py)；数据：[synthetic-report.json](../raw/2026-10-21-mapping-contract/synthetic-report.json)。

已知针孔内参、已知无噪声3D线段，前向投影生成图像XY，另人为提供精确相对深度`zproxy=(Z-Zref)*f/(W*Zref)`。这是假设的有利编码，**不是MediaPipe内部Z公式**。36种深度/横向位置/朝向组合中，按已知契约逐点反投影，XYZ重建误差均<1e-12。

仅将图像Y乘H/W后直接对XYZ相减，在中心深度5、朝向80°时，横向位置−1/0/+1的方向误差仍为10.528/5.048/12.056°。一对真实方向夹角86.628°，proxy夹角97.902°；刚体旋转保持夹角，因此单一轴旋转不能一般性修复这种失真。

相同髋相对Z=[−0.1,+0.1]可对应根深度3/5/8，旧均值Z启发式都输出0；这是不可辨识反例，不是测得本片人物移动了这些距离。简单纯旋转层级另核对parent×rest×basis：parent20°、rest35°、目标80°时basis应为25°；漏rest得到115°。此例只验证简化模型，真实rig仍须遵循Blender继承/约束规则，不能据此逐行判定所有四元数表达式错误。

### 已有真实片段运行证据

- 同源、rig、root与镜头，相机轴映射使全关节误差中位数14.73→10.62px，但踝中位数14.97→18.55px。这是映射有效的直接证据，也说明全身改善不等于接触通过。
- 固定proxy长度加PTS深度分支连续性后，中位数10.62→8.58px；不能因此将proxy认定为公制真值。
- 完整骨盆校准使源17上身误差4.77→23.25px，而腿部8.96→8.60px；冻结脊柱目标、补完整胸廓朝向只能部分挽回。方向、完整旋转和关节头位置是不同验收量。
- 躯干肩端点不同射线深度解可同时得到约6px全身中位误差，却有最大74.38°与1.08°两种链折角；二维误差小不证明体态/深度正确。

详见rolling summary中对应相机轴、支持IK/骨盆、肩链、胸廓和躯干端点报告；本次没有新增真实片段消融数据。

## Direct implication

用户提出的“坐标映射设计或变量含义问题”已有代码事实支持：同一`[x,y,z]`被赋予图像位置、欧氏骨方向、根深度及yaw等不同意义，缺少统一尺度/相机契约。这里需要修正的是明确的数据边界，不能把任务简化成再增加一个深度量、统一改叉积或增加胸廓权重。

成熟方案的可借鉴点是显式建模：二维观测用于重投影验收；三维姿态带单位/参考系；根轨迹与相机单独表达；重定向再处理rig静止轴、父空间、关节偏置与twist；接触使用独立证据与末端几何。SMPLify-X与GVHMR各自证明这些边界可实现，不表示任一仓库可直接替换并保证本片成功。

## Not yet proven

- 尚未量化上述契约问题占真实片段总误差的比例，也不能宣布它是最大根因。
- 官方MediaPipe定义不足以唯一反解其估计Z；不能将合成公式直接用于实际landmarks反投影。
- 没有标定本片源相机内参、绝对人物尺度或真实根深度；后段还存在背景构图变化。
- world landmarks虽为米制髋相对输出，仍是模型估计；直接替换字段不保证朝向、遮挡肢体或接触正确。
- 相同二维关键点可容许不同深度、体态及twist，重投影误差只能是验收项之一。

## Hypotheses

最值得优先验证的设计假设：混合坐标被直接欧氏化，再叠加未经源相机标定的目标镜头/骨长，造成姿态相关的系统投影失配；父空间和不完整旋转会进一步改变肩髋等端点。它们可能与单目识别误差共同存在。当前证据不支持将全部问题归为正背面识别困难，也不支持将全部误差归为坐标系。

## What would verify it

下一切片先做隔离adapter/诊断结构，主链路保持不变：

1. 明确区分`image_observations`（像素/归一化及画幅、PTS）、`body_pose_3d`（单位、髋相对/相机坐标、来源）、`camera`（内外参及可信度）、`root_trajectory`（世界位移与尺度）、`rig_calibration`（rest/身体轴、关节偏置）。缺失字段标unknown，禁止把相对Z默认为根深度。
2. 将已知3D→相机投影→adapter→rig→再投影做零噪声闭环；覆盖左右位置、朝向、非零父旋转、rest轴、root yaw、完整胸廓旋转及固定骨长。分别验方向、完整旋转、端点，避免只查单轴方向。
3. 对真实源1/17/23/29及后段55帧，保持源PTS和相同验收点，独立比较现有proxy、可复现提取环境下的world输出、显式相机/人体拟合。源相机参数未经标定时应列候选及敏感性，不能伪装真值。先在源人体几何层回投，再接目标rig，定位第一处失配。
4. 接触单列支持阶段、鞋底patch、未知地面和镜头变化；三维几何/人体层通过后再做有限IK。报告全段分位数、预选事件、连续性、体态和接触，不能以中位数代替全部验收。

本次验证命令：`python3 docs/agents/tools/recreation2_mapping_contract_synthetic.py --out docs/agents/raw/2026-10-21-mapping-contract`；`python3 -m py_compile docs/agents/tools/recreation2_mapping_contract_synthetic.py`；`git diff --check`。原始网页未落盘；没有使用未成功读取的OpenCV页面作为已验证来源。
