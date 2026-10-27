# 复刻动作恢复 Spec Summary v1

日期：2026-10-14。范围：单人视频到人体动作、目标骨架和复刻参考资产的候选链路。本文记录验证边界，不将研究试验视为已上线能力。

## Observed

- GVHMR 官方代码中的 `-s` / `--static_cam` 跳过视觉里程计。动态相机模式（不加 `-s`）默认使用 SimpleVO；只有显式设置 `--use_dpvo` 才调用 DPVO。官方 README 的旧句子称动态相机由 DPVO 估计，但同一 README 的更新说明及 `tools/demo/demo.py` 的分支表明当前默认已改为 SimpleVO。依赖名称是 **DPVO**，不是 PDVO。代码来源：GVHMR 上游版本 `ee960bb6e2ea2d381aa97f08e9b71ef320b624b1`，`tools/demo/demo.py`、`hmr4d/utils/preproc/slam.py`。
- [本地 GVHMR CPU 研究记录](../../../gvhmr-cpu-validation/CPU-VALIDATION.md)中的 90 帧预处理和 SMPL-X 参数解码能够执行。该测试源片相机可见移动，SimpleVO 在默认参数下未得到有效相机轨迹；改用“假定静态相机”的结果标记 `world_trajectory_validated=false`。这些运行事实不构成动作精度证明。
- [iFrame 骨架方向验证](2026-09-30-director3d-motion-pipeline-bundle-v1.md)发现另一层独立误差：早期 Blender 白模映射在测量肢体上达到 52–167 度方向误差。即使上游 SMPL-X 姿态有效，下游骨架转换仍需单独验收。
- [HighTorque-Robotics 的整合仓库](https://github.com/HighTorque-Robotics/Mini_Pi_Plus_GVHMR-and-GMR) README 描述 GVHMR 视频姿态提取接 GMR 机器人动作重定向/BVH，并以派+动作训练为用途。该 README 没有给出 Mixamo 角色、GLB、Blender 插件或源帧动作精度的验收证据。

### 2026-10-15 SimpleVO 失败边界复测

- 在同一研究素材 SHA-256 `49c73ccaaa2bf36d89c234006417320f7ffd5f9c5d58e6eafd227e38d4fa8602` 的 71→72 帧对，重复运行独立诊断。默认设置的[记录](../agents/raw/2026-10-15-gvhmr-vo-pair71-default.json)找到 340 个全画面匹配、324 个 OpenCV essential-matrix 内点，却由 pycolmap 返回配置值 `7 = WATERMARK`，没有相对位姿。限定背景时也返回 `WATERMARK`、没有位姿。
- 仅关闭该诊断中的 `detect_watermark` 后，[同帧记录](../agents/raw/2026-10-15-gvhmr-vo-pair71-no-watermark.json)在两种匹配范围均返回配置值 `4 = PLANAR` 和相对位姿。配置值名称用该研究环境的 `pycolmap.TwoViewGeometryConfiguration` 枚举核对。此前保存的 11 对抽样诊断也显示关闭检查后均可返回位姿；本次只重复了 71→72 帧对。
- 随后对同一 90 帧素材的全部 89 个相邻帧对进行了诊断，保留[默认设置原始结果](../agents/raw/2026-10-15-gvhmr-vo-allpairs-default.json)和[关闭检查的原始结果](../agents/raw/2026-10-15-gvhmr-vo-allpairs-no-watermark.json)。全画面匹配下，有效相对位姿从 `88/89` 变为 `89/89`，默认唯一失败仍是 71→72；默认配置分布为 `CALIBRATED 77、PLANAR 11、WATERMARK 1`。限定背景匹配下，有效位姿从 `52/89` 变为 `81/89`；剩余 8 个失败包含匹配点不足和退化分类。逐帧对诊断没有把位姿积分为相机轨迹，也没有评估累计漂移或回投精度。
- **直接推论：** 在 71→72 失败帧对，缺少匹配点不是充分解释；`detect_watermark` 设置影响求解器是否交付位姿。**尚未证明：** 关闭检查可产生可信的全段相机轨迹。`PLANAR` 提醒场景几何可能使平移难判，背景限定匹配仍有失败，且 RANSAC 有运行波动；也不能由 SimpleVO 帧对结果推断 DPVO 的效果。

### 2026-10-15 完整轨迹探针

- 用[隔离诊断脚本](../agents/tools/gvhmr_simplevo_trajectory_probe.py)复用 SimpleVO 的缩放/采样、SIFT、pycolmap 与 `T_delta @ T_w2c` 积分；该脚本只记录诊断，不改上游推理或产品代码。[默认参数结果](../agents/raw/2026-10-15-gvhmr-trajectory-0p5-step8-default.json)和[关闭 watermark 结果](../agents/raw/2026-10-15-gvhmr-trajectory-0p5-step8-no-watermark.json)都在采样帧 24→32 停止：仅 4 个匹配、`DEGENERATE`，无相对位姿。在此前 0→8、16→24 两步中报告约 91° 的旋转。由此可见 watermark 设置不是默认稀疏采样失败的充分修复。
- [原尺寸逐帧默认结果](../agents/raw/2026-10-15-gvhmr-trajectory-1p0-step1-default.json)在 71→72 停止，配置为 `WATERMARK`；[关闭检查结果](../agents/raw/2026-10-15-gvhmr-trajectory-1p0-step1-no-watermark.json)积累了全部 89 步，末帧相对首帧旋转约 20.46°。但是 17→18 和 18→19 单帧旋转分别达到 12.54°、30.44°，远高于本次估计的 1.23° 中位数。原始[16–20 帧联系表](../agents/raw/2026-10-15-gvhmr-frames16-20.png)可见人和器械剧烈运动；仅凭该抽样不能证明镜头真的发生 30° 转动。17→18 的全画面匹配仅 18 个，背景限定只有 8 个且退化，提示该处估计不稳。
- **直接推论：** 更密的帧采样加关闭 watermark 检查能让这段测试完成位姿积分，但产生了需复核的局部旋转突变。**尚未证明：** 该轨迹的相机旋转、世界位移或人体动作准确。脚本的 `completed` 仅表示每对采样帧返回了位姿；单目相对平移没有可用的公制尺度，也未通过背景回投或独立相机真值验收。

## Direct implication

### 2026-10-19 CozyClay / media 白模与源 PTS 验证

- media Blender 4.5.9 已将合成 24 帧 bundle 和真实轨迹 31 key bundle 分别渲染为白模 MP4。真实轨迹输出为 48 帧、24 fps、2 秒，证明渲染链路可执行，不证明源动作精度。[运行证据](../agents/deliverables/2026-10-19-real-motion-track-media-white-model-v1.md)
- CozyClay 浏览器编译/导出 48 帧已通过；固定脚位的诊断 spec 可达 `qa.ok=true`，但从真实轨迹直接映射脚踝/根位置的 spec 有 168 个 QA 问题。空间代理校准将数量降至 10，但修改了源脚步，不能作为保真结果。[QA 隔离对照](../agents/deliverables/2026-10-19-cozyclay-real-track-qa-isolation-v1.md)
- 对 `recreation2-final120.json` 对应原片复核后发现：轨迹时间戳使用平均 FPS，源第 11→12 帧实际 PTS 跨 0.271265 秒；源第 61 帧 PTS 为 2.170123 秒，而轨迹记录 1.955224 秒。旧 48 帧白模把约 2.17 秒源内容压成 2.0 秒，不能用于节奏验收。[源帧证据与脚部阶段](../agents/deliverables/2026-10-19-recreation2-source-pts-foot-evidence-v1.md)
- 之后任何动作 bundle 的时间主键须为源视频逐帧 PTS，并同时保留源帧号；平均 FPS 只能作视频总体统计，不能代替可变时间间隔。接触约束须按源帧阶段切换，不能全段固定双脚。
- 已用源 PTS 对齐的前 2 秒重新输出 48 帧 media 白模；长停顿在时间线上得到保留，但白模仍明显漂浮、朝向与源片不符。时间轴修复通过工程验证，空间动作重定向仍失败；当前不得送入 H3 作为合格白模参考。[PTS 对照和新产物](../agents/deliverables/2026-10-19-recreation2-source-pts-foot-evidence-v1.md)
- 对同一 `recreation2` 源片跟踪三处舞台背景灯位：已测的源第 1、11、17、23 帧相对首帧无整数像素位移，第 55 帧（PTS 1.959139 秒）在原画幅出现约 +64、+42、+2 像素的横向位移及 +14–18 像素的纵向位移。三点横向位置符合二维缩小/重构图代理，但不能由此断定真实三维相机移动或恢复公制深度；固定相机全段假设不宜直接沿用。首帧白模已明显出现朝向和肢体姿态失配，因此后段背景运动并非全部失败的充分解释。[背景位移与首帧隔离报告](../agents/deliverables/2026-10-19-recreation2-background-motion-and-first-frame-v1.md)
- 对相同源轨迹和 pinned rig 做骨盆朝向开关消融：原 PTS bundle 可由 `--enable-pelvis-orientation` 逐值重现；关闭该开关并**重算所有子骨骼**后，12 个语义关节的首帧平均投影误差由 37.62 降至 12.76 px，首次抬脚第 17/23 帧由 48.99/44.56 降至 17.57/14.04 px。第 55 帧仍有 41.72 px，落脚、地面和后段转身未通过；这是诊断基线，不是 H3 合格白模。不能仅删除旧 bundle 的骨盆四元数，因子骨骼以旧父空间求解。[骨盆朝向隔离报告与 2 秒诊断视频](../agents/deliverables/2026-10-19-recreation2-pelvis-orientation-isolation-v1.md)
- 同一隔离进一步发现现有 `pelvis_target` 的 `(right, forward, up)` 三列行列式为 −1，目标矩阵是反射，不能由四元数准确表达。仅改叉积使行列式 +1 后，首帧平均关节误差反而为 47.89 px，说明还需核对 rig 静止轴、前向和父空间变换；不能将单一叉积修改当成已验证的修复。[逐轴诊断](../agents/deliverables/2026-10-19-recreation2-pelvis-orientation-isolation-v1.md)
- 后续七组 rig 空间隔离已确认骨盆骨轴与静止身体轴不重合，并发现求解时未包含渲染 root yaw。仅纳入 root 后，源17/23/29帧平均误差为 15.74/12.25/18.46 px；完整身体/骨盆与子骨基底/root 校准在源55帧为 19.35 px，但前四帧没有优于无骨盆基线。全七组 bundle 重导入投影差为 0；旋转方向对齐不等于关节位置或鞋底接触合格。主 builder 未改，仍不得送 H3。[身体轴、骨盆与 root 空间实验](../agents/deliverables/2026-10-19-recreation2-rig-space-calibration-v1.md)
- 躯干分离与接触约束隔离显示：水平骨盆目标改善后段但使前四帧变差；支持脚世界高度或单点像素 y 锁定会改善指定脚，却把另一只脚和全身投影推偏。脚接触需要鞋底点、地面证据和局部 IK/根高度联合求解，不能只平移 root。[躯干与脚接触隔离](../agents/deliverables/2026-10-19-recreation2-torso-contact-isolation-v1.md)
- pinned rig 只读标定发现网格鞋底代理点与 `foot_l/r` 骨头头部相差约 5.5 cm；直接把骨头 head 当接触点会产生系统偏差。成熟 two-bone IK 可用，但末端骨、pole vector、支持段和鞋底目标仍需标定；粗略 IK 目标保持诊断未命中，不应当作算法失败或生产修复。[鞋底与 IK 接入边界](../agents/deliverables/2026-10-19-recreation2-foot-sole-and-ik-boundary-v1.md)
- 后续更正：上项 5.5 cm 是未经公制标定的0.055 Blender units静止世界Z偏移；旧IK链没有覆盖大腿且跨帧累积约束。改用固定网格patch和直接hip/knee/ankle两节腿后，六帧零位移、端点/骨长、上身/另一腿保持与renderer重导入测试通过。源29/41误差18.46/15.14→17.99/14.21 px，源23则12.25→13.42 px；求解几何通过，真实源接触和连续支持段仍未验收。[两节腿验证](../agents/deliverables/2026-10-19-recreation2-two-bone-ik-validation-v1.md)
- 连续段比较扩至28个源采样、29个PTS key及48输出帧，统一权重0/0.5/1预先固定。0.5将测试平面高度残差P95约减半，踝点中位数17.21→16.38 px，但踝点P95 36.37→36.83 px、全身中位数16.03→16.11 px。支持允许残余误差并用多指标容差验收，不支持直接“取中值即达标”；实际源地面与连续性仍待验证。[连续段容差基线](../agents/deliverables/2026-10-19-recreation2-sequence-tolerance-v1.md)
- 独立16帧鞋底复核保留整鞋/鞋缘/分离/不确定区别，源29不能直接锁双脚，源49–55也不能只凭屈膝断定整脚离地。输出28最大步长来自右腕52.36 px；对应源轨迹右腕二维仅9.74 px而proxy深度改变0.24930，尚未证明深度错误。输出33支持候选patch总水平速度3.179 units/s，root-only项0.466、局部项3.188（向量分解）；源支持踝二维仅动1.15 px。这些需单独诊断，不能靠中值权重或放宽误差阈值吸收。[接触取证与异常位移](../agents/deliverables/2026-10-19-recreation2-contact-evidence-spike-v1.md)

- XYZ契约审计确认现存提取器保存MediaPipe `pose_landmarks`，不是`pose_world_landmarks`；原始→标准化3786分量、标准化→切片1488分量逐值相等，无新增深度。官方定义X/Y按宽/高归一化，Z为髋相对且近似X尺度；builder却直接将差值求欧氏方向，并用髋均值Z估root深度。原片Y换成图宽基准因子为0.568149，但尚未验证补偿后的投影效果。未发现“重复加深度”证据；主链路未改。[XYZ输入契约与验证边界](../agents/deliverables/2026-10-19-recreation2-xyz-contract-v1.md)

- XYZ边界首个单变量试验固定root/yaw、骨盆关闭、镜头与混合旋转基底，仅对方向输入Y乘792/1394。raw29个key逐值复现既有基线，两组renderer重导入差0px。源1/17/23均值12.76/15.74/12.25→14.54/16.96/16.55px恶化，源29/41为18.46/15.14→12.57/14.50px；源23左膝改善而双踝恶化。全段误差中位数16.03→16.32px、最大52.51→66.39px；输出33左patch水平速度3.18→4.03units/s。尺度补偿未通过前段或接触验收，尚未量出与旋转基底/投影的交互；主链路未改。[XYZ尺度隔离与逐关节拆分](../agents/deliverables/2026-10-19-recreation2-xyz-scale-ablation-v1.md)

复刻链路须把 `视频取证 → 相机轨迹 → GVHMR 原生人体重建 → 目标骨架重定向 → Blender/GLB 输出 → 源帧验收` 分层记录。GLB 能导入 Blender/Unity 只证明资产可用，不证明源动作、世界轨迹、脚接触或双手持枪关系准确。照片输入只提供单帧姿态线索，不能作为连续动作恢复的时间证据。
- XYZ尺度×rig基底四组隔离固定root/yaw、镜头、骨盆和IK；raw_mixed逐值复现旧基线。raw_own将全段中位数16.03→16.08、最大52.51→46.34，源55帧31.50→24.27，但源17/23/29/41变差；scaled_own全段中位数降至14.73、踝中位数14.97，却使源1/17/23为15.92/20.18/17.01，不能作为前段参考。尺度和旋转基底存在交互，不能选全局中位数最小组替代事件帧验收。[交互报告](../agents/deliverables/2026-10-20-recreation2-xyz-basis-interaction-v1.md)

动态相机样本不得用 `-s` 的输出宣称世界空间轨迹合格。SimpleVO 失败时，应先检查相机估计条件，再在具备 DPVO/CUDA 环境时做同片对照；安装 DPVO 本身不等于轨迹正确。现有 CPU 验证未运行 DPVO。

## Not yet proven / Hypotheses

- 2026-10-22 world landmarks方向候选隔离：将同源world姿态经首段弱透视basis映射到目标镜头，冻结旧root/yaw、骨盆关闭、own-basis后重算子骨。代数映射误差3.33e-16，pinned rig方向残差0°、renderer回导0px，但源1/17/23/29/41/55平均误差25.11/24.86/23.26/27.81/22.55/25.71px，对照12.53/17.26/13.31/21.98/16.90/24.27px；双踝候选44.46–56.54px，对照3.72–27.23px。证明简单替换world字段并不能修复；未证明world输出无效，仍缺透视相机/尺度/完整姿态/接触验证。主链路/H3不变。[world候选报告](../agents/deliverables/2026-10-22-recreation2-world-landmark-retarget-ablation-v1.md)

- 2026-10-22源人体层world→image透视拟合：同源sidecar的79个可检测配对帧中，训练窗帧1–53的固定针孔相机加逐帧root平移RMSE为10.23px，逐帧弱透视对照10.87px；帧63以后相同全局焦距/方向的逐帧平移拟合为10.63/11.29px。全局焦距候选1449px未触搜索边界，但距最优RMSE≤1%的区间仍宽达1058–2205px，对应中值髋深3.36–6.90模型单位；深度随焦距缩放，绝对相机深度未辨识。事件帧29/41针孔略差、全段最大单点48.67px反高于弱透视47.33px；源55附近背景也有移动证据。该同模型重投影仅支持相机项有小幅拟合收益，不构成独立真值、相机标定、root轨迹或rig/脚接触通过；主链路/H3不变。[透视拟合诊断](../agents/deliverables/2026-10-22-recreation2-world-perspective-camera-fit-v1.md)

- 2026-10-22 HumanFoV/骨长续验：作者CameraHMR公开脚本要求注册凭据下载HumanFoV权重，本轮只读代码契约未运行模型，不能声称与GeoCalib一致。79帧world骨长消去整体尺度后仍非恒定：源197左前臂仅训练参考0.306倍，肘/腕visibility仍0.981/0.946；这是模型几何事实，不证明源人物真实形变。固定1601px候选K，仅每帧统一尺度的回投变化≤5.65e-7px；固定各骨段长度保留方向后，训练留出15.170→14.761px，后段19.465→21.101px，源17/29仍恶化。表明局部方向/比例/投影须联合验证，不能只固定尺度/骨长；主链路/接触/H3不变。[骨长与权重边界报告](../agents/deliverables/2026-10-22-recreation2-humanfov-bone-length-v1.md)

- 2026-10-22有效内参/尺度隔离已运行：完整源帧1/17/23/29/41/55的GeoCalib焦距候选1066/1164/1650/1847/1969/1523px，前五帧共享K约1601px、主点中心。固定该K，肩髋肘膝八点拟合、腕/脚八点留出诊断的训练/后段RMSE仅15.194→15.170、19.535→19.465px；17/23仍变差。沿用旋转此前用全16点拟合，非严格交叉验证。189组条件K网格的最优焦距触4000px边界；参考链长统一单位后同比缩放最大投影差2.27e-13px。外部候选没有稳定分离焦距/绝对深度，不能将逐帧候选焦距当真实变焦；HumanFoV尚未对照，骨长/生成形变/主点/接触仍待验，主链路/H3不变。[运行证据](../agents/deliverables/2026-10-22-recreation2-effective-intrinsics-scale-v1.md)

- 2026-10-22焦距/绝对深度公开方案核对：已读取CameraHMR论文摘要（HumanFoV+完整透视人体拟合）、GeoCalib官方仓库（场景内参/重力、多图共享内参；主点默认中心）、SPEC论文与OpenCV标定文档。成熟路线需区分相机内参约束与公制尺度锚点，未知地面的脚接触不能单独保证真实距离。建议完整帧背景估相机与人体FoV交叉核对，再固定候选K做源人体层隔离对照；尚未运行模型，主链路/H3不变。[研究与验证边界](../agents/deliverables/2026-10-22-recreation2-focal-depth-solutions-research-v1.md)

- 2026-10-21/22同源MediaPipe world伴随与PTS时序对照：120个采样帧pose选择/状态一致；79个可检测帧image/world逐值相同，41帧均无检测。平均FPS推算时间与源PTS绝对差中位/P90/最大为0.054/0.223/0.267秒；改用真实PTS的VIDEO重提取未改变image或world输出。16关节弱透视比较中，track帧1–53拟合并固定朝向后，全79帧RMSE中位/P90/最大10.56/14.58/21.58px；逐帧局部搜索9.80/13.18/16.25px，逐帧解不高于共享解。帧1–53中位/P90 10.79/12.84，帧63以后9.91/15.60，后段中位未变差。朝向搜索不是全局最优；world仍为髋相对模型估计，几何残差不是相机真值/retarget改善，主链路/接触/H3不变。[world伴随报告](../agents/deliverables/2026-10-21-recreation2-world-companion-v1.md)

- 2026-10-21 pinned Blender rig 已知姿态闭环：源1/17/23/29/55只作采样锚点，额外root yaw/骨盆/胸廓旋转为合成测试扰动。73骨中无pose-bone constraints；Blender rest/parent逆解与renderer重导入的最大世界矩阵误差分别3.58e−7/4.77e−7、投影误差1.11e−4/9.16e−5 px。漏rest/root和只看骨方向的负对照显著失败（60°twist使侧向点偏0.08062 Blender units）。证明此rig上已知世界姿态可往返，不证明源3D、源相机、鞋底接触/H3正确；主链路未改。[rig闭环报告](../agents/deliverables/2026-10-21-recreation2-pinned-rig-roundtrip-v1.md)

- 2026-10-21隔离坐标adapter将图像观测、proxy相对Z、metric camera-Z和rig刚性变换分离；36组×3骨已知姿态闭环最大端点2.74e-15米、像素3.60e-13px，漏rest/root与六种非法输入对照通过。相同骨方向、60°twist差可产生合成侧点0.15米偏移，证明方向验收不足。真实31帧只保留像素观测/相对Z和PTS，XY回转误差0，未知camera/3D/root/rig保持null；尚未验证实际Blender rig或测得真实片段改善。主链路/接触/H3状态不变。[adapter与闭环报告](../agents/deliverables/2026-10-21-recreation2-contract-adapter-v1.md)

- 2026-10-21公开来源与映射契约审计：MediaPipe的图像归一化XY/髋相对Z不同于公制相机XYZ；SMPLify-X显式做人体→相机投影拟合，GVHMR分别处理K/根位移/static关节/IK，Blender区分rest/parent/pose。现有builder同一XYZ直接兼作方向、yaw与root深度，存在已确认的语义边界缺口。36组无噪声针孔反例中，正确反投影XYZ误差<1e-12，补Y后的直接XYZ差仍不保持方向夹角，不能一般性用统一转轴修复；该合成Z不是MediaPipe内部公式，也不证明本片最大根因。下一步拆观测/3D/相机/root/rig标定通道并作闭环，再量真实源分层误差；主链路、接触/H3状态不变。[公开实现与合成报告](../agents/deliverables/2026-10-21-recreation2-mapping-contract-research-v1.md)

- 2026-10-21躯干固定骨长端点四组隔离：同chest_source_full完整胸廓朝向/骨盆/root/镜头，仅解下/中脊柱链位置。绝对源肩射线25/28可达（37/39/41不交球壳），保留rig髋共同残差的相对目标28/28可达；全关节中位数9.37→6.11px（最近肩深度）或6.35px（近伸展）。最近深度最大链折角74.38°，近伸展最大1.08°但沿射线深度改变量中位0.08258units，说明像素低误差不能辨真实深度/体态。四组重导入0px、骨长/胸廓完整旋转/下身保持，接触/H3未通过；主链路未改。[躯干端点与深度选解](../agents/deliverables/2026-10-21-recreation2-torso-endpoint-v1.md)

- 2026-10-21完整胸廓旋转五组隔离：固定骨盆开启+冻结脊柱方向参考，仅取关闭组同帧胸骨完整旋转，源17肩回移6.65/3.11px，全身12.52→10.26px但仍差于关闭6.86px；源肩横轴+torso完整frame组55为11.34→10.45px，前五事件仍退化。五组重导入0px、胸骨head/下身保持、零效应<0.000075px。验证轴向旋转通过侧向偏置影响肩位置，但源肩frame同时保留rig胸骨轴/身体轴11.02°静止夹角，不是纯twist真值。下一边界为躯干端点可达性和起点位置，主链路未改。[胸廓完整朝向对照](../agents/deliverables/2026-10-21-recreation2-chest-orientation-v1.md)

- 2026-10-21肩父链四组隔离确认`spine_target`的rest参数实际为继承父旋转的当前方向；开启骨盆改变脊柱world目标。冻结为关闭组目标后，全关节中位数12.12→10.34px、源17为15.92→12.52px，仍差于关闭组8.58/6.86px；源55为12.13→11.34px。全部旧组逐值复现、冻结关闭控制完全相等、重导入0px。精确端点分解显示第17帧冻结后骨盆→下脊柱头仍向左10.09px，胸→左右锁骨头−6.69/−3.35px；方向相同但脊柱完整world旋转仍差约38°。指向关节头偏置和轴向自由度边界，未证明源真实朝向/最大根因，主链路未改。[肩端点传递](../agents/deliverables/2026-10-21-recreation2-shoulder-chain-v1.md)

- 2026-10-20–21独立查看源1–61全部鞋部，支持候选17–37画面右鞋=语义left、43–55画面左鞋=语义right。fixed_temporal上局部鞋底IK（0.04units上限）使前段patch更稳但踝中位11.43→11.94px，后段踝16.53→9.66px却残留漂移、8输出样本触顶。另行相机轴/静止身体轴/自身父空间骨盆校准保留髋横轴、det=+1、重算子骨，目标/髋方向残差近零、所有组重导入0px；源17全身6.86→15.92、55为18.32→12.13px。源17上身4.77→23.25、下身8.96→8.60px，表明前段恶化落在上身端点，未归因到独立脊柱/锁骨通道。主链路未改，接触/H3未通过，下一步核对骨盆到肩端点传递。[支持IK与骨盆独立对照](../agents/deliverables/2026-10-20-recreation2-support-ik-pelvis-v1.md)

- 2026-10-20固定输入肢段长度+PTS跨帧深度分支诊断：原始组逐值复现scaled_camera，root/key相同、三组重导入0px。全关节中位数10.62→8.58px、踝18.55→12.27px、最大步长51.72→25.96px；源23大腿投影比0.410→0.763，六预选事件均改善。逐帧长度约束最大步长反升61.77px，需分开端点与连续性收益。部分横向幅度仍过大/不足，弱透视proxy长度不是人体公制骨长，不能归因为Z噪声最大；源55骨盆/真实接触/H3未通过，主链路未改。[固定长度与跨帧对照](../agents/deliverables/2026-10-20-recreation2-fixed-length-temporal-v1.md)

- 2026-10-20固定相机候选60段几何核对：针孔重建差<0.000069px。源23右大腿深度分量/段长−0.986266，方向目标准确执行而投影仅源的0.410；源29左右前臂rig等长，proxy深度倾角不同，投影比0.709/1.880。源55髋连线与proxy目标三维差47.06°、源屏幕方向差126.86°，骨盆关闭下未约束双髋目标。分别指向输入方向/透视与骨盆朝向边界，尚不能认定Z噪声或最大根因。[相机空间异常几何](../agents/deliverables/2026-10-20-recreation2-camera-depth-geometry-v1.md)

- 2026-10-20完整Z相机候选28帧投影尺度分组：肩宽/髋宽/躯干比中位1.138/1.450/1.141，前臂/大腿/小腿0.744/0.797/0.867。每帧允许独立共同二维尺度后，308段绝对长度误差中位数10.55→9.34px，不能充分解释局部分歧；源29左右前臂比0.709/1.880、源55髋宽反转0.563，不能直接认定固定rig比例错误。未对真实root深度做消融。[投影尺度审计](../agents/deliverables/2026-10-20-recreation2-projected-scale-v1.md)

- 2026-10-20固定相机轴/骨长/root，只消融方向Z为1/0.5/0：全关节中位数10.62/14.73/24.84px、踝18.55/30.44/56.21px。零Z虽方向中位差0.11°，大腿/小腿投影长度比1.513/1.444且端点最差；半量改善源23/55但其他预选帧恶化。完整组逐值复现候选、三组重导入0px；不支持“Z过大为最大根因”或压低Z修复，剩余尺度/比例/root深度仍需分离。[源Z贡献隔离](../agents/deliverables/2026-10-20-recreation2-depth-influence-v1.md)

- 2026-10-20完整相机轴重算：同自身基底、同Y尺度、同root/镜头，scaled_world→scaled_camera的全关节中位数14.73→10.62px、P95 39.91→26.34px，源17为20.18→8.20px；四组renderer重导入0px。但踝中位数14.97→18.55px，输出28右patch速度5.23→6.18units/s，源23的13.27仍未胜过旧混合基底12.25。确认映射影响整体投影，不代表接触/深度/H3通过。[相机轴完整姿态对照](../agents/deliverables/2026-10-20-recreation2-camera-retarget-v1.md)

- 2026-10-20相机/BASIS只读审计：renderer相机俯视约17.1°，现有(dx,dy,dz)→(dx,dz,−dy)使相机down=0.955779dy−0.294086dz，源Z混入相机竖向分量。相同head/骨长的几何对照中，源23右大腿现有42.53°屏幕方向差，相机轴解释18.37°，加输出像素尺度4.60°。这是方向目标投影对照，未输出新动作或证明关节/接触改善；源相机与proxy深度仍未校准。[相机坐标边界报告](../agents/deliverables/2026-10-20-recreation2-camera-basis-v1.md)

- 2026-10-20上身六帧诊断：自身基底锁骨/手臂目标残差均<0.031°，混合基底锁骨最大86.41°。源23原尺度左肩11.36→2.30px但腕19.24→34.57px；旧肩负y残差抵消了部分手臂正y残差。自身组前臂投影15.53px对源34.55px，目标方向执行正确仍不保源投影。肩移动尚未拆到脊柱/锁骨独立贡献，下一步核对相机坐标与BASIS。[上身方向与端点](../agents/deliverables/2026-10-20-recreation2-upper-endpoints-v1.md)

- 2026-10-20六帧腿端点诊断：自身基底腿方向残差最大<0.033°、骨尾到下一关节头间隙<1.34e-7units，但源23补偿Y后左小腿投影17.93px对源53.17px，踝误差6.41→25.37px。方向执行准确仍不保证投影端点。按上下身重分八组误差发现原尺度自身基底17/23/29腿部均值略降，全身恶化来自上身六点；不能将全身结论泛化为腿部。[腿方向与端点报告](../agents/deliverables/2026-10-20-recreation2-leg-endpoints-v1.md)

- 2026-10-20 root/yaw八组对照固定最终root、镜头、尺度/基底声明及骨盆关闭。四对比较均显示求解纳入yaw改善所列源17/23/29/41/55与全段P95；首帧yaw为零不变。但原尺度自身基底的17/23仍17.26/13.31px，高于混合15.74/12.25，漏算yaw不能充分解释前段恶化。八组renderer重导入0px；yaw估计本身、端点/骨长与相机仍未验证。[root/yaw边界报告](../agents/deliverables/2026-10-20-recreation2-root-yaw-factorial-v1.md)

- DPVO 能否在当前移动镜头素材上稳定恢复相机旋转和轨迹，以及它是否改善 GVHMR 源帧对齐，尚无实测。
- 我们观察的白模误差有多少来自相机估计、GVHMR 本体、坐标变换或目标骨架重定向，尚未用同片分层实验归因。
- 外部 Mixamo/GLB/Blender 插件方案是否包含自动骨架校准、接触约束或可用于 iFrame 的授权，尚未核实。HighTorque 的机器人 GMR 流程不等同于 Mixamo 角色流程。

## What would verify it

1. 固定同一段带源帧/PTS、镜头移动标记及可见动作事件的短片；记录输入、模型权重、相机方案和输出哈希。另选确认为固定相机的短片作基线。
2. 下一步检查逐帧轨迹的背景特征回投/重投影与 17–19 帧旋转突变，并用独立固定相机基线量假旋转；不能用 89/89 位姿可用当作准确轨迹。对有剪辑的视频须先分镜，不能跨切点积分。具备 CUDA 环境时再跑 DPVO 同片对照。失败轨迹不能继续作为世界动作真值。
3. 在尚未重定向的 SMPL-X 上比较源帧姿态事件、人体朝向、关节回投和根轨迹；遮挡部位标为不可评。仅当该层合格，再将同一动作送入目标骨架。
4. 在目标角色及 Blender 重导入的 GLB 中，按相同帧/事件复核骨骼方向、脚地面关系、手与道具的可见接触、动作连续性；记录每层首次失配的位置。

和 [枪法_2 复刻验证计划](../agents/deliverables/2026-10-13-recreation-failure-dimensions-validation-plan-v1.md)的关系：本摘要是可选的 3D 动作恢复分支，不替代该计划中的源帧证据表、镜头切点与 H3 输出验收。

- 2026-10-22 PersPose官方源码核对（43eb2c2）：PE输入K逆射线，PR使用KRK逆，裁剪同步更新K；demo要求EXIF/文件名焦距，缺失默认50mm，并非估计未知焦距。可作给定GeoCalib有效K的源姿态对照候选；仍需SMPL和独立权重，公开Drive可下载性/运行效果未验证、demo硬编码CUDA。主链路未改。[PersPose适用性](../agents/deliverables/2026-10-22-recreation2-perspose-review-v1.md)

- 2026-10-22固定有效K/骨长、仅四条近端方向≤5°/10°：early末端加权RMSE14.761→14.336/14.634px，later21.101→20.589/20.634，仍差于原始源19.465。源23反升12.822→14.986/17.292；拟合点更准不保证整条链更准。79/79优化成功，骨长误差≤1.11e−16、旧基线回归0、评分点扰动不影响本轮解。非严格独立验证、无体态/接触/H3通过，主链路未改。[有限方向对照](../agents/deliverables/2026-10-22-recreation2-limited-direction-v1.md)

- 2026-10-22占画幅/整体尺度隔离：检测框高度中位60.62%与面部→鞋代理60.02%不等同真身高。源人体层八点root拟合后身体投影高度early/later中位为观测96.97%/94.92%，额外等比二维缩放使末端RMSE15.1701→15.1435、19.4648→19.4620px，收益很小；该拟合已吸收全局尺度，不能证明焦距/距离正确或目标rig尺度无问题。目标mesh头顶→鞋底占幅尚待独立核对，主链路未改。[占幅比例诊断](../agents/deliverables/2026-10-22-recreation2-frame-occupancy-v1.md)

- 2026-10-22姿态×焦距交叉：f1280.9/1601.1/1921.4px重新拟合root后原始later末端RMSE19.669/19.465/19.399，根深度4.223/5.274/6.324模型单位；5°相对固定骨长均58帧改善21恶化，源23/55退化在三焦距下保持。仅换f不重拟合root会大幅恶化，不可据最低残差选真实K。旧目标28帧12关节占幅偏短，但首帧全局尺度修正使fixed_temporal腕踝RMSE12.834→17.460、torso_extended11.339→12.604；不支持直接整体放大。源真实K/深度、独立姿态、mesh完整占幅、接触/H3仍未通过；主链路未改。[姿态与焦距交叉报告](../agents/deliverables/2026-10-22-recreation2-pose-focal-sensitivity-v1.md)

- 2026-10-22实际RTMPose-M CPU独立2D权重对照：前六事件12身体点平均分歧6.21–10.01px，195/197为28.12/91.90px；bbox±10%平均变化仅约1–2px。197左前臂MP11.20px、RTM66.61px，后验整组左右互换分歧仍44.25px，不自动修标签。固定1601px K下，MP world对自身四末端15.62px、对RTM130.01px，重拟合RTM root后仍128.05px；自洽回投不证明源识别正确。79帧target_bbox逐值等于33点包围框，已更正此前“检测框占幅”口径；无独立3D/接触/H3通过、主链路未改。[独立二维识别对照](../agents/deliverables/2026-10-22-recreation2-independent-pose-v1.md)

- 2026-10-22转身连续帧：源185–213共29帧×3 ROI实际RTMPose推理；197复现坐标差0px。MP/RTM在195→197的12点平均位移74.01/20.63px，模型分歧197为91.90px、205回落12.22px，209再增41.20px。29帧RTM同名相邻匹配均优于整组互换，仍不证明RTM真值。MP缺测/未采样帧只插值目标框，不补关节；ROI±10%平均变化1.67/1.73px。优先独立核对源二维语义，禁止自动左右翻转；有效K候选1601px不变，真实焦距/深度、3D/接触/H3尚未通过，主链路未改。[连续帧诊断](../agents/deliverables/2026-10-22-recreation2-turn-continuity-v1.md)

- 2026-10-22可见腕点区域审查：非盲agent目视四帧，允许左右两种双射。197 MP两腕仅相距13.16px，可见手腕宽容区域最小间距209.41px；MP最佳平均点到区域距离101.77px，区域外扩10px仍87.77px，RTM两腕均落入原区域。195/203/205两模型区域外扩10px后均0，仅表示落入宽容区域。支持197存在腕点位置塌缩，不能只用左右互换解释；不是真值/统计验证，不推广全部关节。下一项隔离原始MediaPipe单帧/时序推断与提取序列化边界；主链路及有效K候选不变，真实K/深度/接触未解决。[腕点区域核对](../agents/deliverables/2026-10-22-recreation2-visible-wrist-audit-v1.md)

- 2026-10-23 GVHMR/WHAM官方固定commit契约审计：两人体默认f=图像对角线1603.278px，与有效候选差0.1334%，不证实真实K；GVHMR SimpleVO默认24mm对应全图889.339px，人体/VO默认不一致。WHAM calib只传SLAM，CustomDataset人体K仍默认。GVHMR静态模式另改后处理，六静止点含双腕；最低骨架Y归零不计鞋高，WHAM渲染也有最低mesh归零。精确上游相机函数CPU合成验证通过，完整网络未运行；当前CUDA/MPS不可用、必需模型资产未发现。优先GVHMR显式K/时基及后处理分离对照，但尚无新3D/接触通过。主链路未改。[契约与运行条件](../agents/deliverables/2026-10-23-recreation2-gvhmr-wham-contract-v1.md)

- 2026-10-23 GVHMR时基输入准备：源308帧第11→12帧PTS间隔271.265ms；官方逐帧按序改30fps会令源17时间提前250.322ms、197推迟113.387ms（源码计算，未跑完整demo）。实际生成30Hz最近帧FFV1输入301帧，279独立源帧/29未选/22重复，逐帧BGR哈希全匹配；7模型格点源偏移超过一步，源17被源18替代，严格时序验收失败。共享K数组与全部映射已保存，恒等旋转仅静态假设，不是模型就绪批数据。公开Drive权重目录两次超时、SMPL-X主页200；CUDA/合法资产阻塞未解除，网络未跑、主链路未改。[输入与时基报告](../agents/deliverables/2026-10-23-recreation2-gvhmr-input-bundle-v1.md)

- 2026-10-23 VFR重复画面核对：源第11→12帧PTS间隔271.265ms，但实际解码BGR MAE仅0.00162、差>3像素变化率2.42e-6；第12→13帧MAE升至0.07849、变化率0.00157。支持该长间隔对应近重复/静止画面延长，而非已证实动作缺帧；会污染固定30Hz速度统计，但不能解释全部接触失败。仅检查9–14帧，无时间轴/主链路改动。[VFR重复审查](../agents/deliverables/2026-10-23-recreation2-vfr-duplicate-audit-v1.md)

- 2026-10-23全片VFR扫描：308帧PTS严格递增，仅第11→12帧超过两个30Hz步长（271.265ms），且BGR MAE0.00162、差>3像素变化率2.42e-6；全片无系统性长间隔。近重复阈值命中5对，只有11→12与长间隔重合。该局部低信息区间可污染速度/接触统计，但不能解释后段195–211腕点异常；接触评估应单独标记并排除该区间，主链路不改。[全片VFR扫描](../agents/deliverables/2026-10-23-recreation2-vfr-global-scan-v1.md)

- 2026-10-23鞋底代理核对：79个有效MediaPipe帧中，heel/foot-index中点与踝点垂直差左/右中位26.21/25.83px，p95 34.20/37.60px；鞋跟-脚尖段长度中位27.84/37.29px且变化明显。真实PTS下鞋底代理速度中位84.59/83.15px/s，踝点80.23/60.46px/s，不能互换为接触真值。支持脚约束必须独立使用鞋底/网格底面与地面线，不能直接把踝点当鞋底；未选阈值、未改IK/主链路。[鞋底代理报告](../agents/deliverables/2026-10-23-recreation2-shoe-sole-proxy-v1.md)

- 2026-10-23目标 rig 脚链/网格只读解析：GLB含77 nodes、3 meshes、73 joints；两侧脚链为 ankle→foot→DEF_foot→toe→toe_attachment。主体 mesh primitive 0 每侧381个强脚链权重点，primitive 1仅每侧2个强脚链点；左右静止包围盒近似镜像。按GLB局部Y取最低点可定义“脚链影响网格最低点代理”，但轴语义、鞋底材质归属、renderer矩阵闭环和源帧接触尚未证明；未执行IK、未改主链路。[rig鞋底代理报告](../agents/deliverables/2026-10-23-recreation2-rig-sole-proxy-v1.md)
- 2026-10-23 media Blender 闭环：在 pinned rig（Blender 4.5.9，rig SHA `95eeb19c…`）上读取源1/17/23/29/41/55对应 bundle 姿态。脚链蒙皮后的最低带相对 foot head 偏移随姿态变化，不能用固定世界偏移替代；旧探针每帧重选最低带，数量14–53，不能直接测滑移。固定静止态48顶点 patch 后，跨六姿态数量恒定，但世界最低高度仍随脚部旋转变化；这验证了“固定顶点集合再测滑移”的诊断边界，尚未验证鞋底材质、地面或IK收益。[media rig鞋底报告](../agents/deliverables/2026-10-23-recreation2-rig-sole-proxy-v1.md)

- 2026-10-26 media Blender 接触目标隔离：恢复哈希核对的图像观测及未做IK的raw_root_yaw基线；六事件基线复现，18组几何/保持/重导入通过。固定鞋底patch组29帧18.46→17.99px，23帧12.25→12.96px；23/41触0.04units限幅且仍有平面残差。ankle/toe直接贴平面仅负对照，测试平面非源地面，连续接触未过。首次错误输入运行已标无效。用户报告H3上游延迟已解决，本轮未独立测H3；主链路未改。[报告](../agents/deliverables/2026-10-26-recreation2-contact-target-ablation-v1.md)

- 2026-10-26连续支持候选脚底分段：media Blender按源PTS读取28个独立样本，静止48点patch前/后各取16点，六事件patch基线复现0。left17–37与right43–55前后位移差比中位5.31%/4.42%，多数共同移动，不足以由最低接触点切换解释。root/局部余项速度幅值中位分别0.247/0.744和1.169/1.334 units/s；向量可抵消，不能转成因果占比。目标脚部运动存在，源真实滑移/地面/滚动仍未知；未锁脚、未改IK/主链路。[分段报告](../agents/deliverables/2026-10-26-recreation2-sole-segment-motion-v1.md)

- 2026-10-26源鞋部/背景核对：34帧固定鞋前部NCC匹配（两尺寸差≤2px、无搜索触边），17→37与43→55原图位移(−8,+8)/(+14,+6)px。支持鞋近正面，后跟不可见，不能给前后patch分别提供独立源接触点。三灯背景similarity相减残差约20/9px，但去一灯预测差最大26.67/5.00px；前段补偿敏感性同阶更大，不能宣称世界滑步或强制锁脚。下一步使用可见鞋缘二维容差与更分散地面背景证据，主链路未改。[源鞋背景报告](../agents/deliverables/2026-10-26-recreation2-source-shoe-background-v1.md)

- 2026-10-26脚部附近地面图块可识别性：8个预选图块以NCC、峰值差、正反循环、模板敏感性、边界门槛检查；随机纹理/水平条纹合成验证通过。非参考帧仅0–3/8点通过，未满足4点两行覆盖，未生成可接受similarity/affine地面模型。高NCC图块可能沿重复地面线漂移，不得用于世界脚锁定、root修正或焦距估计；主链路未改。[报告](../agents/deliverables/2026-10-26-recreation2-floor-patch-identifiability-v1.md)

- 2026-10-26二维鞋底代理投影对照：media Blender将目标 ankle/foot/toe/固定patch投影到640×360，与源 heel/foot-index中点缩放代理比较。支持侧patch误差源17/23/29为25.98/20.80/37.13px，源41/55为30.46/37.43px；支持入口吸收初始平移后，left段剩余偏差中位/最大6.54/11.33px，right段15.75/31.51px。源二维代理不与固定mesh patch稳定同点对应；不能用静态鞋底偏移或单一IK目标修复，主链路未改。[报告](../agents/deliverables/2026-10-26-recreation2-patch-projection-vs-source-sole-v1.md)

- 2026-10-26源可见鞋下缘阈值敏感性：对事件帧鞋部ROI测试四个亮度阈值，最低候选y范围在不同脚/帧为3–57px；反射、地面亮线和鞋体连通关系会改变最低点。亮度分割不能稳定生成源接触容差带，未升级为二维锁脚证据；主链路未改。[报告](../agents/deliverables/2026-10-26-recreation2-source-shoe-edge-candidate-v1.md)

- 2026-10-27姿势提取风险图：汇总root/yaw目标投影与RTMPose-M独立对照，双膝目标误差中位/P95 26.12/37.47px，为稳定最大组；双腕19.01/48.86px、双踝17.21/36.00px。第197帧为独立局部崩溃（模型整体分歧91.90px，膝130.49/99.99、腕102.85/131.91px），不可推广全段。下一步应做膝部可见区域标注与固定骨长/pole/深度专项对照，不再只调鞋底；主链路未改。[风险图](../agents/deliverables/2026-10-27-recreation2-pose-extraction-risk-map-v1.md)
