# GVHMR / WHAM：相机、地面与可运行性核对

2026-10-23。官方固定commit代码审查和CPU相机辅助函数验证；没有完成两模型神经网络推理。主链路、rig及H3输入未改。

## Observed

**code fact**：官方HEAD固定为GVHMR `ee960bb6e2ea2d381aa97f08e9b71ef320b624b1`，WHAM `2b54f7797391c94876848b905ed875b154c4a295`。git克隆均失败；WHAM固定commit tarball成功解压，GVHMR通过GitHub contents API取得11个选定Python文件，并逐文件验证Git blob SHA与该commit完整树一致。外部源码仅在private/tmp；报告记录源码SHA256，不把下载成功称为模型可运行。

| 项目 | GVHMR | WHAM |
|---|---|---|
| 默认人体K | f=√(W²+H²)，居中主点 | 同左 |
| 是否恢复焦距 | demo使用假设值或用户输入；不是焦距估计器 | demo使用假设值；不是焦距估计器 |
| 显式K路径 | `DemoPL.predict`接收逐帧K_fullimg；CLI只提供整数f_mm | `--calib`传入DPVO；CustomDataset仍调用默认K生成函数 |
| 相机运动 | 默认SimpleVO估旋转，亦可DPVO | DPVO结果转换为相机角速度供网络；不是直接使用SLAM平移当人体轨迹 |
| 无相机运动模式 | `-s`设置恒等旋转，另选静态相机专用后处理 | `--estimate_local_only`跳过SLAM、放恒等四元数；仍调用轨迹网络，不能把输出当已验证世界坐标 |
| 接触/静止修正 | 预测6个点静止logit（双踝、双足、双腕），修root平移并做CCD IK | 4个回归足点接触值，阈值0.5修正根速度，再经学习的轨迹refiner |
| 地面处理 | 平移后按整段22骨架关节最低Y归零；注释明确不考虑foot height | 已查轨迹refiner调用链按足点速度修正；全局渲染另将整段mesh最低Y归零 |
| 模型资产 | SMPLX_NEUTRAL即使不渲染也由EnDecoder的lite模型加载；另需主权重、HMR2、ViTPose等 | SMPL_NEUTRAL及joint/feet regressors、主权重、HMR2、ViTPose等 |
| 官方入口硬件 | CUDA查询、`.cuda()`；requirements指定Linux CUDA轮子 | CUDA查询、配置DEVICE=cuda；DPVO含CUDA路径 |

**code fact**：GVHMR的K真正进入`f_cliffcam`条件与相机平移转换；两个辅助函数只用fx和主点，改变fy不改变这些函数结果，不能泛称支持任意非等方K。当前候选fx≈fy、主点居中，恰接近其假设。WHAM归一化函数虽接收`cam_intrinsics`形参，当前函数体不使用该参数；完整透视投影会用K，但crop→full平移转换以图像中心而非K的主点计算横纵偏移。修改calib文件不足以统一所有人体分支。

**runtime observation（精确上游函数、合成输入CPU执行）**：1394×792下，两者默认f=1603.278px，与当前GeoCalib有效候选1601.142px只差2.136px（0.1334%）。这只是数值接近，不是独立证实真实焦距。GVHMR对角线换算下候选相当于43.209mm，CLI整数`--f_mm 43`会得到1593.398px，不能声称精确注入候选K。

GVHMR SimpleVO缺省f_mm=None时内部改成24mm，在全分辨率对应889.339px；默认人体分支仍1603.278px。SimpleVO以0.5分辨率运行，实际像素f随之约减半，不能把缩放后的值直接与全图值比较。显式f_mm可令SimpleVO与人体分支采用同一等效焦距约定；DPVO分支则仍无条件estimate_K，不消费f_mm。**这确认的是不同分支的默认K不一致，尚未测量其对当前视频的影响。**

合成检查：GVHMR主点移动(+20,+15)px时平移变化(-0.1,-0.075,0)，WHAM的crop→full辅助函数对此不变；固定预测/框，仅将GVHMR f翻倍使根Z翻倍而XY不变。这些是局部函数契约，不代表完整网络对焦距的响应。

**code fact**：GVHMR默认demo将输入重新编码为30fps、CRF23，缓存只比较帧数；本源视频原本为可变PTS，不能直接沿用旧PTS对比。两模型预处理缓存也没有完整的输入/K配置指纹；不同设置需独立输出目录。GVHMR同时改写incam和global的body_pose为IK结果，消融需保存postproc前输出，不能把最终结果直接当网络原始预测。

