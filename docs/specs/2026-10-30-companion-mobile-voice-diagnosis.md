# 移动端只有文字、没有语音：诊断记录

## 运行观察

2026-10-30 UTC 06:22—06:33，OpenTalking 日志多次出现创建会话、start、ice-config，随后删除会话；这些新会话未见 offer 或 speak。此前会话在 UTC 05:57—06:05 有 speak 200。不能把模型要求检查声音设置的文字视为设备故障证据。

线上 ICE 配置为 relay，提供 Cloudflare STUN 与本站 TURN TCP/UDP。TURN 当前 user-quota=8、total-quota=8。使用同一配置的本地 Chrome 候选收集诊断出现 486 TURN allocate error，也获得 relay 候选并达到 complete。去掉独立 STUN 后仍出现486，因此单独删除STUN不是已验证修复。

## 代码事实

OpenTalkingReply 先等待 ICE complete，再发送 offer；等待上限30秒。组件销毁、voice或connectionEpoch改变会销毁连接。底部启动录音会增加connectionEpoch。AgentChat在录音状态结束时增加speechEpoch；如果请求尚未返回，回复可能因epoch不一致而被跳过，即使持久语音偏好仍是audio。

## 未证明

不能把观察到的会话准确关联到用户某一轮移动端操作。尚无该手机的ICE状态、候选错误和录音状态转换时间线。TURN486是已复现的问题，但尚未证明是无声的唯一原因。30秒后的会话没有offer，与ICE收集阶段失败相符，但不能排除销毁或其他客户端错误。

## 下一步验证

1. 对单个移动会话记录开始、ICE状态、候选类型/错误、offer发送、连接销毁原因、speak发送和播放结果；不记录用户音频或凭据。
2. 复现录音结束先于文本回复时是否被speechEpoch过滤，分别验证用户明确停止与意外断开。
3. 明确每个会话中继分配数量及遗留分配后，再决定TURN配额或连接生命周期修复。

本次仅只读诊断线上服务；未修改TURN配额、未重启、未部署。临时ICE凭据已删除。
