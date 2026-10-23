# 目标 rig 脚链与鞋底代理只读核对

## Observed

- 读取目标 GLB `white-model-neutral-female-v1.glb`，未修改 GLB、builder、动画提取器或 H3 输入。文件包含 77 个 node、3 个 mesh、1 个 skin、73 个 skin joint。
- 两侧脚链均为 `ankle → foot → DEF_foot → toe → toe_attachment`。脚链节点在 skin 中成对存在，左/右静止世界位置在 x 轴上近似镜像；局部 `ankle → foot` 和 `foot → toe` 的主要位移均落在 GLB 的 Y 轴，说明当前 GLB 的竖直/前后语义仍需由运行时或已知姿态确认，不能只凭名称推断。
- 脚链影响网格只出现在 mesh 2：
  - primitive 0：每侧 429 个顶点有任意脚链权重，381 个顶点脚链权重达到 0.5，381 个顶点的最大权重骨骼属于脚链。
  - primitive 1：每侧 42 个顶点有任意脚链权重，但只有 2 个顶点脚链权重达到 0.5；它更像少量附属/装饰绑定，不能作为完整鞋底证据。
- primitive 0 的脚链影响区域（GLB 局部单位）左右近似镜像：
  - 左：`min=[0.0672306,-0.0084073,-0.1314064]`，`max=[0.1819539,0.1146892,0.1302563]`。
  - 右：`min=[-0.1819539,-0.0084073,-0.1314064]`，`max=[-0.0672306,0.1146892,0.1302563]`。
  - 按当前 mesh Y 轴取最低顶点，左/右候选分别约 `[±0.1380899,-0.0084073,0.0301766]`。这是“脚链影响网格最低点”代理，不是已证实的鞋底接触点。
- primitive 0 的 381 个强脚链权重点与 primitive 1 的 2 个强脚链点分布不同。将所有任意权重顶点混为一个接触面会把装饰或过渡区域纳入候选，扩大接触面误差。
- 解析同时保留了脚链 node 的局部矩阵、静止世界位置和 inverse-bind 矩阵元数据；本轮未将它们送入 Blender 渲染，也未将代理点投影回源帧。

## Direct implication

- 目标 rig 已有比 `ankle` 骨头更接近网格底部的候选：应在后续局部 IK 诊断中使用脚链影响网格的底部 patch/最低点，并记录其相对 ankle、foot、toe 的偏移。
- 仅用 `ankle` head、`foot` head 或 `toe` node 作为地面接触点会混入骨骼层级偏移；此前源二维 heel/foot-index 中点与 ankle 垂直差约 26 px 的结果与此结构一致。
- primitive 0 应作为主要鞋体候选，primitive 1 只能作为附属几何的独立候选；支持脚测试应分别报告，不应先合并成一个“鞋底点”。
- 当前证据足以定义一个只读的 sole-proxy 候选，但不足以直接决定地面法向、接触面或 IK 目标。

## Not yet proven

- GLB 的 Y 轴是否就是运行时地面竖直轴、Z 轴是否就是脚尖方向，尚未通过已知姿态或 Blender/renderer 运行时闭环确认。
- 最低局部顶点是否对应视觉鞋底，而不是鞋面、裙摆/装饰的脚链影响区域，尚未通过材质/面片拓扑或渲染图像确认。
- inverse-bind 与 renderer 的矩阵排列、节点世界矩阵及动画姿态下的最终网格变换尚未做端到端投影验证。
- 尚未证明该代理能改善源第 1、17、23、29、41、55 帧的脚接触、落脚滑移或全身投影；本轮没有执行 IK，也没有改变主链路。

## Hypotheses

