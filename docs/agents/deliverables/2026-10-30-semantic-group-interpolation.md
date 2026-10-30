# 语义分组与双向补偿

## Observed

逐帧骨骼/脚底识别把相邻重复画面当成独立任务，效率低且容易把鞋面点误当鞋底。G5中62/63几乎重复、63→64是离地转折，说明动作组和语义状态比单帧坐标更适合作为分析单位。

## Direct implication

可以让LLM/视觉模型为帧或代表帧输出结构化语义，再按镜头和相邻状态归组。每组只定义需要分析的目标：姿势方向、左右腿阶段、脚跟状态、支撑/腾空、鞋底证据和相机状态。组内2–3帧互相参考；不清晰组可由前后清晰组进行**语义**补偿。

## Not yet proven

LLM语义输出是否稳定、左右身份是否正确、对漫画模糊帧的动作阶段判断是否可靠，尚未在整段评测。语义补偿不能证明真实像素坐标、深度、焦距或鞋底—地面距离。

## Hypotheses

相邻帧的离散动作状态通常比逐帧关节点坐标稳定；用前后清晰组共同约束，可能减少人工标注和单帧误判。但组边界错误会把整段姿态传播错，因此镜头和状态转折必须优先验证。

## What would verify it

先对46–65代表帧运行一次结构化语义输出，比较人工确认的G1–G5边界、G5的63→64离地转折、左右身份和支撑状态。仅将双向一致的状态扩展到组内；冲突输出unknown并进入人工队列。通过后才把语义状态作为姿态/接触求解的软先验。

[语义插值契约](../raw/2026-10-30-addams-semantic-interpolation-v1/contract.json)

## 可执行语义中间产物

已生成[帧语义扩展种子](../raw/2026-10-30-addams-semantic-interpolation-v1/frame-semantics-seed.json)。它只扩展类别状态，不生成坐标、深度、焦距或公制离地距离。目前仅G5中的用户确认事实写入`human_confirmed`；其余组保持`unassessed`，不会被下游误用。将来LLM输出可以替换这些帧的语义字段，而不改变骨架/IK接口。

## 双向语义插值执行器

已生成[插值结果](../raw/2026-10-30-addams-semantic-interpolation-v1/frame-semantics-interpolated.json)。执行器只在前后清晰组对同一类别状态达成一致时扩展为`temporal_inference`；单侧锚点、冲突锚点或缺少语义时保持unknown/unassessed。它不生成像素坐标、深度、焦距或公制离地距离。

## 结构化多模态语义请求

已生成[语义分析请求包](../raw/2026-10-30-addams-semantic-interpolation-v1/semantic-pass-request.json)。每组只提供2–3个代表帧，要求模型输出镜头变化、动作阶段、左右脚状态、脚跟状态、鞋底证据和不确定性；明确禁止输出坐标、深度、焦距和公制离地距离。模型输出必须经过证据等级复核后，才能进入双向语义插值。

## 语义结果校验

已增加[语义结果校验器](../tools/addams_validate_semantic_pass.py)和[响应模板](../raw/2026-10-30-addams-semantic-interpolation-v1/semantic-pass-response.template.json)。校验器拒绝坐标、深度、焦距、内参和公制离地字段；同时检查动作状态、鞋底证据、镜头状态、置信度和不确定性。未通过校验的模型结果不能进入插值或骨架求解。
