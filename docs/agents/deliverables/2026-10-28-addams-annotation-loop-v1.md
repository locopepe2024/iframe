# Addams 五帧标注与局部重算入口

## Scope and success criteria

以第20–24帧建立可操作的诊断闭环：模型点仅作为预标注；人工确认可见性、左右关节及接触状态；导入时核验图像哈希、源PTS、坐标与任务身份；只有已提交的人工可见点参与局部固定骨长拟合。未标注时必须阻止拟合，不得把预测点当人工真值。生产链路保持不变。

提供Label Studio任务与配置，以及使用同一任务格式的独立HTML审阅页，避免第一轮依赖标注服务部署。HTML仅覆盖五帧试验，不建设另一套数据管理平台。原图为960×520审阅图，输入点由原3840×2080坐标逐轴转换。

验证包括：真实五帧任务生成，坐标往返、预测不算人工、遮挡不参与求解、哈希/PTS篡改拒绝；局部求解使用合成可见点进行恢复验证。合成测试不能作为源视频人工标注或实际复刻验收。

## Delivered

入口：`docs/agents/raw/2026-10-28-motion-asset-package/addams-annotation-loop/review.html`。双击打开，无需服务。每帧选择关节、纠正点位、逐项确认可见性，设置接触和可评状态，点击确认本帧，最终下载`addams-human-review.json`。六个关节包含双髋、双膝、双踝；隐藏点不必猜位置。页面不自动保存，关闭前下载。

同目录有`tasks.json`、`label-config.xml`、五张源审阅图。Label Studio若使用本地文件服务，需将document root指向包目录、显式启用本地文件服务后再导入；本轮未安装或验证Label Studio服务及配置的版本兼容性，独立页是当前可用入口。

导入命令（在项目根目录）：

```bash
python3 docs/agents/tools/addams_annotation_loop.py import \
  --package docs/agents/raw/2026-10-28-motion-asset-package/addams-annotation-loop \
  --export /path/to/addams-human-review.json
```

导入验证图像SHA、PTS、任务身份、尺寸、坐标有限值、重复点/任务、明确人工状态。原始下载文件由用户保留；normalized记录导出及任务SHA。每帧至少四个可见关节且五帧均reviewed才允许当前求解，不满足时保持待审核，不阻止用户保存部分标注。不可评帧后续需单独处理，不自动补真值。

求解入口：

```bash
/opt/motion-pose-venv/bin/python addams_annotation_solve.py \
  --review normalized.json --baseline-dir /tmp/addams-annotation-check/addams-fixed-rig \
  --out addams-reviewed-candidate-v1.json
```

media诊断环境已具备numpy2.5.4/scipy1.18.1，脚本已传到`/tmp/addams-annotation-check/`。真实标注完成后仍需传输normalized.json。每次使用新输出文件名，拒绝覆盖旧候选。

求解固定目标骨长、既有髋布局、焦距960px及第21帧拟合深度，优化腿段方向和每帧横竖平移；比较时序权重0/1/4，不自动选择。报告可见点残差、方向偏移、右小腿角度变化及骨长闭合，并保存三维端点和腿向。接触标签本轮仅保存，未参与物理解算；也未导出rig四元数动画或白模渲染。因此这是标注到局部候选的入口，尚不是最终白模资产闭环。

## Verification and current state

- 本地7项导入行为测试通过；依赖scipy的求解组在本地明确跳过。
- media同一套9项测试全部通过（含合成固定骨长重投影恢复及遮挡点排除）。合成点仅在测试内存构造，没有写成源视频人工标注。
- 生成页面JavaScript通过`node --check`；未进行浏览器拖动/下载的交互实测。
- 把仅含预测的tasks重新导入，实际得到`solver_ready: false`，五帧仍pending。尚无人工确认结果或实际复刻质量收益。

下一步由人工完成五帧后，导入并在media局部求解，生成源帧/旧候选/新候选对照；先检查关键动作是否保持，再接入rig曲线和接触约束。
