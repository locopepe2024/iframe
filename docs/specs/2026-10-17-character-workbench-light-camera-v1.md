# iFrame 场景设计光影与镜头任务 V1

日期：2026-10-17。状态：实施规格。

## Observed

- iyishow 图片容器的光影面板提供亮度、主光颜色与方向、轮廓光和风格预设；镜头面板提供视角预设、水平环绕、俯仰、景别与对焦参数。参数被投影为生成提示词。
- iFrame 场景素材工作台已有 Image Reference、Video Reference 两个任务，按稳定 `asset_id + variant_id` 引用素材生成候选。
- 当前角色工作台与场景素材弹层都有桌面最大宽度限制，宽屏时不能铺满右侧浏览区域。

## 范围与边界

- 在场景素材现有 Image Reference、Video Reference 同一级新增“光影”和“镜头”标签。两者从当前场景已经保存的图片变体中显式选择来源。
- 保留 iyishow 的主要参数和预设语义，投影为场景图片的单次参考图生成提示词。结果仍由 iFrame 场景素材候选管理。
- 光影支持主光六方向、颜色、亮度、轮廓光、正面/透视观察、智能模式、八个预设及从可引用素材选择的附加光影参考图；镜头支持七个视角预设、水平/垂直角度、景别、可拖动对焦点与半径、补充提示词开关。两者显示随参数变化的示意图；示意图不是模型输出预览。
- iyishow 的节点配置与独立图片上传不直接复制到 iFrame；场景工具沿用 iFrame 的资产引用和一次性生成任务。
- 来源图缺失时不提交；提交时带来源 `asset_type=character`、`asset_id`、`variant_id` 和 `image_generation_mode=reference`。
- 光影只要求改变受光关系；镜头只要求改变观察视角。两者都要求保持场景结构和主体连续，不修改场景描述。
- 角色工作台及场景素材弹层扩展到右侧可用视口，保留侧栏、关闭入口与窄屏布局。

## 成功条件

- 四个场景标签可键盘切换；选择光影或镜头不会丢失 Image Reference 与 Video Reference 的未提交提示词。
- 无场景图片时生成按钮禁用；有图片时提交明确的来源变体并使用参考图模式。
- 两个任务的参数状态相互独立；场景描述和角色身份版本不被写入。
- 通过前端类型检查和角色工作台定向 UI 测试。

## 影响路径与验证

- `frontend/src/components/modules/CharacterWorkbench.tsx`
- `frontend/src/components/modules/ConsistencyVault.tsx`
- `frontend/src/components/modules/SceneImageTools.tsx`
- `cd frontend && npm run typecheck && npm run test:ui -- src/components/modules/CharacterWorkbench.test.tsx`
