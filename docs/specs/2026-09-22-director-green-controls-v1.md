# 3D 导演台绿色交互控件修正 V1

## Observed

- 导演台交互样式仍包含黄色、琥珀色与蓝色高亮，和绿色 / 白色的目标色系不一致。
- “写入导出标记”和“启用噪声”的 checkbox 被局部样式放大到 44px。
- 构图主体与构图辅助线 checkbox 使用 24px 视觉尺寸，和其他表单控件不一致。

## Direct implication

- 同一种选择交互出现多种强调色，状态层级不稳定。
- checkbox 的视觉方框过大，容易被误读为独立按钮；触控热区不需要通过放大方框本身实现。

## Not yet proven

- 本次修正不改变导演台状态、保存格式、导出数据或 3D 场景行为。
- 未经浏览器截图验证前，不声明所有宿主主题下的像素表现完全一致。

## Scope

- 导演台交互强调色统一为绿色，正文和辅助信息继续使用白 / 灰层级。
- 红色仅保留给失败、错误和删除操作。
- 以下 checkbox 使用统一的 18px 视觉尺寸，并由所属 label 保留至少 44px 点击热区：
  - 写入导出标记
  - 女性运动服白模 A
  - 女性运动服白模 B
  - 三分法
  - 中心十字
  - 安全区
  - 启用噪声

## Success criteria

1. 导演台样式不再包含黄色 / 琥珀色交互色。
2. 上述 checkbox 共享同一控件类和绿色选中态。
3. checkbox 视觉尺寸为 18px，所属 label 的点击热区不小于 44px。
4. 导演台 UI 测试、类型检查和样式 diff 检查通过。

## Affected paths

- `frontend/src/components/director3d/camera/CameraCompositionPanel.tsx`
- `frontend/src/components/director3d/camera/CameraNoisePanel.tsx`
- `frontend/src/components/director3d/path/PathEventPanel.tsx`
- `frontend/src/components/director3d/scene/HumanoidStage.tsx`
- `frontend/src/components/director3d/state/workbench-store.ts`
- `frontend/src/components/director3d/styles.css`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
