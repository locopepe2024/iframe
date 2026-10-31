# 剪辑裁剪与时间线交互优化

基线：`301dd1d0`；OpenFilm skill 接入暂缓，见同日调研 summary。

## 问题与边界

代码观察：源入点/出点用毫秒输入；面板切换、缩放、添加轨道、精确定位和高度设置分散为多行。收起属性后选择片段不会重新展开。

本轮仅修改共享 `AssemblyTracks` 的交互及测试，兼顾独立剪辑和剧集 Assembly。保留现有时间线计划、原速剪辑、权限、保存版本和渲染协议。

## 实现与验收

- 源入点/出点以秒输入，保留 0.001 秒精度；提交时转换为整数毫秒。
- 选中片段即展开属性。播放头落在该片段有效区间时，可将源时间设为候选入点/出点；点击应用才提交一次可撤销裁剪。
- 播放头映射使用选中片段自身的源区间，不能把全片秒数直接当作源秒数；超出片段时禁用。
- 常用时间线操作集中在工具栏；轨道添加与区域高度收入可展开设置；面板切换移入预览区域工具行，保留明确标签和展开状态。
- 保留精确播放头、分割状态、缩放、键盘和原有轨道操作，不引入快捷键冲突。

验证：前端 AssemblyTracks/EditingPage UI 测试、assemblyEditing 逻辑测试、TypeScript 检查。新增行为用测试证明源时间映射、候选范围应用、属性重新展开；未执行线上部署即不得报告已部署。

## 本轮验证结果

- `npm run test:ui -- src/components/modules/AssemblyTracks.test.tsx src/components/modules/editing/EditingPage.test.tsx src/components/modules/assemblyEditing.test.tsx`：36 通过。
- `npm run test -- --run src/__tests__/editing-contract.test.ts src/__tests__/assembly-render.test.ts`：5 通过。
- `npm run typecheck`：通过。初次检查因复用另一分支依赖缺少基线所需 `recast-navigation` 而失败；切换为当前工作区独立 `npm ci --offline` 安装后通过，未修改锁文件。
- `npm run build`：通过；保留静态导出不应用 rewrites 的既有提示。
- 本轮未部署，未做真实浏览器视觉验收。修改同时影响独立剪辑与剧集共享编辑组件。
