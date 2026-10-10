# Avatar 数字人脸特征库 V1

状态：文字特征候选与编辑入口。日期：2026-10-11。

## Observed

- Avatar 已保存人物文字设计草稿、确认设计和历史 revision；身份字段位于 `character_design.design_draft.identity`。
- 原有 facet catalog 是生成约束，例如“保持一致”，不是某个人物的具体外貌值。
- 图片、候选和媒体版本由 iFrame 素材库管理，Avatar 当前不保存这些对象。

## 范围与假设

- 在独立数字分身页提供按脸型、眼、眉、鼻、唇、面部标记、肤色、发型、体态等字段分组的具体文字候选。
- 候选是用户可选的编辑辅助，不表示从照片识别或由模型推断得到。用户点击后写入当前草稿字段，标记 `basis=user_specified`；仍需显式保存或确认。
- 每个字段保留自由编辑，候选仅替换该字段，不覆盖其他字段、已确认版本或历史快照。
- 不新增媒体存储、参考图分析、图像候选生成或项目采用绑定。

## 验收

- 眼、眉、鼻、唇及面部标记可分别选择、手工修改并随现有设计保存。
- 点击候选不会调用人物创建、保存、确认或素材库写入接口。
- 历史设计仍只读；旧数据缺少新字段时正常显示。

## 验证命令

`cd frontend && npm run typecheck && npm run test:ui -- src/components/avatar/AvatarWorkbench.test.tsx`

`pytest -q tests/test_avatar_service.py`
