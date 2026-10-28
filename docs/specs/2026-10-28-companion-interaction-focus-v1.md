# 共同任务焦点第一阶段

目标：用显式会话焦点替代“最新照片任务就是当前任务”的推断。先实现后端可验证协议，再接前端编辑器。

会话焦点按 owner/actor/session 隔离。包含 kind(chat/photo/diary)、object_id（照片ID或日记日期）、phase(viewing/editing/listening/paused)、draft（最多12000字）、revision。草稿是未确认输入，不进入记忆、照片事实或日记保存表。焦点更新须 expected_revision 和 operation_id；重复请求返回原结果，旧版本拒绝。照片引用必须属于当前用户；日记日期校验。

每次聊天 claim 在事务内绑定焦点快照。失败重试仍使用原快照，不因后来切换页面而改变含义。Qwen 收到该快照及已有对话上下文；处于 photo/diary 的 editing/listening/paused 时跳过关键词快捷路由与额外协调器，让主模型解释用户原话。工具提议不得绕过资料保存确认。

该阶段不让模型自动改变焦点，不按“停止”等孤立关键词自动保存。前端未发送明确焦点时保持原路径。第二阶段前端需在打开/编辑/收音/暂停时同步，切换时明确处理草稿；不能宣称第一阶段已经修复线上语音误路由。

涉及 store.py、chat_store.py、api.py、personality.py、新 interaction_focus.py 与行为测试。验收覆盖隔离、照片归属、日期、版本冲突、重试绑定、编辑叙事不走上传快捷路由、无焦点兼容。