**runtime observation**：临时环境macOS arm64、torch2.14.1，CUDA/MPS均不可用；实际调用与官方入口相同的CUDA设备查询得到`AssertionError: Torch not compiled with CUDA enabled`。检查已取得源码根和private/tmp、项目树内常见必需资产文件名，未发现所需SMPL/SMPLX及主权重；不代表全系统无资产。未执行任何注册下载脚本、未调用账号或GPU服务。Google Drive入口有官方说明，但当前下载可用性尚未验证。

## Direct implication

优先选择**GVHMR作为下一套三维独立对照候选**：有实际消费K的条件路径，世界/相机输出分开，静止平移修正与局部IK有明确代码边界。但官方默认值必须审计，不能无配置直接运行后宣称校准完成。

WHAM更适合作为接触感知根速度修正的参考。若直接使用官方demo的`--calib`，不能声称已对人体模型注入同一个K。两方法的最低Y归零都不是源地面测量，更不是目标鞋底代理点校准；重力对齐坐标也不等于恢复真实相机离地高度。

## Not yet proven

尚未在本视频运行GVHMR/WHAM，不提供新姿态误差、接触准确率或实际提速数据。无证据说明它们能修复197腕点塌缩或优于现有结果；无法仅凭静止/接触预测证明支持脚时段正确。没有恢复真实焦距、绝对深度、人物身高、米制机位高度或任意地形。

## Hypotheses

统一K、明确时基和禁用/分离后处理后，GVHMR可能更容易隔离相机空间姿态与世界root问题。默认SimpleVO与人体K不一致可能影响旋转估计，但当前视频影响量未知。静止腕点参与平移/IK在某些动作下可能错误传播，需保留6点logit和前后输出核对，不先行修改阈值。

## What would verify it

运行需要可用CUDA环境与合规取得的SMPLX、主模型和预处理权重；当前环境不具备。资产/硬件具备后，执行如下有边界对照：

1. 独立诊断入口直接读取原始解码帧并保留源PTS/模型帧映射；若采用30fps版本，明确重采样映射，不按源序号硬配。
2. 显式K_fullimg=当前有效候选，VO也使用同一尺度K；固定主体为黄衣人物，不能按最长轨迹自动替代。先验证相机是否静止，再决定static_cam，不能把静态假设当测量。
3. 相同预处理/权重，保存网络原始、仅root静止修正、再局部IK三个阶段（诊断副本），同时保留incam/global和静止logit；不因接触更稳就忽略源2D变差。
4. 分开核对前段1/17/23/29/41/55，后段191/195/197/203/205/209/211；评价可见2D、固定骨长、骨盆轴、支持期足点速度及源鞋底/目标鞋底高度。源2D不明点标未知，不用模型自身拟合当真值。

当前先完成输入契约审计，不为了“能跑”改生产或安装不兼容CUDA依赖。后续同源推理尚未通过。

## 固定版本来源

- [GVHMR demo](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/tools/demo/demo.py)：CLI、30fps重编码、VO、K、CUDA入口。
- [GVHMR camera helpers](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/hmr4d/utils/geo/hmr_cam.py)：estimate_K、create_camera_sensor、bbox条件与平移。
- [GVHMR postprocess](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/hmr4d/model/gvhmr/utils/postprocess.py)：六静止点、最低Y归零、CCD链。
- [GVHMR SimpleVO](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/hmr4d/utils/preproc/relpose/simple_vo.py)：默认24mm及缩放。
- [GVHMR installation](https://github.com/zju3dv/GVHMR/blob/ee960bb6e2ea2d381aa97f08e9b71ef320b624b1/docs/INSTALL.md)：模型资产。
- [WHAM demo](https://github.com/yohanshin/WHAM/blob/2b54f7797391c94876848b905ed875b154c4a295/demo.py)与[CustomDataset](https://github.com/yohanshin/WHAM/blob/2b54f7797391c94876848b905ed875b154c4a295/lib/data/datasets/dataset_custom.py)：calib与人体K分支。
- [WHAM reset_root_velocity](https://github.com/yohanshin/WHAM/blob/2b54f7797391c94876848b905ed875b154c4a295/lib/models/layers/utils.py)、[SMPL](https://github.com/yohanshin/WHAM/blob/2b54f7797391c94876848b905ed875b154c4a295/lib/models/smpl.py)、[visualization](https://github.com/yohanshin/WHAM/blob/2b54f7797391c94876848b905ed875b154c4a295/lib/vis/run_vis.py)。WHAM build_network缺失checkpoint仅告警后返回网络，诊断入口必须额外assert资产，不能把随机初始化当推理。

[本地数值/硬件/源码哈希结果](../raw/2026-10-23-gvhmr-wham-contract/report.json)。复现工具`docs/agents/tools/recreation2_gvhmr_wham_contract.py`；通过AST载入精确上游函数，未import/运行完整模型。
