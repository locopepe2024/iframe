# Qwen视觉复核首次调用

## Observed

范围：同源第46–59帧（25fps），先盲看源片，再用最新白模第49帧对照；不提供“行走/踢腿”结论或人工标签，避免诱导。拟输出动作候选、支撑脚、接触类型、遮挡与不确定区间，均不自动写入正式标注。

通过项目已配置UniArt通道查询模型列表，唯一非语音Qwen型号为qwen3.8-flash。模型列表仅证明通道提供该名称，不证明支持视觉。

实测：
- sandbox多图请求APIConnectionError（4.15s），保留v1。
- 经批准网络请求，14张960×520图源片调用APIConnectionError（64.72s），保留v2。
- 独立短文本请求“仅回复OK”成功返回OK，返回model=qwen3.8-flash。
- 缩小为一张1440×1420时间序列图，每格480×260加帧号，仍APIConnectionError（61.27s），保留v3。
- 所有视觉调用均未返回内容；未执行候选对照阶段。没有Qwen动作判断结果，也没有视觉准确率证据。原始多图失败不能单独归因为负载大小，缩图同样失败。

脚本：docs/agents/tools/addams_qwen_review.py；manifest含源哈希、帧号/PTS、图像哈希与提交分辨率。prompt与错误类型/耗时均保存，无密钥或base64图像请求转储。错误重跑须新目录，防止覆盖。后续版本对调用失败返回非零退出码。

## Direct implication

通道文本可调用，但当前视觉路径未跑通。需要核对该SKU的视觉输入支持、网关转发与超时，或配置明确支持图片的Qwen视觉端点；不能用文本OK当作视觉成功。

## Not yet proven

没有证据说明模型是否识别正确；没有证据将失败归因于模型、网关、网络中的某一层。不因连接失败而改写用户的动作判断。现有人工标注与骨架未改动。

## What would verify it

先用一张小图验证视觉能力，再运行准备好的连续片段盲测及候选对照；保留实际返回型号与内容。连续图复核不是原生视频输入，不应声称检验了完整视频理解。

## 推理环境核查更正

本轮实际SSH确认media的/home/ubuntu/gvhmr-cpu-venv及gvhmr-cpu-validation仍在；import torch,smplx成功，torch=2.3.0+cpu，CUDA=False，已授权SMPLX_NEUTRAL.npz文件仍在。此前rotation-pipeline-audit仅检查/opt/motion-pose-venv，据此推断必须等待CUDA和资产不完整。应改为：没有可见CUDA，但有旧CPU适配环境与合法模型资产，可先核查并复用旧实验；CPU执行并不等于与GPU后端数值/速度等价或动作通过。

## 后续返回链路核对（v4）

用户观察UniArt显示成功后，加入流式接收、客户端请求UUID、开始UTC及响应时间记录。相同时间序列图源片请求成功：headers 41.66s、first chunk 41.68s、完整返回87.64s，finish_reason=stop，model=qwen3.8-flash；原始流块和内容保存在addams-qwen-review-v4。源JSON解析通过。由此更正：视觉通道可以返回内容，之前客户端连接异常不代表上游模型处理失败。

候选对照流式请求仍在61.45s失败，异常因果类型为APIConnectionError→RemoteProtocolError→RemoteProtocolError，没有收到响应头；没有完整对照结果。首字节等待时间受到中间链路超时影响是待验证假设，尚无代理/网关日志支持具体归因。流式接收没有保证所有请求都成功。

Qwen意见（未经独立验证）：将49帧描述为前抬腿上升过渡段，失衡/踉跄0.45、高抬腿/躲避0.35、夸张表演/舞步0.30；解剖左右腿、支撑脚及支撑类型均uncertain。不能把这些主观置信度当统计概率，或当作否定用户“行走”的证据。画面叙述、帧序及主角身份仍需人工复核；不自动修改标注或动画。

请求关联：source=1ec8f512-da30-4cc3-bf84-98fb6a56cd5f，started_utc=2026-10-28T15:45:10.329539+00:00；comparison=6a807d82-e2db-4cee-a7be-863a913e09ee，started_utc=2026-10-28T15:46:38.012265+00:00。这些是客户端标识，未证明UniArt已透传或记录；响应未提供可用request-id头。