- 最大误差的脚部部分可能来自把二维 ankle 观测或骨头头部直接当作鞋底接触点，导致目标接触面沿脚链局部偏移。
- 若运行时竖直轴确为 GLB Y，primitive 0 的最低 Y patch 可作为局部 IK 的候选末端；若轴语义不同，直接用该坐标会把接触约束施加到错误方向。
- primitive 1 的少数强影响点可能是鞋带/附属结构，若把它并入鞋底会造成姿态依赖的接触抖动。

## What would verify it

1. 用已有 pinned-rig 已知姿态闭环，把 primitive 0 最低 Y patch、patch centroid、`foot` head、`toe` node 分别变换并投影；确认其相对顺序、镜像关系和 renderer 重导入误差。
2. 在 GLB 材质/三角面层面标出最低 patch 是否属于鞋底面；若无法证明，报告名称保持“脚链影响网格最低点代理”。
3. 仅在诊断副本中，对支持脚时段分别施加四类目标：ankle、toe、最低 patch、最低 patch + foot/toe 方向；比较鞋底高度残差、水平滑移、另一脚偏移和 12 关节投影误差。
4. 以源第 1、17、23、29、41、55 帧及连续支持段复核，并保留真实 PTS；任何方案都必须同时通过接触、滑移和全身投影，不能用单一中位误差替代事件帧验收。

[原始解析结果](../raw/2026-10-23-rig-sole-proxy/report.json)；[只读工具](../tools/recreation2_rig_sole_proxy.py)。


## Media Blender known-pose closure

### Observed

- 通过 media 主机 `/opt/blender-4.5.9/blender`（Blender 4.5.9 LTS，hash `8bf95cbd38d1`）读取 pinned rig；rig SHA-256 为 `95eeb19c8abce2325479804b3dda429ebddfa6e8d07a2688541cc990fb676855`。只读探针没有修改远端 rig。
- 在源 1、17、23、29、41、55 对应的已知 bundle 姿态上，脚链影响网格最低带均能被评估。探针使用 Blender mesh 的 `DEF_foot`、`toe`、`toe_attachment` 顶点组；每侧静止姿态最低带 48 个顶点。
- 静止姿态下，最低带质心相对 `foot` 骨头 head 的偏移约为左 `[+0.01487,-0.08674,-0.05507]`、右 `[-0.01487,-0.08674,-0.05507]` Blender units。
- 六个动作姿态中，该偏移随脚部旋转变化：例如源 1 左/右约 `[-0.00323,-0.08388,-0.05109]` / `[-0.01998,-0.10660,-0.05301]`，源 55 左/右约 `[-0.02743,+0.03073,-0.05866]` / `[-0.03939,-0.06404,-0.06106]`。因此不能用固定世界轴偏移替代脚链局部变换。
- 脚底最低带的世界最低高度在六个姿态中明显不同；源 41 的右脚约 `-0.00353`，而源 55 的左脚约 `0.21738`。这只是目标 bundle 的网格高度，不能直接当源片地面高度。

### Direct implication

- media Blender 闭环确认：脚底候选必须从蒙皮后的网格重新计算，且应随 foot/toe 局部旋转更新；直接把静止态 ankle/foot head 加固定偏移会在转脚时产生系统误差。
- 该探针已经验证了候选点的运行时网格变换可以在 pinned rig 上读取；下一步可在诊断副本中把最低带质心作为局部 IK 目标，与 ankle head 和 toe head 做三路对照。

### Not yet proven

- 最低带是否为视觉鞋底接触面；
- 哪个源帧/哪只脚是真正支持脚；
- 目标地面平面、相机投影和 IK 约束是否会改善源帧误差；
- GLB primitive 0 代理与 pinned Blender vertex groups 是否完全同一网格语义。

### What would verify it

在 media Blender 上继续运行局部 IK 副本：每个候选目标分别比较网格最低高度残差、水平滑移、另一脚偏移和 12 关节投影；至少覆盖源 1/17/23/29/41/55，并保留 PTS。

[Media Blender 原始结果](../raw/2026-10-23-rig-sole-proxy/media-projection-report.json)
