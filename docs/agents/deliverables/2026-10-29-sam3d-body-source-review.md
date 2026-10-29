# SAM 3D Body 官方源码核对

## Observed

2026-10-29通过GitHub API核对官方README、INSTALL.md、demo.py、notebook/utils.py、sam_3d_body_estimator.py及tools/build_fov_estimator.py。查询main得到版本`b5c765a0d89d789985e186d396315e7590887b94`；读取文件未固定SHA，不能承诺跨请求原子快照。

- 官方定位：单图完整人体网格恢复，使用Momentum Human Rig（MHR），覆盖身体、脚和手；README报告复杂视角/遮挡泛化表现。没有在我们的卡通视频上验证。
- `process_one_image`支持人物框、mask和`cam_int`；输出2D/3D关键点、网格、相机平移、身体参数、形状、关节坐标和全局旋转，适合作为独立3D候选层。
- README说明模型支持2D关键点提示，但当前`process_one_image`签名没有关键点参数。人工标注驱动需要核对底层提示路径并适配，不能宣称现有JSON可直接传入。
- `cam_int`标注为numpy数组，实际代码调用`.to(batch['img'])`，接入时应核对并使用合适的torch Tensor及批次形状。
- 未输入内参时可用MoGe2估计K，或退到默认FOV。MoGe2估计不是实测内参，也不自动解除绝对尺度/深度歧义。
- `process_one_image`每张图清空缓存；所读官方demo逐图独立执行，没有展示视频身份跟踪、时序约束、世界轨迹、脚接触或Blender动作导出闭环。
- demo自动选择cuda/cpu，但estimator内部`recursive_to(batch, 'cuda')`硬编码CUDA；不能依据demo CPU分支认定官方完整推理支持现有CPU主机。
- INSTALL要求Python3.11、PyTorch、Detectron2及其他依赖；MoGe/SAM组件可选。权重需在Hugging Face申请访问并认证。未查询私人账户或下载权重。
- MHR官方提供SMPL/SMPL-X转换工具入口，以及能输出网格与骨架状态的参数模型；转换精度与目标白模重定向仍需验证，不可直接重用SMPL骨索引。

## Direct implication

建议加入独立对照，优先验证完整髋—膝—踝—足链候选，避免只修膝点导致踝退化。可复用人物框和源图，固定同一K隔离姿态模型差异，再单独测试MoGe2内参候选。先不改主链路。

## Not yet proven

未运行SAM3D，无法证明它优于当前ViTPose/GVHMR；示例图与官方benchmark不等于该卡通片的准确率。无证据表明隐藏肢体、脚接触或相机轨迹能由它可靠自动恢复。MHR模型的表情参数存在，也不代表SAM3D已可靠估计面部表情。

## What would verify it

1. 先确认可用CUDA环境、依赖和合法可下载权重；独立环境，保持现有工作环境。
2. 用同一原图、主角框、分辨率和固定K，对源49/51/53/55/56/62/64帧输出完整关键点与正侧视网格。保留源PTS、裁剪变换和版本。
3. 对照原生GVHMR与ViTPose；只在解剖语义一致的可见关节上计投影误差。鞋底代理单独评分；64双脚离地作为接触语义事实，单图预测不自动覆盖用户确认。
4. 初轮不输入已用于验收的人工点；若测试关键点提示，保留独立未提示帧/部位，分开报告两组。
5. 检查左右身份、整条腿末端退化、骨长/体形稳定、连续运动及耗时；单帧通过后再对46–65整段测试。最后接MHR到目标rig转换、时序求解与分段接触IK。

来源：[SAM3D仓库](https://github.com/facebookresearch/sam-3d-body)、[安装](https://github.com/facebookresearch/sam-3d-body/blob/main/INSTALL.md)、[推理封装](https://github.com/facebookresearch/sam-3d-body/blob/main/sam_3d_body/sam_3d_body_estimator.py)、[FoV实现](https://github.com/facebookresearch/sam-3d-body/blob/main/tools/build_fov_estimator.py)、[MHR](https://github.com/facebookresearch/MHR)。

## Deployment preflight observed

media运行检查：x86_64、约15GiB RAM、73GiB可用磁盘；未发现nvidia-smi或/dev/nvidia设备，现有torch为2.3.0+cpu，cuda.is_available()为False。media访问官方DINOv3权重URL得到HTTP401、`x-error-code: GatedRepo`，明确要求获批访问且认证。这是匿名请求结果，不证明任何用户账号未获批；没有读取令牌或账户私有页面。

已用`addams_sam3d_prepare.py`冻结49/51/53/55/56/62/64七张既有960×520诊断源图、逐文件SHA256、25fps时间戳、原生固定K候选及64帧用户腾空语义，输出`docs/agents/raw/2026-10-29-addams-sam3d-evaluation-v1/manifest.json`。人物ROI仍明确为pending；不将整张画面当主角裁剪，不输入验收标注。尚未安装新环境、下载权重或运行推理，未修改既有GVHMR环境。

继续实测需要官方权重访问和可用CUDA运行条件，或单独验证CPU适配；不能把依赖安装完成当成推理成功。用户可在自己的Hugging Face账号申请`facebook/sam-3d-body-dinov3`访问并在运行主机自行登录，无需在聊天提供token。
