# 3D 导演台 Agent 计划、审批与执行边界 V1

日期：2026-09-23。状态：第一阶段实现中。

## Observed

- 导演台已有本地动作目录、确定性匹配、预览和可撤销应用。
- 当前浏览器状态通过 workbench store 管理；尚无导演台 Agent runtime。
- 动作目录和参考帧导入都明确保留“示意/只读/需要人工校正”的限制。

## Direct implication

第一阶段 Agent 只生成结构化 plan，不调用模型、不上传文件、不发起网络请求。
plan 必须经过当前场景校验，用户确认后才能转换成现有 `applyActionStructure` 命令。

## Contract

- `read_scene`：只读返回场景 revision、人物槽位、时间线 FPS/时长和锁定状态。
- `match_action`：只读匹配本地动作目录；无匹配或多匹配不得自动选择。
- `preview_action`：只读返回动作相位、目标和限制。
- `apply_action`：写入姿态/变换轨道和可选接触候选；必须显式审批，并创建一次 undo 记录。
- `undo_action`：只允许撤销最近一次对应命令。

每个 plan 保存 `planId`、`sceneRevision`、`actionId`、`catalogVersion`、目标人物、参数、限制和 `requiresApproval`。执行前若 scene revision、动作 checksum、人物锁定状态或目标不一致，必须拒绝并要求重新规划。

## Approval policy

只读查询和预览可自动执行；任何时间线、接触标记或未来模型/导出操作都需要用户确认。网络、上传、付费任务和视频导出不属于本 V1 工具权限。

## Success criteria

- plan 生成不修改 workbench 状态。
- stale plan、未知动作、锁定人物和非法时间范围被拒绝。
- 应用通过现有 store 命令完成，并可一次撤销。
- 单元测试证明没有网络调用。
