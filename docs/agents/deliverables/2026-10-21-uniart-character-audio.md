# 角色音色切换到 UniArt

运行证据：个人设置保存 UniArt 网关凭据；旧试听读取全局 DashScope 环境变量，线上缺失，WebSocket 返回 401 后 SDK 误报超时。用户授权统一走 UniArt。

只读实时目录（当前系列所有者）提供 `speech-2.8-hd`、`speech-2.8-turbo`，均标注 `audio-speech`。UniArt MiniMax 适配器已有 `/v1/audio/speech`，接收 OpenAI 形状 `model/input/voice/response_format/speed`，通过 metadata.voice_setting 传递音量和音调。MiniMax 官方文档已核对：2026-10-21，https://platform.minimaxi.com/docs/api-reference/speech-t2a-http 与 https://platform.minimaxi.com/docs/faq/system-voice-id 。

边界：新增无凭据状态的 UniArt TTS 适配器，每次调用解析当前用户配置；不修改进程环境，不回退 DashScope。系统音色以网关当前可用模型与已核对 MiniMax 音色组成，绑定中包含模型。旧绑定不猜测映射，提示重新选择。试听缓存在所属用户 audio 目录内，缓存身份包含网关地址、模型、音色和参数；音频原子写入，失败不缓存。对白复用同一适配器。

网关尚无已验证的复刻/设计管理协议，停用新建入口及旧直连接口，不删除历史记录。旧自定义音色不自动迁移。任意自由文本情绪不冒充 MiniMax 已支持参数，仅将明确支持的情绪映射到枚举。

验证：请求使用所属用户密钥且用户间隔离；目录按权限筛选模型；旧音色与不支持的模型拒绝；错误与空响应不落盘；缓存按所有者隔离；UI 显示网关模型并提示旧绑定；单条及批量对白共用网关路径。真实验收只使用最短自有试听文本，不自动更换用户绑定。

参数定义：复用现有语速 0.5–2；现有音调倍率换算为 `round(12*log2(rate))` 半音（-12 至 12，1 为原音）；音量 1–100 映射 `vol=volume/50`（50 对应官方默认 1.0）。官方 vol 范围 `(0,10]`、pitch 范围 `[-12,12]`。仅接受明确的 happy/sad/angry/fearful/disgusted/surprised/calm 及中文同义情绪；拒绝不支持的自由演绎指令，不静默丢弃。不同用户不共享缓存，命中缓存前仍验证当下模型权限。

官方音色子集：male-qn-qingse（青涩青年）、male-qn-jingying（精英青年）、male-qn-badao（霸道青年）、male-qn-daxuesheng（青年大学生）、female-shaonv（少女）、female-yujie（御姐）、female-chengshu（成熟女性）、female-tianmei（甜美女性）。每个当前允许模型提供八个音色；绑定格式 `uniart:<model>:<voice>`。

真实运行验收：2026-10-21，以现有系列所属用户凭据在服务器独立 Python 进程加载候选适配器，生成自有文本“你好，这是音色试听。”。返回 42036 字节 MP3，ffprobe 识别 MP3、时长 2.52 秒；第二次请求命中所属用户缓存。未修改角色绑定。此证据证明网关可返回可解码音频，不代替主观听感评估。原始厂商资料只在本地临时目录核对，尚未同步共享原始文档库 / Context Hub。

批量对白：原实现只在抛异常时累计失败，AudioGenerator 捕获错误并写入 FAILED 状态会被误报成功。新增失败重现测试并以返回帧状态、audio_url、audio_error 共同判定生成成功。
