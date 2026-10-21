# Companion CopilotKit 交互 PoC

日期：2026-10-21
状态：用户同意后实施的隔离试验；不替代照片 V1、现有 `/companion` 或正式授权后端。

## 目标与成功标准

新增 `/companion/copilot-trial`，保留原型默认入口。锁定 SDK 与 AG-UI 兼容版本，真实使用 CopilotKit V2 的 Provider、Agent、前端工具/人工确认和渲染机制。采用浏览器内确定性 AG-UI Agent，不运行模型、不提供 HTTP Runtime、无用户线程数据服务、不接 Intelligence、不发送照片。

仅两个交互：

1. 发送“字调大一点” → Agent 工具请求 → 大字确认卡 → 明确确认才调整；拒绝/取消不调整；可恢复普通字号。
2. 对单个合成照片批次请求按时间整理 → 卡片说明处理位置、批次、时间 scope → 明确授权才运行本机模拟任务 → 按真实样例日期/未知显示结果；拒绝不启动；撤回后不新增结果，可重置演示。

语音复用浏览器可选听写，先展示转写供核对，再由用户发送。模糊指令、带否定的表达不直接判作确认。一次只有一个当前问题，确认绑定工具调用 ID / 当前批次，不复用旧卡；重复点击只执行一次。字号设置在此页真实生效；照片整理只是合成记录模拟，页面明确展示区别。

## 隔离与状态

- 所有照片为代码内合成元数据/自有 SVG 示意，无真实上传或人脸模型。使用内存状态，刷新重置，不能宣称后端持久化、真实 owner 隔离或恢复已完成。
- 不挂载原有账号/配置初始化，不读取现有对话，不改模型目录。不把 API key 放浏览器。SDK 调试/Inspector/云配置明确关闭。
- UI 工具参数须解析校验；不接受任意字号/CSS、批次 ID、scope、处理位置或客户端自报权限。模拟服务对当前问题/批次/版本核验，重复请求幂等；未来替换为认证服务端 API，不以 UI respond 充当业务授权。
- SDK 与 AG-UI 持有对话/工具事件，本机模拟服务持有样例授权与任务事实；页面根据实际结果展示，不从模型文本取完成数。失败/取消有清楚恢复入口。
- 离页中止录音/朗读、Agent 运行和样例任务；不使用默认语音自动发送，不增加云数据采集。

## 受影响路径与验证

- `frontend/package.json` / lockfile：确切版本；不升级 React/Next 或无关依赖。
- `frontend/src/app/companion/copilot-trial/` 与 `frontend/src/components/companion/copilot-trial/`：独立入口、确定性 Agent、样例状态机、适老卡片和样式。
- `ApplicationBoundary`：只增加明确的试验路径隔离，常规业务路径仍保留原 Providers。
- 定向测试使用真实 SDK，不 mock 成普通 React 状态；验证工具调用 → 卡片 → 返回结果往返、拒绝、恢复、重复回传、错误/撤回、退出清理及无业务/模型网络请求。
- `npm run typecheck`、定向 `npm run test:ui -- ...` / `npm run test -- --run ...`、`npm run build`。以构建记录 React 18 / 静态导出兼容证据，不将组件测试当手机实测。
- 记录 SDK/AG-UI 版本、试验初始包大小与 `/companion` 对照、已验证与未验证；不推送或部署。

后续才验证真实模型 tools 协议、认证/owner-thread 隔离、后端授权与任务恢复、真实设备和老人任务。该 PoC 的用户本机授权/任务结果不能用于正式照片处理。

## 实施与验证（2026-10-21）

- 独立静态路由：`/companion/copilot-trial`；原 `/companion` 保留。浏览器内确定性 AG-UI Agent 通过 CopilotKit V2 Provider、`useAgent`、`useHumanInTheLoop` 和工具结果完成往返。固定句式仅供协议试验，不代表已接入聊天模型。
- 锁定 `@copilotkit/react-core@1.79.1`、`@ag-ui/client@1.0.2`、`@ag-ui/core@1.0.2`、`rxjs@7.8.1`、`zod@3.25.76`。保留 React 18 与 Next 14。未配置 Runtime、Intelligence 或 Inspector；交互采集关闭。
- 确认卡按工具调用 ID、样例批次 ID 与授权版本核验；拒绝不执行，重复确认幂等，撤回清除模拟结果并阻止旧计时器继续提交。听写须显式勾选，转写先放入输入框供核对。
- CopilotKit 发布包自带 Tailwind v4 样式与现有 Tailwind v3 构建冲突。仅把该包的默认 UI CSS 解析到本地空样式，试验页使用独立样式。静态导出通过；这不验证未来使用 CopilotKit 默认 UI 的兼容性。
- 本次验证：`npm run typecheck`、43 项定向 UI/协议/状态测试、`npm run build`。测试验证浏览器内工具往返及无 fetch/本地持久化；未做真实手机、浏览器语音服务或老人可用性实测。Next 构建显示试验页首载 95.6 kB，但动态 SDK 代码不计入此数字，需在真实设备测量完整下载和交互性能。
