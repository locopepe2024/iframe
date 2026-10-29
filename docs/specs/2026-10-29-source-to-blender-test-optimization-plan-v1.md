# 源视频到 Blender：分层测试与优化方案 v1

## Objective

把源视频复刻为可编辑 Blender 动画，明确区分源观测、人体恢复、目标rig迁移、脚底接触和镜头重投影；每层独立验收，不用单一二维RMSE代替全部质量。

## Boundaries

- 诊断源：Addams shot1，源帧37–65，重点49–58。
- 目标：media Blender 4.5.9 的 white-model-neutral-female rig。
- 第一阶段只读/生成诊断资产，不改生产主链路。
- 源25fps到模型30Hz只允许最近帧重复；禁止用重复帧声称产生新动作证据。

## Layered pipeline

1. **Scene contract**：源帧尺寸、裁剪、fps、相机内参候选、相机外参候选、ground plane。
2. **Target asset contract**：rest pose、骨架父空间、骨长、mesh包络、heel/forefoot/toe、sole plane、单位和轴向。
3. **Human motion**：2D点、SMPL/MHR姿态、固定身份和骨架尺度、世界根轨迹、时序平滑。
4. **Retarget**：源规范骨架到目标rig的FK/局部旋转映射，验证父空间和骨长。
5. **Contact IK**：源支持脚标签只定义时间窗；目标rig sole plane和ground plane定义空间约束；局部IK/foot lock修正滑动与穿地。
6. **Camera/render**：用同一场景相机生成白模和深度，再做源画面对照。

## Tests and success criteria

### T0 Input/time integrity

- source SHA、尺寸、fps、帧映射和回读像素哈希一致。
- 任何重采样误差单独记录。

### T1 Target asset contract

- rest pose下左右脚代理点、sole plane、骨长和mesh bounds可重建。
- FK roundtrip端点误差 `<1e-5` Blender units。
- ground plane来源明确，不能从源鞋点直接推断。

### T2 Human/camera separation

- 固定姿态只调相机，报告相机拟合上限。
- 固定相机只调姿态，报告姿态拟合上限。
- 训练帧与未参与拟合的帧分开；不把人工点误差当真值深度。

### T3 Retarget

- rotation matrix determinant `+1`。
- 父空间回写和FK replay端点误差 `<1e-5`。
- source/target bone length contract不被动画曲线隐式缩放。

### T4 Contact IK

- 接触区间内目标sole最低点与ground的穿透 `<=1mm`。
- 支撑脚sole平面速度中位数 `<1cm/s`，报告最大值和覆盖率。
- 局部IK踝点位移上限暂定5cm（工程诊断门槛，尚非用户质量标准）；超过即拒绝晋升并回查根轨迹/映射/接触语义。
- 非支持脚不被强行锁定；垫脚必须按脚跟/前掌/脚尖的接触类型验证，不强压整只脚水平。
- 接触点允许按滚动/转轴阶段切换；单一固定网格点锁定只作为对照假设。

### T5 Final acceptance

- 动作阶段、人物比例、遮挡关系、镜头构图分别复核。
- 光影只在场景/渲染层验收，不反向修改骨架。

## Optimization order

1. 完成 T1 canonical target rig contract。
2. 用 T1 代理做接触IK小范围对照，不追源鞋尖像素。
3. 再做 T2 相机/姿态隔离和时序优化。
4. 最后把通过的姿态曲线迁移到目标rig并做T4/T5。

## First executable slice

命令（media）：

```sh
/opt/blender-4.5.9/blender --background --factory-startup --disable-autoexec \
  --python /tmp/addams-pose/addams_target_rig_contract.py
```

输出 `target-rig-contract.json`，包含目标rig rest pose、骨架轴向、脚代理点、sole plane、mesh bounds、ground candidate及哈希。只有该契约通过后，才允许接触IK脚本读取目标脚底。

## Evidence labels

- `code fact`：Blender对象、骨骼、矩阵和mesh计算结果。
- `runtime observation`：实际渲染/回放/指标。
- `algorithm implication`：分层FK/IK和接触约束的直接含义。
- `hypothesis`：对源视频不可观测深度、遮挡或语义的解释。

## 2026-10-29 Executed slice

- T1部分完成：rest状态下左右脚网格归属互斥、代理同侧、foot-local代理坐标往返误差<1e-5。尚未完成完整FK回放、变形权重审计和视觉验收。
- 修复右前掌代理错误：旧搜索半径覆盖了左脚；v2按最近踝点划分网格，并输出可重用的vertex indices。
- T4资产原点地面对照：接触误差可压低，但踝移动73–82cm，不通过局部校正要求。
- T4支撑高度中值对照：ground z=0.5256575；第49/52/53帧踝移动0.38/28.10/31.94cm；只第49帧满足5cm位移门槛，整组不通过。
- 地面候选只用于隔离原点偏移，不能当作恢复出的真实源地面。三帧不构成连续滑动速度验证。

