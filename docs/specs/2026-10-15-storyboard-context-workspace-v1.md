# 分镜分析与渲染的项目资产工作域

状态：代码与本地验证完成，待管理员审核；独立于 PR #121 的抽屉与 R2V 引用索引修复。

依据：`2026-09-24-asset-material-workspace-index-v1.md`、`2026-10-08-series-style-director-inheritance-v1.md`、`2026-10-10-script-plan-asset-material-identity-v1.md`。

## 问题与边界

代码事实：`storyboard_analysis_context` 使用 `resolve_episode_assets`，后者默认包含所有全局共享候选。分镜细化和图片预览/渲染也复用该解析器。候选可见性不能建立项目成员关系。

本轮只调整分镜生产的实体解析：本集/项目数组 + 所属系列资产，本地同类型同 ID 优先；未导入的全局候选不进入分析、细化、名称绑定或图片渲染上下文。项目数组中显式导入的副本继续有效。系列继承仍按既有合同，不据此推定所有继承角色都在当前镜头出场。

保留宽解析器的默认行为供候选、共享库和其他尚未逐项迁移的入口使用。提供显式项目解析入口；不改写历史帧、计划或全局成员，不自动导入。旧帧若仅指向未导入全局资产，本轮不再注入该候选的描述；不声称已经完成全部遗留引用的拒绝/迁移。

## 影响路径与验收

- `pipeline.py`：分镜分析、分析结果绑定、镜头细化、批量首帧、首帧预览/指纹/生成。
- `tests/test_storyboard_asset_workspace.py`：直接构造无 I/O pipeline，捕获消费方输入，复现宽池泄漏。
- 测试独立项目、系列项目、本地同 ID 优先、同名不同 ID、显式导入、旧全局引用、其他系列隔离，以及宽候选解析兼容。
- 运行 `python3 -m pytest -q tests/test_storyboard_asset_workspace.py tests/test_director_profile.py tests/test_director_shooting_plan.py tests/test_storyboard_render_preview_api.py`，再运行默认后端 CI 对应测试。

不包含工作台风格/光线正文同步、统一来源快照、计划资产迁移、模型继承设置、付费 provider 验收或部署。

## 验证结果

修复前先复现分析/细化/批量渲染的全局候选泄漏。修复后新增工作域测试 11 项通过；连同导演、计划、分镜任务和预览共 161 项通过；旧宽解析器的兼容测试 3 项通过。

后端 CI 同等默认范围（排除 recreation/reference_files 专用模块及 2 项本地 Blender 环境用例）：1186 passed、5 skipped、2 deselected。新测试位于默认 `tests/` 下，会进入后端 CI。未调用真实 provider 或修改生产数据。
