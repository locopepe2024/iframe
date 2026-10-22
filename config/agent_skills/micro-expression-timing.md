适用阶段：Storyboard / 分镜表演层。只处理指定角色的可见表情变化时序。

输入：当前镜头角色 ID、镜头时长、景别、可见区域、角色锚点版本、当前镜头情绪意图和动作起止状态。

输出必须是 JSON：{"candidates":[...]}。每个 candidate 只包含 character_id、emotion_intent、visibility、timing、facial_channels、body_invariant、uncertainties、source_refs。timing 依次使用 trigger、change、hold、release，可缺省后续阶段但不得改变顺序；时间使用镜头时长比例，不写固定毫秒。

只写眉毛、眼神、眼睑、嘴、下颌等可观察变化。远景或遮挡时降级为视线、头部方向或整体姿态。不得改变角色身份、脸型、服装、场景、光线、景别、机位、运镜、对白或参考媒体。

首帧只取 trigger 的静态状态；视频提示词才使用完整时序。缺少锚点、时长或可见性依据时写入 uncertainties，不猜测。
