# iFrame 复刻 / 3D 白模 / ControlNet 测试审计

日期：2026-09-20
范围：复刻任务恢复、付费确认、H3 生成与装配、3D 导演台/白模入口、ControlNet 迁移边界。
环境：macOS、Python 3.12.6、pytest 6.2.5、Next.js 14.2.35、Vitest 3.2.7。

状态快照：测试期间 3D 导演台改动已进入当前分支 `914f7b6f`
（`feat(iframe): integrate 3d director workbench`）；本报告及复刻修复仍是
未提交工作树内容。未执行 reset、checkout 或其他破坏性操作。

## Observed

### 已执行的自动化测试

- `python3 -m pytest -q`：642 passed，1 skipped，97 warnings（本轮恢复/缺源边界测试后重跑）。覆盖全仓 643 个后端用例，包含复刻分析、关键帧、H3 提交、FFmpeg 装配、媒体签名、任务恢复、UniArt 适配器、3D 相关视频任务快照。
- `cd frontend && npm run test:all`：23 个逻辑测试文件 174 passed；37 个 UI 测试文件 187 passed；合计 60 个文件、361 个测试通过。
- `cd frontend && npm run typecheck`：通过。并行构建时曾出现一次 `.next/types/app/page.ts` 缺失；构建完成后单独重跑通过，判断为 Next 构建清理目录与 typecheck 的时序竞争，不是类型错误。
- `cd frontend && npm run build`：通过，静态页面生成成功；`static/models/.../white-model-neutral-female-v1.glb` 和 `static/models/makehuman/base.obj` 均存在。
- `git diff --check`、Python `compileall`：通过。
- 本次修改文件的定向 ESLint：无 error。复刻文件只有 `<img>` 优化 warning；导演台文件只有一个既有 `useMemo` 依赖 warning。全仓 `npm run lint` 仍失败，错误分布在大量既有文件（`no-explicit-any`、未使用变量、Hook 规则等）；由于未在基线 commit 单独执行 lint，不把全部错误绝对归因于基线。

测试 stderr 中的已知非失败项：pytest/pytest-asyncio/Pydantic/DashScope 弃用提示、Vitest 中故意触发的网络错误、Lightbox provider warning、Three.js 多实例 warning、无可用浏览器存储时的 Zustand warning。

### 探索性检查与发现

1. **任务列表 SQL 排序边界已修复。** `recreation_generation_tasks` 和 `recreation_assembly_tasks` 的 `created_at` 只存在于 JSON `data`，原列表查询却引用不存在的 SQL 列，会让刷新恢复接口返回 SQLite 500。现在改为 `json_extract(data, '$.created_at')`，并新增服务层回归测试覆盖 generation/assembly 列表。
2. **旧 revision 关键帧污染已修复。** 项目级 keyframe 列表会包含历史任务；前端恢复前现在同时校验 `revision` 和 `analysis_id`，并新增旧版本不恢复的 UI 测试。generation/assembly 恢复也保留同样的版本过滤。
3. **3D GLB 生产路径已修复。** 默认生产导出挂载在 `/static`，导演台模型 URL 改为相对路径；新增测试锁定该约束。GLB 二进制头和 JSON 结构检查通过：glTF 2.0、2 chunks、77 nodes、3 meshes、1 skin、1 buffer；`file` 识别为合法 glTF binary。
4. **白模资产可追溯。** MakeHuman OBJ SHA-256 与 `SOURCE.md` 一致：`8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`。导演台 GLB 与 OBJ 都进入生产静态输出。
5. **导演台网络边界检查。** `frontend/src/components/director3d` 未发现 `fetch`、`axios`、独立 `/api`、WebSocket 或生成请求；本地草稿使用 `iframe.director3d.browser-draft.v1`。导航、草稿恢复、姿态 preset、undo/redo、移动端入口均有 UI/逻辑测试。
6. **ControlNet 请求边界检查。** 复刻的 `process_generation_task` 目前只构造 `ref_image_urls`；没有发送 `ref_video_urls`、`ref_audio_urls`、`controlnet`、`openpose`、`pose_control` 或 `depth`。仓库中出现的 ControlNet 文本主要是设计说明或旧的不可达注释；不能视为 Provider 已支持。
7. **关键帧与生成付费保护。** UI 不再硬编码 keyframe `accept_cost: true`；复刻关键帧、H3 提交、生成重试都要求显式确认，后端也拒绝 false。任务状态达到 completed/failed/cancelled 后停止对应轮询。
8. **失败与进程恢复边界已补测。** 刷新后最近一次同 revision/analysis 的失败关键帧会显示持久化错误；原片在提交前消失会由生成 API 返回 409 并要求重新注册。带已保存 Provider task ID 的 processing 任务会走 resume；没有 task ID 的中断任务会标记 failed 且不调用 Provider，避免重复付费。

