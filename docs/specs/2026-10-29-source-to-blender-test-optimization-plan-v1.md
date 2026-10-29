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
