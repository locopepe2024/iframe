# 基础参考库导入与结构化变体 V1

## Observed

- 全局资产库已经支持角色、场景、道具三类资产，以及单张首图上传和项目/系列资产提升到全局库。
- `AssetReferenceIndex` 已向角色工作台和分镜参考选择器提供稳定的 `asset_id + variant_id`。
- `ImageVariant` 已有 `reference_view_role`、`reference_distance`、来源和生成 lineage 字段，但全局资产新建入口只写入一张未标职责的图片。

## Direct implication

基础参考库导入应把“一个资产”和“该资产的多张参考变体”作为一次操作保存。每个变体保留稳定 `variant_id`、参考职责、来源和审核前状态；不能把四张参考图拆成四个同名资产。

本切片只负责导入底座参考，不创建分集造型、场景状态或镜头表演。下游仍通过稳定引用读取变体。

## Scope

- 全局角色、场景、道具创建支持一组初始图片变体。
- 每个变体可声明 `reference_view_role` 与 `reference_distance`。
- 保留现有单图创建和项目/系列提升兼容行为。
- 导入结果在资产库和 `AssetReferenceIndex` 中可见，引用仍使用 `asset_id + variant_id`。

## Not yet proven

- 仅有多视图底座不能证明生成模型会保持人物身份或场景结构；需要后续对比生成验证。
- Avatar 的权威身份 revision 与全局资产库的底座变体尚未完成服务级绑定。

## Success criteria

1. 创建一个带多张参考图的角色，只产生一个资产 ID，变体 ID 各不相同且职责可读。
2. 场景和道具也能复用相同导入契约。
3. 旧的单图创建请求和已有资产读取测试继续通过。
4. 角色工作台参考选择器可以看到变体职责，不读取临时 URL 作为持久化引用。