## Direct implication

- 本地 mock、FastAPI TestClient 和静态解析已经证明任务记录、所有权、revision/analysis 门槛、媒体签名、任务列表恢复和前端状态恢复在代码层可运行。
- 3D 导演台当前是浏览器本地工作台，不是 iFrame Core 的持久化项目，也不会自动变成资产或生成请求。
- 复刻当前是“有序图片参考 + 已验证 H3 prompt contract”的实现；普通参考图、导演台 pose、深度/遮罩数据与 ControlNet 控制输入仍是不同概念。
- SQL 列表错误和旧 keyframe revision 污染属于已定位并已修复的真实边界问题；生产 `/static` 模型路径也已通过构建产物检查。

## Not yet proven

- 真实 UniArt Provider 的提交、轮询、下载、超时和最终视频视觉质量；本轮没有使用真实凭据或外部 Provider。
- H3 输出的动作保持、运镜、节奏、产品替换准确度、手部遮挡和音频语义质量。
- UniArt/H3/Seedance 是否接受 OpenPose、Depth、Edge 或任何 ControlNet 字段，以及这些字段是否会改变结果。
- 真实进程重启后的完整自动恢复；本轮只在服务层验证了重新发现、Provider task ID resume 和无 ID 时拒绝重提，当前契约仍不会静默重提交付费请求。
- 3D 白模的浏览器 WebGL 实际渲染、骨骼变形/姿态 parity、不同 viewport 的像素布局和触控体验。当前只做了 GLB 结构、构建产物和 jsdom/UI 测试。
- 浏览器刷新后从 `/static` 真实 HTTP 服务取得 GLB/OBJ 的网络级验证。
- 通用媒体资产库合并、Seedance recreation contract、最终视频写入通用资产条目。

## Hypotheses

- 如果生产静态服务器按 Next export 的 `/static` 规则提供文件，改用相对 GLB URL 应能同时覆盖默认 Web、开发和 Tauri；仍需浏览器实测确认实际 base URL。
- 关键帧旧 revision 过滤应避免刷新时显示错误版本，但在同一 React 实例内发生 revision 更新时，草稿保留策略仍需要产品级交互确认。
- Provider 支持 ControlNet 的可能性不能由字段命名、普通图片参考或导演台深度编辑器推断；在官方请求契约验证前，继续发送这些字段会是未证实的付费风险。

## What would verify it

1. 在用户明确授权后，对限定的本地目标 `http://127.0.0.1:3008/#/director` 和 `#/recreation` 运行浏览器自动化，检查 WebGL、模型加载、旋转/缩放、姿态编辑、移动端布局、静态资源 200 和刷新恢复。当前没有执行浏览器/Web MCP。
2. 在隔离 Provider 沙箱用非生产凭据执行一条 H3 和一条关键帧请求，记录 request shape、provider task ID、轮询终态、下载文件和媒体指纹；不把 mock 结果当线上事实。
3. 取得 UniArt/目标模型的正式 ControlNet/OpenPose/Depth 请求文档或可复现成功样例后，先补 model-catalog capability，再增加 provider adapter 和端到端 fixture。
4. 在隔离 worker 进程中验证写入 processing + provider ID 后的重启/重新发现与 terminal 收敛；服务层已覆盖 resume 和无 ID 不重提，仍需进程级运行观察。
5. 单独建立 lint 基线清理任务，避免把全仓历史 lint debt 与本次复刻/3D 功能混在一起。

## 当前结论

本轮本地验证为绿色，且修复了会影响刷新恢复、错误反馈、源文件提交和生产 3D 资源加载的边界问题；但“真实 Provider 生成质量”和“ControlNet 已迁移并有效”仍未被证明。复刻与 3D 白模可以继续进行受控本地试跑，ControlNet 暂应保持 capability-gated，不应在未验证 Provider contract 前宣称已完成迁移。
