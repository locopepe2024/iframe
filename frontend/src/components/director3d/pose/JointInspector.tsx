import { rigProfile } from "../data/humanoid";
import { ObjectTransformPanel } from "../scene/ObjectTransformPanel";
import { GroundInspector } from "../scene/GroundInspector";
import { useWorkbenchStore } from "../state/workbench-store";
import type { Axis } from "../types";
import { PosePresetPanel } from "./PosePresetPanel";
import { SemanticControlPanel } from "./SemanticControlPanel";

const AXES: Axis[] = ["x", "y", "z"];

export function JointInspector() {
  const selectedJointId = useWorkbenchStore((state) => state.selectedJointId);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const character = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const rotations = character.jointRotations[selectedJointId] ?? { x: 0, y: 0, z: 0 };
  const rigAdmissionStatus = useWorkbenchStore((state) => state.rigAdmissionStatus);
  const rigAdmissionIssues = useWorkbenchStore((state) => state.rigAdmissionIssues);
  const setJointRotation = useWorkbenchStore((state) => state.setJointRotation);
  const resetJoint = useWorkbenchStore((state) => state.resetJoint);
  const resetPose = useWorkbenchStore((state) => state.resetPose);
  const joint = rigProfile.joints.find((item) => item.joint_id === selectedJointId) ?? rigProfile.joints[0];
  const editable = rigAdmissionStatus === "passed" && !character.locked && joint.control_class === "product_joint" && joint.edit_policy === "direct";

  return (
    <aside className="inspector-panel" aria-labelledby="inspector-title">
      <div className="section-heading">
        <div>
          <p className="kicker">Joint inspector</p>
          <h2 id="inspector-title">关节调节</h2>
        </div>
        <span className="revision-badge">姿势 rev {character.poseRevision}</span>
      </div>

      <dl className="selection-summary">
        <div><dt>人物</dt><dd>{character.label}</dd></div>
        <div><dt>关节</dt><dd>{joint.joint_id}</dd></div>
        <div><dt>类型</dt><dd>{editable ? "产品关节 · 可直接调节" : `${joint.control_class} · ${joint.edit_policy}`}</dd></div>
        <div><dt>父级</dt><dd>{joint.parent_joint_id ?? "无"}</dd></div>
      </dl>

      <ObjectTransformPanel />

      {character.calibratedPlacement && <section className={`calibrated-placement-summary ${character.calibratedPlacement.reviewRequired ? "review-required" : ""}`} aria-labelledby="character-placement-title"><div className="utility-heading"><div><p className="kicker">Calibrated placement</p><h2 id="character-placement-title">背景图空间定位</h2></div><span className="revision-badge">{character.calibratedPlacement.reviewRequired ? "需复核" : "已重投影"}</span></div><dl><div><dt>标定</dt><dd>{character.calibratedPlacement.calibrationId}@{character.calibratedPlacement.calibrationRevision}</dd></div><div><dt>放置表面</dt><dd>{character.calibratedPlacement.placementSurface}{character.calibratedPlacement.placementSurfaceInputId ? ` · ${character.calibratedPlacement.placementSurfaceInputId}` : ""}</dd></div><div><dt>屏幕锚点</dt><dd>{character.calibratedPlacement.screenAnchorNormalized.map((value) => value.toFixed(3)).join(", ")}</dd></div><div><dt>世界位置</dt><dd>{character.calibratedPlacement.worldPositionM.map((value) => value.toFixed(3)).join(", ")} m</dd></div><div><dt>重投影误差</dt><dd>{character.calibratedPlacement.reprojectionErrorPx.toFixed(3)} px</dd></div><div><dt>置信度</dt><dd>{Math.round(character.calibratedPlacement.confidence * 100)}%</dd></div></dl></section>}

      <GroundInspector />

      <PosePresetPanel />

      {editable ? (
        <>
          <SemanticControlPanel />
          <details className="expert-controls">
            <summary>精确角度控制</summary>
            <fieldset className="rotation-controls">
              <legend>相对静止姿势旋转</legend>
              {AXES.map((axis) => {
                const limits = joint.rotation_limits_deg[axis];
                const supported = joint.supported_axes.includes(axis) && Boolean(limits);
                const [minimum, maximum] = limits ?? [0, 0];
                return (
                  <div className="axis-control" key={axis}>
                    <div className="axis-heading">
                      <label htmlFor={`rotation-${axis}`}>{axis.toUpperCase()} 轴</label>
                      <span>{supported ? `${minimum}° — ${maximum}°` : "不支持"}</span>
                    </div>
                    <div className="axis-inputs">
                      <input id={`rotation-${axis}`} type="range" min={minimum} max={maximum} step="1" value={rotations[axis]} disabled={!supported} onChange={(event) => setJointRotation(selectedCharacterId, joint.joint_id, axis, Number(event.target.value))} />
                      <label className="number-input"><span className="sr-only">{axis.toUpperCase()} 轴角度</span><input type="number" min={minimum} max={maximum} step="1" value={rotations[axis]} disabled={!supported} onChange={(event) => setJointRotation(selectedCharacterId, joint.joint_id, axis, Number(event.target.value))} /><span>°</span></label>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          </details>
        </>
      ) : (
        <div className="readonly-notice" role="note">
          <strong>{character.locked ? "人物已锁定" : rigAdmissionStatus === "failed" ? "骨架准入失败" : rigAdmissionStatus === "pending" ? "正在验证骨架" : "该骨骼不可直接编辑"}</strong>
          <p>{character.locked ? "请先在场景对象中解锁该人物。锁定状态同时阻止视口、数值和姿势写入。" : rigAdmissionStatus === "passed" ? "内部 Helper 与 Attachment 仅用于蒙皮变形或附着关系。请选择产品关节进行姿势调整。" : "姿势写入已关闭。请查看下方诊断中的具体缺失或映射错误。"}</p>
        </div>
      )}

      <div className="inspector-actions">
        <button type="button" onClick={() => resetJoint(selectedCharacterId, joint.joint_id)} disabled={!editable}>重置当前关节</button>
        <button type="button" className="secondary" disabled={character.locked || rigAdmissionStatus !== "passed"} onClick={() => resetPose(selectedCharacterId)}>重置全身姿势</button>
      </div>
      <details className="pose-state">
        <summary>查看标准化姿势值</summary>
        <pre>{JSON.stringify({ character_id: selectedCharacterId, rig_profile_id: rigProfile.rig_profile_id, transform: character.transform, pose_revision: character.poseRevision, joint_rotations_deg: character.jointRotations }, null, 2)}</pre>
      </details>

      <section className="utility-panel" aria-labelledby="render-history-title">
        <div className="utility-heading"><div><p className="kicker">Render history</p><h2 id="render-history-title">生成与历史</h2></div><span className="count-badge">0</span></div>
        <p>浏览器核心暂不提交渲染任务。Blender 编译将在 iFrame Core 持久化契约完成后接入。</p>
        <button type="button" disabled>生成参考帧</button>
      </section>

      <section className="utility-panel diagnostics" aria-labelledby="diagnostics-title">
        <div className="utility-heading"><div><p className="kicker">Diagnostics</p><h2 id="diagnostics-title">诊断</h2></div><span className={rigAdmissionStatus === "passed" ? "healthy-dot" : "blocked-dot"} aria-label={rigAdmissionStatus === "passed" ? "资产状态正常" : "骨架编辑被阻止"} /></div>
        <dl>
          <div><dt>浏览器模型</dt><dd>{rigAdmissionStatus === "pending" ? "正在加载" : "已加载 GLB"}</dd></div>
          <div><dt>产品关节</dt><dd>{rigAdmissionStatus === "passed" ? "57 / 57" : `阻止编辑 · ${rigAdmissionIssues.length} 项`}</dd></div>
          <div><dt>映射版本</dt><dd>{rigProfile.mapping_version}</dd></div>
          <div><dt>编译状态</dt><dd>尚未提交</dd></div>
        </dl>
        {rigAdmissionIssues.length > 0 && <ul className="diagnostic-issues">{rigAdmissionIssues.map((issue) => <li key={`${issue.code}-${issue.jointId}`}><strong>{issue.code}</strong><span>{issue.message}</span></li>)}</ul>}
      </section>
    </aside>
  );
}
