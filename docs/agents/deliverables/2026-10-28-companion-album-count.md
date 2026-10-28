# 相册总数查询闭环

代码事实：工具集中没有总数统计；未限定范围的 photo.album.list 会被后端转换为整理引导。尚未取得本次实际模型工具选择，不能据此断言线上完整因果链。

本次边界：由 Qwen 理解数量问题，调用独立只读 photo.album.count；不增加中文关键词路由。统计当前身份的完整相册，排除已删除照片，不使用分页数量或模型估计。此工具只支持全相册总数，不接受人物、日期等筛选；这些范围统计后续扩展。

结果：直接展示并朗读真实数量，不打开相册或创建整理任务。保存本轮统计快照，历史消息保留当时数量；再次询问重新查询。前端沿用 text 结果及 OpenTalking 播放路径。

验证：超过 12 张的全库统计、隔离其他用户、排除删除、空相册、只读、严格参数、历史快照及新查询、原始三种语音转写不被确定性路由拦截。模型请求携带统计工具，实际语义选择另作渠道验证。

涉及 photos/workflow.py、companion_runtime/{tools,photo_tools,chat_store,api,model}.py 及对应测试。运行 `.venv/bin/python -m pytest tests/test_companion_photo_tools.py tests/test_companion_chat.py`。
