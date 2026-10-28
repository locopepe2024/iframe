# 导演台动画草稿重建入口

## 运行证据与原因

66f5535d 线上实测：坐姿提案、保存和素材库重新打开成功。默认 store 通过 createInitialActorPaths 为两名人物创建真实移动路径；designContext 将其视为 animated，动画编译器拒绝在该状态下追加群演或运镜。当前路径面板无删除整条路径入口，用户无法直接从默认草稿进入无动画设计。

## 修复切片

自然语言面板增加显式“清除动画，保留布局”操作。清除人物/机位路径、时间线内容、路径事件和外部运镜提案，保留人物姿态/位置、场景、机位、来源信息和时间线时长/FPS。回到首帧，清空旧提案和对话。一次操作可撤销；撤销恢复全部 authoring 内容。录制或请求期间禁用。无需自动删除或绕过已有动画保护。

## 成功标准

默认 store 经此操作可实际编译群演和运镜提案；人物、场景、机位和来源保持不变；undo/redo 恢复路径和时间线；面板操作清除旧预览。通过对应行为测试和类型检查。管理员合并部署，代理不部署。

## 涉及路径和命令

frontend/src/components/director3d/state/workbench-store.ts
frontend/src/components/director3d/design/DesignAssistantPanel.tsx
frontend/src/components/director3d/design/DesignAssistantPanel.test.tsx

npm run test:ui -- --run src/components/director3d/design/DesignAssistantPanel.test.tsx
npm run typecheck
