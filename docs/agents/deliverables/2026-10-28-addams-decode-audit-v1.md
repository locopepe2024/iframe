# 抽帧质量核查

Observed：FFprobe读取217帧，其中2个I帧、215个P帧。10个缺测代表帧均为P帧，但其他绝大多数帧同样为P帧。FFmpeg连续解码提取10张3840×2080 PNG，无视频解码错误；仅提示封面类型unknown cover type。第115帧无损输出目视仍存在明显运动拖影、倒置与遮挡，模糊不是仅在JPEG保存后出现。

Code fact：模型输入使用OpenCV连续read读取source.mp4的原分辨率解码帧；没有读标注预览JPEG，也未指定仅解码I帧或读取P帧残差。审阅图通过FFmpeg从头连续解码，select(n=源帧号−1)，缩放为960×520后默认JPEG编码。

Direct implication：预览缩小4倍并有二次有损压缩，可能影响人工辨认；不能用预览模糊直接解释模型缺测。P帧类型本身不能作为模糊原因或过滤依据；只保留2个I帧会丢失绝大多数动作信息。

Not yet proven：尚未逐像素对比media OpenCV与独立FFmpeg解码、逐帧验证两端视频哈希和读取PTS。不能据当前检查完全排除解码链路差异，也不能认定动画体型、运动模糊或倒置哪项主导模型失败。低置信度不等价于已证明点位错误。

What would verify it：补做同帧同分辨率解码对照；标注后续版本保留原分辨率PNG/局部放大，既有已确认标注和哈希不覆盖。检测困难帧结合邻帧恢复，并把源帧清晰度与模型失败单独统计。

工件：addams-decode-audit-v1/decode-audit.json、native-01.png至native-10.png、preview-comparison.jpg。原图缩放到960×520后与原JPEG的RGB平均绝对差为2.19–4.29/255，混合缩放核与编码差异，不是姿态准确率，也不能排除局部细节损失。
