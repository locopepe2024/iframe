# Director 3D 动作编排与 full_motion.bundle v1

## 目标

把已导入的 `motion-track.v1` 编排为一个可审阅、可复现的本地动作结果：

```text
motion-track.v1
  → local quaternion retarget
  → cleanup processors
  → foot contact evaluation
  → accepted contact 的逐帧 leg IK
  → full_motion.bundle.v1
```

这是浏览器内的确定性编排，不调用模型、不上传素材、不写入姿态时间线。

## 顺序与回退

1. retarget 只使用 `tracked` / `interpolated` 帧；其他状态保留 root 和 warning，不伪造姿态。
2. cleanup 只处理已有 quaternion，并记录处理器及参数。
3. foot contact 使用源轨迹的脚部目标、置信度、连续帧、速度和地面标定结果。
4. 只有 `accepted` 的脚部接触才进入 IK。
5. IK 需要完整髋、膝、踝、目标点和 pole target。缺失、不可达、退化或残差超限时，输出拒绝原因，并完整保留该侧进入 IK 前的 quaternion。
6. 左右脚独立处理；一侧失败不影响另一侧。

## bundle 边界

`full_motion.bundle.v1` 是导演审阅和后续 Blender 编译的候选数据，不代表真实骨骼校准、物理接触或最终动画。bundle 必须包含：

- source track revision、mapping revision、rig profile
- cleanup processor 快照
- 每帧 root、pelvis、local quaternion
- 每帧左右脚接触评估和 IK 结果
- warnings 和 preview 状态

预览状态只描述是否具备白模编译输入，不伪造 MP4、GLB 或渲染 URL。

## 验收

- retarget、cleanup、contact、IK 在同一调用中按上述顺序执行。
- 未接受的接触不会调用 IK。
- IK 失败保留原 quaternion 并暴露稳定 reason。
- bundle 可 JSON 序列化，包含 revision 和完整逐帧证据。
- 输入结果不被原地修改。

## 不在本阶段

- 从 GLB/Blender 自动校准 rest quaternion
- spine 分摊、全身 IK、地面求交和动作质量评分
- Blender 实际导出、视频渲染、provider 提交
- 将 bundle 自动应用到现有姿态时间线
