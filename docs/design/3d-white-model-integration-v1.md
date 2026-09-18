# iFrame 3D 白模整合 v1

## Observed

- `iframe` 已经依赖 `three`、`@react-three/fiber` 和 `@react-three/drei`，并用 R3F 绘制 CreativeCanvas 背景。
- 本地候选来源 `git project/makehuman` 的 remote 是 `https://github.com/makehumancommunity/makehuman.git`，当前固定到提交 `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`。
- MakeHuman 的 `makehuman/data/3dobjs/base.obj` 文件头声明该基础网格按 CC0 发布；MakeHuman 的应用源代码则按 AGPLv3 发布。
- `iframe` 的复刻素材库目前只接受视频、图片和帧证据，复刻项目仍由 `recreation` 域管理；没有模型媒体类型。

## Direct implication

- 可以安全复用基础网格文件和其来源说明，但不能把 MakeHuman 的 Python/Qt 应用或桌面插件直接复制到 Next.js 前端。
- v1 应把白模视为一个内置参考素材，而不是自动创建的角色资产或复刻素材记录。
- R3F 组件应复用现有前端 3D 依赖，使用 `OBJLoader` 加载本地 OBJ；模型只在用户展开面板时挂载，避免每次打开复刻页都下载和初始化 WebGL。
- 白模预览只提供视觉参考，不参与 `generation-plan`、镜头关联、H3/Seedance 请求或时间线确认。

## Not yet proven

- 当前基础网格的最终浏览器帧率、移动端内存占用和所有 GPU/浏览器组合的 WebGL 兼容性尚未测量。
- OBJ 在所有目标浏览器上的加载耗时尚未测量；v1 不把它当作生产级动画模型，也不承诺骨骼、蒙皮或姿态编辑。
- 用户是否需要将白模姿态或截图保存为素材，尚未由当前需求确定。

## Hypotheses

- 对复刻镜头的构图和人物占位而言，旋转/缩放/线框足以验证首个交互切片。
- 后续若需要姿态、骨骼或可保存的 3D 变体，应先定义 `Media`/`AssetVariant` 数据契约，再引入 GLB/骨骼运行时或后端转换，不应把 v1 的内置 OBJ 当成可编辑资产。

## v1 boundary

1. 复制 CC0 的 `base.obj` 到 `frontend/public/models/makehuman/base.obj`，同时保存来源提交和许可证说明。
2. 新增可复用 `WhiteModelViewer`，提供加载状态、错误状态、轨道旋转、缩放、重置和线框切换，并适配窄屏。
3. 在复刻页增加延迟挂载的“白模参考”折叠面板；关闭时不创建 Canvas，不请求模型。
4. 不新增后端模型媒体类型，不自动写入资产库，不改变复刻数据库和生成 API。

## Success criteria

- `WhiteModelViewer` 的模型源、来源提交和许可证信息可在代码/静态资源中追溯。
- 折叠面板关闭时不会挂载 R3F Canvas；展开后能加载白模并显示操作按钮。
- 重置和线框切换有可测试的 UI 状态；加载/错误状态不会使复刻页崩溃。
- 现有复刻、资产库和前端 typecheck/test/build 全部通过。

## Verification

```bash
cd frontend
npm run typecheck
npm run test -- --run
npm run build
```

若后续加入模型持久化或镜头绑定，必须另写数据契约和迁移设计，不在本切片中隐式扩展范围。
