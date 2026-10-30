# 动作迁移算法与相似项目对照

## Observed

当前系统已经包含：源帧人工/ViTPose点、MediaPipe/GVHMR候选、相机候选、动作组和语义补偿、目标rig rest/父空间审计、Blender重定向和局部IK探针。当前实验仍是诊断链路；没有一个完整候选同时通过源动作、相机、地面、接触和白模验收。

公开项目和算法可以分为五类：

| 类别 | 代表项目/算法 | 已解决的核心问题 | 与当前系统关系 | 不能直接替代的部分 |
|---|---|---|---|---|
| 单帧全身网格 | SAM 3D Body/MHR、SMPLest-X、SMPLer-X、4D-Humans | 身体、手、脚的3D网格/关节和形状 | 可作完整腿链/脚部的单帧候选，SAM可接2D点和mask提示 | 不提供可靠视频身份、相机轨迹、接触时段和Blender retarget闭环；SAM权重尚待审批 |
| 视频世界运动恢复 | WHAM、GVHMR、WHAC | SMPL姿态、根轨迹、重力/相机世界坐标 | 对应当前GVHMR主候选；WHAM支持相机K和Temporal SMPLify | 单目深度/焦距仍有歧义；漫画模糊、夸张体型和切镜需人工/组级约束 |
| 时序2D/3D姿态 | TCMR、VideoPose3D、MotionAGFormer、ViTPose+tracking | 跨帧稳定、遮挡补全、平滑 | 支持“2–3帧组+前后补偿”方向 | 仅有时序稳定不等于真实深度或接触，不能跨镜头平滑 |
| 接触/重定向 | SAM3D Body world retarget paper、ProxyCap、Neural Kinematic Networks、Two-bone IK、Temporal SMPLify | 固定身份/骨长、世界根轨迹、软脚接触、FK/IK闭环 | 直接对应当前四层真值面和目标rig局部IK | 接触必须在目标mesh/地面坐标中定义，不能拿源鞋面点当目标端点 |
| 目标角色/工程管线 | mixamo-llm-mocap、MHR→SMPL/SMPL-X转换、Blender动作导入 | 父空间旋转、比例适配、目标骨架输出 | 可借鉴完整旋转保留、静止校准、解析two-bone IK | README/源码不证明适配自有rig、Blender版本或本卡通片 |

## Direct implication

最接近我们目标的不是一个单独模型，而是以下组合：

```text
镜头切分/相机候选
→ 代表帧语义与动作组
→ 单帧全身候选(SAM 3D Body或SMPLest-X)
→ 视频世界运动候选(WHAM/GVHMR/WHAC)
→ 固定身份和骨长的规范人体
→ 目标rig父空间FK重定向
→ 目标mesh脚底代理 + 场景地面 + 支撑时间窗
→ 局部IK/脚锁定/根轨迹优化
→ 源相机重投影与白模验收
```

其中每个模块承担不同真值面：模型负责人体候选，动作组负责时序语义，相机模块负责投影，目标rig负责骨长和脚底几何，接触求解负责目标场景中的支撑。把这些合成一个逐帧像素RMSE会重新混淆问题。

### 与当前误差最相关的算法差异

1. **当前早期路径：逐帧点→骨方向→目标rig**。它容易丢失绕骨轴旋转、父空间关系、相机/深度和脚掌几何；膝点下降可能换来踝点退化。
2. **公开重定向路径：完整SMPL旋转+骨长比例+父空间FK+腿部IK**。它更接近可编辑动作，但仍要求上游姿态和K可靠。
3. **世界运动路径：姿态、相机/根轨迹和接触联合优化**。它适合解决“人物在画面中移动”和“脚在世界中支撑”分离，但必须按镜头运行，不能跨切镜。
4. **当前新路径：镜头→动作组→语义补偿→关键帧拟合**。这与时序姿态和接触算法的实际结构一致，也减少了重复标注；语义补偿只能补状态，不能伪造像素/深度。

## Not yet proven

- SAM 3D Body、SMPLest-X或SMPLer-X尚未在本片7个关键帧上运行，论文/README指标不能代替本片结果。
- WHAM/GVHMR的公开数据集精度不能证明卡通人物、模糊帧、侧身、切镜和垫脚时的精度。
- Temporal SMPLify或2D时序平滑只能改善一致性，不能独立解决焦距/绝对深度。
- 任何“接触感知”论文实现都不自动知道本片的鞋底代理、目标地面或用户确认的64帧腾空。
- MHR/SMPL-X到自有白模rig的父空间和静止姿态仍需闭环验证；目标rig的网格鞋底代理目前是诊断契约，不是已验收生产资产。

## Hypotheses

当前最大收益可能来自架构顺序和真值面分离，而不是继续替换单帧关键点模型：先固定镜头和动作组，再用全身候选、世界根轨迹、目标脚底几何和接触IK分别求解。SAM 3D Body若获批，最适合承担“完整腿链/脚部单帧候选”；WHAM/GVHMR承担时序与世界运动；目标rig IK承担最后的脚底约束。

## What would verify it

用同一输入和同一评价表做四路小样本A/B：

1. 49/51/53/55/56/62/64代表帧，固定人物ROI和相机候选，比较GVHMR、SMPLest-X/SMPLer-X、SAM 3D Body。
2. 只在可见且语义一致的关节上比较2D投影；另列踝、脚尖、后跟、骨长、左右身份和形状稳定性。
3. 对50–53、54–57、58–61和62–65组分别做时序拟合，不跨镜头/不跨组插值；64/65的离地作为用户语义约束，不能由单帧模型覆盖。
4. 将同一规范人体送入目标rig：A为完整旋转+FK，B为比例适配+two-bone IK，C为目标脚底代理+支撑时间窗；报告源投影、脚底滑动、穿地、非支撑脚变化和边界跳变。
5. 只有当组内关键帧、留出帧、侧视、接触和镜头重投影同时通过，才考虑接入生产链路。

## Sources and code evidence

- [WHAM官方仓库](https://github.com/yohanshin/WHAM)：视频世界运动、可输入K、Temporal SMPLify后处理、可跳过SLAM得到相机空间动作。
- [GVHMR官方仓库](https://github.com/zju3dv/GVHMR)：gravity-view/world-grounded motion；默认SimpleVO/可选DPVO，支持静态相机模式。
- [SAM 3D Body源码核对](2026-10-29-sam3d-body-source-review.md)：MHR、脚/手、2D点和mask提示、MoGe2 FOV候选；当前权重门控未通过。
- [视频到Blender公开方案对照](2026-10-29-monocular-video-to-blender-research-v1.md)：ProxyCap、HTD-Refine、MoCaNet、Neural Kinematic Networks和SAM3D world retarget结构。
- [SMPL-X旋转迁移源码审查](2026-10-28-addams-rotation-pipeline-audit-v1.md)：完整旋转、静止校准、父空间FK、two-bone IK和接触指标的边界。
