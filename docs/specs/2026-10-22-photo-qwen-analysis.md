# 照片 Qwen 内容分析切片

用户授权使用 Qwen 分析已上传照片，并指定其作为照片/视频分析 LLM。本切片先接现有静态图片入口；视频上传、抽帧、音轨、时序引用另做切片，不能把图片调用通过当作视频验证。

成功条件：选中照片后显式同意发送去 EXIF 的缩略图至配置的 Qwen 渠道；返回并持久化可见内容、可见文字、不确定项和温和的讲述问题；刷新能重新读取；跨 owner 不可读取或触发调用；不修改照片日期/身份/记忆。模型结果均为待核对描述，不是确认事实。模型输出受服务端 JSON 字段/长度校验，图片中的指令不是系统指令；不提供自由模型名或任意远程 URL 输入。首次失败可显式重试，不静默换模型或渠道。

同步 Demo：`POST /photos/{id}/analysis` 要求 `allow_external_analysis=true`，声明只用于当前照片；先读取 owner 范围缩略图再调用。现有 time consent 只允许本地 EXIF，不可复用为外部内容分析授权。POST 每次均为显式操作；已有结果返回已有版本，避免反复点击重复计费。本切片不提供重跑或照片事实确认接口。`GET /photos/{id}/analysis` 返回当前结果或 null，不触发模型。保存 owner/photo/actor/provider/model/prompt_version/image_sha256/created_at 与结果；保存的外发许可只对应本次请求，不代表持续授权。模型失败不产生成功结果或改写旧结果。

渠道由部署配置 `IFRAME_PHOTOS_QWEN_BASE_URL`、`IFRAME_PHOTOS_QWEN_API_KEY`、`IFRAME_PHOTOS_QWEN_MODEL` 显式提供，缺失返回 503。使用现有 OpenAI-compatible chat/completions 的 image_url data URI；模型仅允许 qwen 前缀。不用未经验证的严格 JSON Schema 选项，提示 JSON 后 Pydantic 校验。当前真实渠道 image/JSON 能力仍待运行验证。

2026-10-22 渠道修正（用户同意）：以上独立 Key 配置被当前用户 UniArt 配置替代。分析入口在读取照片归属后，把 require_user_context 的同一个 UserContext 传给既有 UserConfigStore.get_runtime_uniart；不枚举其他用户、不使用共享环境 Key、不接受客户端指定 owner/渠道。配置库以只读方式打开，测试容器只挂载现有用户配置库文件，不复制 Key 或生产照片库。模型由 IFRAME_PHOTOS_QWEN_MODEL 配置，默认沿用现有候选 qwen3.8-flash；候选名不等于真实图片能力证明。缺少个人配置返回 409 并提示先在创作台配置，远端 401/403 单独提示渠道拒绝，不伪装成看不清照片。Demo 与正式站同源，复用现有 API-key 指纹 localStorage；无指纹时仍保留独立 Demo 浏览器身份，不自动迁移照片 owner。需要验证已上传照片所属身份和配置是否一致。

影响：`src/apps/photos/analysis.py`、日期仓储新增独立分析表、照片 API、photoApi 与 PhotoAlbum UI；原日期表及规则不变。测试包括 owner/披露门禁、无配置失败、严格输出校验、服务失败零写入、保存重读/重复请求、日期不变与 UI 明确授权。命令：照片 pytest 定向集、照片 UI 测试、typecheck、build、独立 demo 浏览器与真实模型样本验证（依赖有效渠道凭据）。用户已上传照片的单次试验另行使用可信运维入口，不能据此开放跨 owner HTTP 查询。

验证结果：99 项照片后端测试、16 项照片界面测试、前端类型检查与独立目录静态构建通过。共享 UniArt 渠道的 models 查询和 qwen3.8-flash 文本探针均返回 401；未把用户照片发送至该无效渠道，未取得真实图片分析结果。DashScope Key 在主机现有运行环境中为空。已向用户询问使用当前用户 UniArt 配置或单独 DashScope 渠道；不读取其他用户加密配置来替代凭据。视频能力仍未接入或验证。

限制：已保存结果的顺序重复请求复用结果；当前同步实现没有跨进程调用租约，两个并发首请求仍可能重复调用外部模型（最终只保留首个结果）。不得宣称全局至多一次计费。模型指令和 JSON 字段校验不能证明生成描述无幻觉，UI 始终显示待核对。本轮尚无照片删除/分析撤回或编辑确认接口。

渠道修正验证：103 项后端测试（含只读配置、个人渠道选择、禁止共享 Key 回退、跨 owner 无调用、缺失库不创建、远端鉴权错误分类）、16 项界面测试、类型检查与独立目录静态构建通过。运行观察：已上传照片所属 API-key 工作区与个人配置一致；独立容器以只读单文件挂载创作台配置库，通过真实 HTTP POST 使用该照片 owner 的配置调用 qwen3.8-flash 成功，返回通过字段校验的观察并持久化；GET 重读一致，日期快照保持不变。该验证只覆盖一张授权照片，不证明总体描述正确率或视频能力。未输出/复制个人密钥，不修改创作台配置；运维验证仅定位这张照片后使用其 owner，普通 HTTP 仍受 require_user_context 与照片归属检查约束。
