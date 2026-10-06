# iFrame 生产配置唯一来源与升级入口 v1

## 观察与目标

2026-10-06 已确认 /srv/lumenx/runtime/iframe-backend.env 存在，文件权限 600，目录权限 700，包含签名配置。旧发布脚本仍从旧容器 Config.Env 生成临时文件；Compose 引用仓库 .env。生产未安装 docker compose。

统一后的生产配置来源固定为 /srv/lumenx/runtime/iframe-backend.env。唯一生产升级入口是 scripts/deploy_server_release.py。配置目录位于代码仓库外，不纳入 Git、镜像或 release archive。

## 边界

- 发布前验证正式文件存在、普通文件且非符号链接、当前用户拥有、目录和文件无组/其他用户权限。
- 文件使用 UTF-8 单行 KEY=VALUE，无 export、重复键、裸键或自动宿主变量继承。
- 为使 Docker --env-file 与 Compose 简单 env_file 语义一致，禁止值中引号、美元符号、反斜杠，以及空白后 # 注释；值内部普通 # 和等号可保留。若现有值不符合，停止发布并由管理员按真实语义处理，不自动修改密钥。
- 必须存在非空 LUMENX_MEDIA_SIGNING_KEY 或 LUMENX_CONFIG_MASTER_KEY；发布不再生成或轮换签名密钥。
- 缺失/无效就拒绝发布；无旧容器环境回退、无仓库 .env 回退、无临时 env 文件。
- 保留旧容器仅用于拓扑查询和回滚，不把 Config.Env 当配置来源。
- Compose 指向同一个固定文件，删除额外 environment 覆盖；不作为生产升级入口。生产变更经正式发布脚本的维护/备份/回滚/验收流程。
- 历史宿主一次性 deploy 脚本废止为生产入口。管理员切换完成后移至非可执行 archive，不能再调用；本次不修改生产主机或部署。

## 验收与命令

```bash
python3 scripts/production_runtime_config.py
python3 scripts/deploy_server_release.py
```

验证命令仅报告路径和通过状态，不输出值。文件修改后，管理员通过正式发布入口重建容器使配置生效；docker restart 不重新读取 env 文件。回滚恢复旧容器及旧配置，后续新发布仍以正式文件为准。

测试覆盖缺失文件、权限错误、符号链接、重复键、格式差异、非空签名配置和生产入口代码不再读取旧环境。不发起部署。发布记录只保存配置路径，不保存配置值或 docker inspect 原文。

## 验证结果

17 个配置及签名相关测试通过，Python 编译与 diff 检查通过。在生产主机仅运行只读校验器，正式配置文件通过新规范；未修改配置或运行发布。完整 release gates 中其他待实现事项不因本改动而自动通过，管理员需独立确认。
