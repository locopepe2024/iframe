# 照片整理入口与组合搜索部署验证

部署提交：6bc14862（上传后三选一）、75280630（组合搜索）。用户授权部署到既有 Companion 测试站；未推送或合并。

前端从 HEAD 的 frontend 隔离归档构建，排除工作区未提交修改。依赖软链接导致 CopilotKit CSS alias 未命中，首次构建失败；仅在临时构建配置添加 realpath alias 后静态导出成功。先同步 _next 资源且不删除旧资源，再替换实际入口 web/companion/agent.html。

后端核对远端差异后仅替换 photos/workflow.py 和 companion_runtime/tools.py，重启 iframe-companion-demo。备份：/srv/lumenx/companion-demo/backups/before-photo-75280630/。回滚恢复该目录 agent.html、workflow.py、tools.py 到原路径并重启容器。相册数据与模型配置未改。

运行观察：公网 /companion-demo/companion/agent HTML SHA256 与本地导出一致，为 29f8243b045e351fd1800a3567964bc5d6670013aa5c29a250d86a4225bb43c3；11 个 script URL 全部 200；health 返回 ok。health 的 source_revision 仍为旧 wrapper 标记 71d7a5d0，不能用于证明本次文件版本。

容器内使用临时独立数据库、实际已部署 dispatch 验证：女儿/海边/退休跨资料与故事组合命中，年份筛选、其他用户隔离、无匹配条件返回空、JSON 字段名不被匹配，全部通过。临时数据自动清理，不修改已有相册。

此前本地验证：7 项整理入口/上传组件测试、类型检查及18项后端测试通过。本次未做浏览器交互自动化或自然麦克风测试；HTTP资源与后端工具验证不能证明浏览器交互、模型条件提取或语音识别准确率。用户下一步可上传照片、手动保存地点/人物/时间，再分别用文字和自然语音搜索相同条件。
