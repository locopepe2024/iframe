# recreation2 rig 鞋底代理诊断 spec v1

## Scope

只读解析 `white-model-neutral-female-v1.glb` 的脚链节点、skin inverse-bind 元数据和脚链相关网格，生成鞋底代理候选。禁止修改生产 builder、提取器、rig、H3 输入和主动画链路；本 spec 不包含 IK 落地。

## Inputs

- GLB：`frontend/public/models/director3d/white-model-neutral-female-v1/white-model-neutral-female-v1.glb`
- 解析工具：`docs/agents/tools/recreation2_rig_sole_proxy.py`
- 输出：`docs/agents/raw/2026-10-23-rig-sole-proxy/report.json`

## Success criteria

- 能复现 77 nodes、3 meshes、73 skin joints。
- 能列出两侧 `ankle/foot/DEF_foot/toe/toe_attachment` 的局部矩阵、静止世界位置和 inverse-bind 元数据。
- 能分别统计脚链任意权重、权重 ≥0.5 和最大权重属于脚链的顶点集合。
- 明确输出“脚链影响网格最低点代理”，不把它命名为真实鞋底，除非后续材质/渲染证据确认。
- 保留左右脚、primitive 0/1 的独立边界，避免把附属结构并入鞋底。

## Verification commands

```bash
python3 docs/agents/tools/recreation2_rig_sole_proxy.py \
  frontend/public/models/director3d/white-model-neutral-female-v1/white-model-neutral-female-v1.glb \
  --out docs/agents/raw/2026-10-23-rig-sole-proxy/report.json
python3 -m json.tool docs/agents/raw/2026-10-23-rig-sole-proxy/report.json >/dev/null
git diff --check
```

## Boundary

本轮只证明 GLB 内存在可分离的脚链影响网格候选；不证明坐标轴、相机、地面、接触状态、IK 收敛或源动作保真。下一轮必须先做 pinned-rig 已知姿态投影闭环，再做支持脚局部 IK 对照。
