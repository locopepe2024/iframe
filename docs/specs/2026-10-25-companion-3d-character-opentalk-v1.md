# 陪伴助手 3D 角色与 OpenTalk 适配边界 v1

## 当前事实

- 现有 AvatarWorkbench 已有结构化 `CharacterDesign`、草稿/确认版本和版本历史。
- 当前陪伴设置保存名字、预设头像、TTS voice；头像不是 3D 资产，voice 只绑定 UniArt TTS allowlist。
- 当前 Companion 使用文本聊天、浏览器 SpeechRecognition 听写和独立日记编辑器；实时对讲已暂停。
- OpenTalk 的具体 SDK、信令、音频/视频输入输出契约本轮尚未验证，因此不能把其协议字段写进核心模型。

## 目标

让用户可以把陪伴助手塑造成一个有名字、外观和声音的角色；后续将该角色作为 OpenTalk 的 avatar/agent identity 输入。角色外观和聊天身份必须独立于会话、日记和模型渠道。

## 角色资产分层

```text
CompanionIdentity
  name
  personality_profile
  voice_profile { provider, voice_id, language }
  visual_profile { poster_url, avatar_url, character_id }

CompanionCharacterAsset
  character_id
  design_revision
  design_draft (现有 CharacterDesign)
  poster_media_id       # 2D 预览/封面
  model_3d_url           # glTF/GLB/VRM，后续接入
  model_format
  rig_profile            # facial blendshape / body rig / viseme mapping
  animation_profile     # idle / listen / speak / wave
  review_status
  revision_history
```

`CompanionIdentity` 只引用当前确认的角色资产，不把模型文件、TTS 密钥或 OpenTalk session 写进聊天消息。未生成 3D 模型时，使用 poster/avatar 作为降级展示；不能声称已经支持 3D 驱动。

## Demo 交互

“更多 → 陪伴助手设置”增加“设计形象”：

1. 名字和陪伴风格；
2. 外观描述（年龄感、发型、服装、色彩、气质）；
3. 生成角色预览（先生成 2D 海报和结构化设计草稿）；
4. 用户确认后设为当前助手形象；
5. 3D 模型栏显示“准备接入”，不伪造可用模型；已有 3D URL 才显示 3D 预览。

移动端聊天只展示头像、名字和状态；设置、预览、版本回退放在独立卡片中。语音日记不需要 3D 角色加载，避免角色资源失败阻塞记录。

## OpenTalk 适配边界（待验证）

定义内部适配接口而非直接依赖第三方：

- `connect(identity, mediaPolicy)`
- `setAvatar(asset)`
- `setVoice(voiceProfile)`
- `sendText(text)`
- `sendAudio(stream)`
- `onTranscript`
- `onAssistantAudio`
- `onAvatarState(listening|thinking|speaking|idle)`
- `disconnect()`

OpenTalk 的 SDK/协议映射、是否支持 VRM/GLB、viseme 格式、鉴权和 WebRTC 生命周期必须在获得官方资料或测试环境后单独验证；在此之前不改 realtime 路由。

## 成功标准

- 当前聊天、朗读、语音日记在没有 3D 模型时完全可用。
- 角色名字、海报、voice profile 可恢复且有版本边界。
- 生成中的角色不会自动替换当前角色，必须明确确认。
- OpenTalk 未接入时，不出现“已连接视频陪伴”的假状态。
- 3D 资产加载失败只降级为 2D 海报并提示，不阻塞聊天/日记。
