# iFrame 场景设计光影与镜头任务 V1

日期：2026-10-17。状态：实施规格。

## Observed

- iyishow 图片容器的光影面板提供亮度、主光颜色与方向、轮廓光和风格预设；镜头面板提供视角预设、水平环绕、俯仰、景别与对焦参数。参数被投影为生成提示词。
- iFrame 场景素材工作台已有 Image Reference、Video Reference 两个任务，按稳定 `asset_id + variant_id` 引用素材生成候选。
- 初版光影和镜头仅在浏览器拼接提示词，任务与结果没有工具参数快照或来源变体锚点，且普通场景生成会自动选中新图。
- 当前角色工作台与场景素材弹层都有桌面最大宽度限制，宽屏时不能铺满右侧浏览区域。

## 范围与边界

- 本工具是已有场景图片变体的派生编辑。首次场景参考图的风格、环境光、局部光和视角设计由 `scene.asset_design` 的独立草稿/确认修订管理；派生工具不修改该修订，也不把一张候选图的参数推广为整个场景默认值。
- 图片上的对焦点使用实际显示图片区域的归一化坐标。预览容器因 `object-contain` 产生的留白不计入坐标；横纵坐标与影响半径作为结构化参数写入任务和候选来源记录。
- 工具先展示由参数编译出的完整文本，再进入统一图片生成预览。最终预览显示模型、画幅、负面提示词、来源变体和工具参数；确认指纹绑定工具参数与有序参考图身份。执行端重新校验编译文本及来源，不在用户确认后追加隐藏风格文字。

- 在场景素材现有 Image Reference、Video Reference 同一级新增“光影”和“镜头”标签。两者从当前场景已经保存的图片变体中显式选择来源。
- 保留 iyishow 的参数和预设语义。前端提交结构化参数；后端校验并编译图片编辑提示词，使用现有参考图模型路径生成；任务参数和输出候选都保留工具信息。
- 光影支持主光六方向、颜色、亮度、轮廓光、正面/透视观察、智能模式、八个预设及从可引用素材选择的附加光影参考图；镜头支持七个视角预设、水平/垂直角度、景别、可拖动对焦点与半径、补充提示词开关。两者显示随参数变化的示意图；示意图不是模型输出预览。
- iyishow 的派生节点映射为场景素材库的派生候选，保存来源变体 ID；工具结果不会自动成为选中主图。附加光影参考图可从素材库选取，或上传到素材库成为独立资产后以稳定 ID 引用。
- 来源图缺失时不提交；提交时带来源 `asset_type=scene`、`asset_id`、`variant_id` 和 `image_generation_mode=reference`。
- 光影只要求改变受光关系；镜头只要求改变观察视角。两者都要求保持场景结构和主体连续，不修改场景描述。
- 角色工作台及场景素材弹层扩展到右侧可用视口，保留侧栏、关闭入口与窄屏布局。

## 成功条件

- 四个场景标签可键盘切换；选择光影或镜头不会丢失 Image Reference 与 Video Reference 的未提交提示词。
- 无场景图片时生成按钮禁用；有图片时提交明确的来源变体并使用参考图模式。
- 两个任务的参数状态相互独立；场景描述和角色身份版本不被写入。
- 服务端拒绝非法参数、非场景来源、跨 owner/失效变体及错误引用顺序；执行时重新解析来源。任务快照、结果候选保留结构化参数和来源；结果作为候选显示，不改主图选择。
- 通过前端类型检查和角色工作台定向 UI 测试。

## 影响路径与验证

- `frontend/src/components/modules/CharacterWorkbench.tsx`
- `frontend/src/components/modules/ConsistencyVault.tsx`
- `frontend/src/components/modules/SceneImageTools.tsx`
- `frontend/src/lib/api.ts`、`src/apps/comic_gen/api.py`、`src/apps/comic_gen/pipeline.py`、`src/apps/comic_gen/assets.py`、`src/apps/comic_gen/models.py`、`src/apps/comic_gen/scene_image_tools.py`
- `cd frontend && npm run typecheck && npm run test:ui -- src/components/modules/CharacterWorkbench.test.tsx`
- `python3 -m pytest tests/test_scene_image_tools.py -q`
