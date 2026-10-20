# recreation2 相机与 BASIS 契约审计

固定既有四组求解含yaw的bundle、PTS、rig和镜头；不再求解旋转。读取求值后的相机right/up/forward和投影类型，在各骨段实际起点按输入BASIS方向走相同骨长，比较屏幕方向与源XY；另外只在诊断中把同一方向解释为相机坐标，量几何差异。

原输入保留，Y原值/乘792÷1394各两组；方向目标已是世界目标，不得再乘root yaw。源1/17/23/29/41/55用既有anchors定位输出帧。记录起点处有限差分投影Jacobian，核对其与目标投影一致性；有限差分采用中心差分，不把一unit透视位移叫导数。

相机解释候选定义：按像素纵横尺度的向量(dx, dy*H/W, dz)，构造camera_right*dx-camera_up*dy+camera_forward*dz；只检验屏幕方向保留关系，不优化镜头/root/姿态，不宣称该向量恢复真实三维。没有主链路变更。
