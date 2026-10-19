# recreation2 XYZ 输入契约审计

2026-10-19。范围：只读追溯原始提取器、标准化、2秒切片、builder和renderer；主链路、rig和深度数据未改。结论：**已有Z，无须新增深度；当前存在归一化图像坐标直接作为欧氏方向、髋相对Z用于root深度的契约问题。尚未量出这些问题对投影误差的贡献。**

## Observed

### Code fact / authoritative contract

- media现存 `/home/ubuntu/motion-track/extract_motion_track.py` 第39–40行读取 `result.pose_landmarks` 并保存原始 `[x,y,z,visibility]`。输入是完整解码帧经BGR→RGB转换，没有应用级裁剪、缩放或额外Z变换。SDK内部预处理不在此结论范围内。
- 已安装MediaPipe **1.0.1** 的 `tasks/python/vision/pose_landmarker.py` 中 `PoseLandmarkerResult` 明确区分 `pose_landmarks`（normalized image coordinates）与 `pose_world_landmarks`（world coordinates）。现存提取器未保存后者。[SDK哈希、原文节选和官方定义](../raw/2026-10-19-xyz-contract/sdk-contract.json)
- [官方Pose Landmarker Python文档](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python)，2026-10-19通过media侧curl读取公开页面：X/Y分别按图宽/图高归一化；Z以髋中点深度为原点，数值越小越靠近相机，尺度 **roughly the same scale as x**。世界坐标输出另为以髋中点为原点的米制三维坐标。后者同样不是舞台绝对root轨迹真值。
- `normalize_motion_track.py:21` 的 `point()` 原样复制XYZ；输出元数据未保存宽高、各轴单位或Z原点。`coordinate_system` 只记录轴名，不代表已做相机或尺度转换。
- `build_full_body_bundle_blender.py:7–24` 对原始XYZ差值直接施加绕X轴−90°旋转，映射约为 `(dx,dy,dz) → (dx,dz,-dy)`，再归一化求骨骼方向。未补偿图像宽高尺度，也没有相机内参反投影。
- builder第45行由髋间 `(dx,dz)` 估计root yaw；第73行由髋均值 `h` 构造root位置，深度项是 `clamp(-h.z*1.5, -.35, .35)`。Z分别用于姿态、朝向和位移，不等于已经证明同一变换重复执行。
- `render_full_motion_bundle.py:99–122` 应用bundle的root位置/yaw和局部四元数，不再读取源关节XYZ或注入新深度。

### Runtime observation

[可复跑审计脚本](../tools/recreation2_xyz_contract_audit.py)对相同原始文件执行现存标准化器，完整输出与已存120帧track完全一致。原始到标准化的 **3786个坐标分量**、标准化到31-key切片的 **1488个分量**逐值相等，最大差为0。计数仅覆盖保存的可用关节，不代表120帧均检测成功。

原片1394×792：若将图像XY改用图宽为共同归一化基准，Y应乘 **792/1394 = 0.568149**；当前原始Y相对该基准为 **1.760101倍**。这只证明尺度不一致，不能当成真实三维身材变形比例。Z仅近似X尺度，简单aspect补偿也不等于相机反投影或公制重建。

2秒切片可用髋中点Z范围为 `[-0.0000037905, 0.0000885045]`；builder由此得到root深度 `[-0.0001327568, 0.0000056857]` Blender units。该项近乎为零，与髋相对Z的定义一致；不能由这段小范围数值断言源人物真实前后运动为零。

原始track SHA-256 `e556a4991e1e879445cc1ca3f3ce050af1e628d149a6119c28281c36acfaf153`，与标准化 `source_revision` 一致。[完整数值及哈希](../raw/2026-10-19-xyz-contract/audit.json)。[现存提取器快照](../raw/2026-10-19-xyz-contract/extractor-current.py) SHA-256 `aba3f34ae3824533a8036cf73c3c5fc773dcca5c12d2b73f7c06a922df6e5546`。

## Direct implication

1. 用户“已有XYZ不应再加深度”的判断成立。需要校验现有坐标含义与使用方式，无须新增维度。
2. 直接归一化向量只会移除整体长度，不会消除逐轴尺度差异；因此当前旋转目标不能被当成已校准的欧氏三维方向。
3. 以髋中点为零点的Z缺少整个人相对相机的绝对深度信息，不能单凭髋均值恢复root前后位移。另一路world landmarks也仍以髋为原点，不能仅替换字段就解决舞台轨迹。
4. “深度重复添加”没有在已审计链路中得到证据。现存问题应准确描述为坐标尺度/原点与下游几何假设不一致。

## Not yet proven

- 现存远端提取器与原始文件的结构、selection policy相符，但未保存原运行的不可变命令/脚本哈希，因此不能证明原始文件必由该字节版本生成。当前SDK版本也不是原运行版本的不可变证明。
- 官方文档为本次读取的公开版本；已安装SDK可证明两类输出的类型区分，但其通用NormalizedLandmark注释不足以独立证明姿态Z的全部语义。
- 未证明aspect补偿会改善源1/17/23/29帧，更未证明它能修复后段转身、异常Z变化或脚接触。尚无贡献比例或统计根因结论。

## Hypotheses

归一化图像XYZ的尺度差异可能使肢体倾角失真；与目标rig骨长/身体轴和相机投影共同作用后，支持踝二维稳定仍可能出现rig三维位移。源Z估计变化、时间量化和父空间问题也仍可能参与，不能据本次审计排除。

## What would verify it

固定源PTS、XY/Z数值、rig、骨盆开关、root和镜头，在隔离目录比较现存方向映射与仅补偿Y尺度的映射；预先检查源1/17/23/29/41/55及异常源27→29、33→35，不清零Z，不重新拟合镜头或调整IK权重来补偿结果。分别报告源关节投影、旋转变化和鞋底轨迹；结果无论改善或变差均保留。world landmarks若要对照，须重新提取并核对相同人物/帧身份，单独验证其相机坐标与尺度，不能混进aspect单变量试验。

复跑：
```sh
python3 docs/agents/tools/recreation2_xyz_contract_audit.py --artifacts /private/tmp/cozyclay-media-real-20261019 --out docs/agents/raw/2026-10-19-xyz-contract/audit.json
```