### Next falsifiable checks

1. 固定脚部朝向，分别记录无锁定、仅高度、仅XY、完整锁定四组位移，区分高度与水平锚点冲突。
2. 用同一支持窗逐帧核对根位移和踝相对骨盆位移，不增加新的人工逐帧标注。
3. 检查脚掌滚动/转轴，只有确认固定接触段后再测滑动速度。
4. 通过上述门槛才做视觉、相机和全片推广。

## v2 execution boundary correction

2026-10-29：第一轮T4使用的rotation-candidate是固定相机的incam诊断，不是世界/地面已对齐的动画。其up=−Z，旧min-Z接触数值降级为历史诊断。

新增执行顺序：

1. 明确incam/global语义以及camera/world变换；先验证det、35帧重投影回放一致性。
2. 在世界候选中定义ground-up和目标脚底代理；camera-up不能冒充真实重力。
3. 重测T4无约束/solver-only/height/XY/full，保持每个单元独立重载，不写入诊断求解目标动画以免污染下一帧。
4. 接触和人工二维点共同验收；接触通过但动作投影变差不得静默晋升。

本轮世界候选完整IK踝修改49/52/53帧为1.35/3.68/5.77cm；第53帧仍超暂定5cm预算，整组不通过。35帧原投影回放最大变化0.000178px，仅为内部一致性。下一步先做固定同一网格点对照，再评估滚动/转轴，不扩大人工逐帧标注。详细结果见`docs/agents/deliverables/2026-10-29-world-camera-contact-ablation-v2.md`。

## T2-B 独立背景相机验证（本轮新增）

### Boundaries

- 优先读取原始25fps视频的37–65源帧，不以30Hz重复帧增加证据数量。源SHA必须与现有manifest一致。
- 仅使用人物之外的石墙、固定地面等背景区域。人物、运动植被、阴影变化、遮挡轨迹不参与相机拟合；保留mask叠图供复核。
- 先做独立二维背景运动诊断，证据足够后才进入media Blender Matchmoving三维求解。此阶段不修改生产相机或人物动画。

### Executable slice

1. 原片解码、背景mask、角点与双向光流；记录轨迹长度、覆盖区域、可用点数及失败原因。
2. 同一训练轨迹比较identity、translation、similarity、homography；空间分组留出一部分轨迹，不用拟合内点误差冒充独立验证。
3. 记录每帧留出误差、中值/P95/最大值、相对identity改善，以及49/52/53帧与相邻帧的背景位移。区分局部帧间运动与相对首帧累计运动。
4. 仅当背景覆盖和留出表现可靠时，固定画面可保留固定相机候选；背景有一致运动则进一步区分纯旋转、平移视差、变焦及裁剪/防抖，不能由homography直接宣称恢复三维平移。
5. 三维阶段比较固定相机、纯旋转与完整解算；用未参与拟合背景点检验重投影，并单独验收地面、尺度和人体投影。未知焦距/传感器/裁剪不填伪精确真值；Refine结果只能标记估计。

### Acceptance and limits

- 本轮二维阈值仅为工程诊断门槛，不是最终拍摄验收标准。报告分辨率，不能把960px上的0.5px当作原3840px上的0.5px。
- 拟合误差小不等于真实焦距、绝对尺度、重力或深度已知。无足够视差时标记不可辨识，不强行输出三维轨迹。
- Blender地面由可靠地面几何定义；选三点定向不能证明这些点物理上共面或被正确三角化。
- 在同一背景证据上对照现有inferred-global相机；人物global/incam内部一致性只作为回放检查。

### T2-B first run / 2026-10-29

- media OpenCV对原始25fps帧验证完成：49→52/53各313有效轨迹、75留出点，identity位移中值0.0138/0.0151px，P95均约0.066px（960×520）。49→65中值0.0240px。
- 37→49累计背景位移中值52.812px，平移拟合后留出中值1.568px。不能把后段固定画面假设扩展至整个片段；前段39帧较大帧间运动需做边界/连续性检查。
- 后段优先保留固定相机基准；前段单独处理。尚未完成三维matchmoving、焦距或地面恢复。
- 下一切片：固定49–65相机，对人物轨迹进行受限拟合；与inferred-global候选在同一可见点、同一接触代理和留出帧上比较。
- 报告：`docs/agents/deliverables/2026-10-29-background-camera-validation-v1.md`；mask图已人工检查49/52/53人物未被纳入。
