# iFrame 主机配置来源核查（2026-10-05）

范围：`iframe` SSH 主机上的 iFrame 后端容器。本文只记录配置来源和部署边界，不记录环境变量值或密钥。

## Observed（运行观察与代码事实）

- 当前后端为 `iframe-backend:git-f28e2c8d47b5`。容器仅将宿主机 `/srv/lumenx/output` 挂到 `/app/output`；没有配置文件挂载，也没有 Docker Compose 项目标签。
- 容器内 `get_user_config_path()` 返回 `/app/.env`，该文件不存在。容器创建配置中存在应用环境变量，例如 DashScope、OpenAI、OSS 相关变量；本次只核对变量名，没有读取变量值。
- 仓库的 `docker-compose.yml` 声明 `env_file: .env`，但主机 `/srv/lumenx/repo/.env` 不存在。当前前端容器名也与该 Compose 文件声明的名称不同。因此该文件只能说明仓库预设，不能证明当前服务由 Compose 创建。
- 后端启动代码只在项目根 `.env` 存在时调用 `load_dotenv(..., override=True)`；否则读取进程环境。打包模式才使用用户目录 `config.json`。当前容器返回的路径是 `/app/.env`，不处于该打包配置路径。
- `POST /config/env` 需要 `LUMENX_ENABLE_ADMIN_ENV_CONFIG=true` 和管理 token。当前容器创建配置中没有这两个变量名，因此按现有代码，此写入入口不能用于当前服务配置。
- 主机上的 `deploy-iframe-80dcbbb9-v2.sh` 和 `deploy-iframe-assets-05fe52ea.sh` 均创建临时 env 文件，从已有 `iframe-backend` 的 Docker `Config.Env` 导出环境，再通过 `docker create --env-file` 注入新容器；脚本退出时删除临时文件。主机还保留多代 `iframe-backend-before-*` 容器。

## Direct implication（直接推论）

当前部署的可核实配置载体是后端容器的创建环境。仓库中的 `.env.example` 只是模板；缺失的 `.env` 不是当前运行所依赖的文件。已检查到的部署脚本把旧容器作为新容器配置的接力来源，因此连续部署可以保留变量，但这一做法依赖旧容器仍可检查。仅重启现有容器通常沿用其创建配置；从镜像重新创建容器时，需要重新注入环境。

## Not yet proven（尚未证实）

- 当前 `f28e2c8d47b5` 容器究竟由哪条命令或哪份脚本创建。Docker 元数据不记录原始 `--env-file` 路径。
- 最初的环境变量来自哪个文件、命令或管理系统。不能把历史部署脚本的接力方式当作最初来源。
- `/srv/lumenx/user-data` 与 `/srv/lumenx/secrets` 的完整文件清单：普通 SSH 用户对这些目录的 `find` 访问受限。本次未据此推断其中不存在其他文件。
- 应用运行过程中是否有其他进程内环境变更；容器 `Config.Env` 表示创建时配置，而非每一时刻的进程内状态。

## 恢复与改进边界

首次核查时，旧容器及其 Docker 元数据是可用于核对变量名和恢复创建环境的副本，但不宜长期充当唯一配置源。若清理旧容器或迁移主机，在没有受控配置源的情况下，仅凭 Git 仓库和镜像不能保证重建同样的服务。部署应显式从受权限保护的持久配置源注入，并在部署前校验必要变量名、镜像修订和目标容器；不得把密钥写入仓库、报告或部署日志。首次核查没有修改主机配置或部署流程；后续操作见下节。

## 后续规范化记录

同日已将当前容器的应用环境一次性迁入 `/srv/lumenx/runtime/iframe-backend.env`，目录权限 `0700`、文件权限 `0600`，均由部署账号持有。迁移去除了与镜像默认环境完全一致的项，留下 23 个变量；只输出布尔结果的比对显示持久文件与当前容器的应用变量名和值一致。Docker `--env-file` 解析测试通过。当前运行容器没有重启或替换；新配置源将在下一次使用更新后的通用发布脚本时生效。此前“没有持久配置源”的观察仅描述迁移前状态。

## 核查位置

- 代码：`src/apps/comic_gen/api.py` 的启动 dotenv 加载、`get_user_config_path()`、`POST /config/env`；仓库 `docker-compose.yml`。
- 主机：`docker inspect iframe-backend` 的镜像、标签、挂载和环境变量名；容器内配置路径存在性；`/srv/lumenx/repo/.env` 存在性；上述两份部署脚本的环境接力命令。
