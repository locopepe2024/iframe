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
