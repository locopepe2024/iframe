# PersPose 是否适用

2026-10-22。仓库 https://github.com/KenAdamsJoseph/PersPose ，已克隆 `/private/tmp/iframe-perspose-retry-20261022`，核对提交 `43eb2c2f38046764eb65441fd03bee161fd624b5`。源码核对，未运行模型。

## Observed

- **code fact**：README 明确要求图像配对焦距，从 EXIF 或手工测量水平 FOV 得到35mm等效焦距。推理 `src_PersPose/inference.py:84` 在缺失焦距时使用固定50mm，随后 `f=f35/36*W`，主点固定为图像中心。这是默认假设，不是估计结果。
- **code fact**：`src_PersPose/PersPose.py:60` 用 `K⁻¹[u,v,1]` 生成 Perspective Encoding；`:91` 从输入K读取f；`:120` 将预测相对深度、根密度与f组合，得到xyz/xyz0后做SMPL IK。代码输出深度并不意味着独立识别了真实焦距或尺度。
- **code fact**：`common/geometry.py:476` 的 Perspective Rotation 使用 `H=KRK⁻¹`；`datasets/transform.py:280` 保留原K并作 `Kcrop=A K`，`:295` 保存完整图像变换 `A affine_rot H`。PR还改变相机坐标朝向，恢复原图姿态须保留旋转，不能只逆裁剪像素。
- **code fact**：README 权重与辅助文件链接 Google Drive；本轮未验证文件可下载或完成下载。模型构造即加载SMPL，不能照搬HumanFoV的仅相机轻量推理路径。demo检测器/model/trainer有硬编码CUDA；本地macOS不能直接按官方命令运行。
- 代码LICENSE为MIT；SMPL及其他外部资产条件不能由代码LICENSE推定。仓库不内置模型权重。

## Direct implication

**可作“给定有效K后的人体姿态恢复”候选，不能直接替代 HumanFoV 估计未知焦距。** 现有GeoCalib固定K可以作为它的外部输入假设；没有原相机或历史裁剪记录不妨碍先用最终图像有效K实验，但该K仍有不确定性，PersPose不能自动补回记录。

更贴近当前任务的设计参考是：相机内参先转为像素射线，裁剪时同步传递K，透视旋转独立记录，预测相对深度与根位置分开，最后再做SMPL IK。它支持分离变量的设计方向；不证明旧映射缺口是本片最大误差因素。

## Not yet proven

该视频前/后朝向、遮挡、鞋接触、后段转身是否优于当前MediaPipe/GVHMR；权重入口是否可用；现有环境能否运行；外部有效K误差对结果的实际影响。论文数据集精度不能代替本片实验。单图网络/SMPL IK本身不构成脚接触或时序连续性验证。

## Hypotheses

透视编码可能减少当前直接混用图像XYZ造成的几何问题；SMPL约束可能改善局部骨长不一致。两项均需同片对照，不能由算法名认定收益。

## What would verify it

先验证官方权重和合法SMPL本地资产可用；在隔离CUDA环境用同一源六帧1/17/23/29/41/55、固定GeoCalib K、不选最优焦距完成推理，明确目标人检测（demo默认选最高分人物）。保留原图K、裁剪矩阵、PR旋转、PTS和坐标单位，逆变换回原相机再评分；既报2D关节，也独立看可见体态与脚接触。额外±10%焦距只做敏感性，不按当前评分选“真值”。未通过之前不替换主链路。

证据索引与本地源码SHA256：[contract.json](../raw/2026-10-22-perspose-review/contract.json)。
