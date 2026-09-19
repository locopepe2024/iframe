import { useWorkbenchStore } from "../state/workbench-store";
import { POSE_PRESET_FAMILIES, POSE_PRESETS, posePresetsByFamily, type PosePresetId } from "./pose-presets";

export function PosePresetPanel() {
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const character = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const rigAdmissionStatus = useWorkbenchStore((state) => state.rigAdmissionStatus);
  const applyPosePreset = useWorkbenchStore((state) => state.applyPosePreset);
  const setPoseRootOffsetAxis = useWorkbenchStore((state) => state.setPoseRootOffsetAxis);
  const mirrorPose = useWorkbenchStore((state) => state.mirrorPose);
  const selectedPreset = character.activePresetId ?? "custom";
  const disabled = rigAdmissionStatus !== "passed" || character.locked;
  const preset = selectedPreset === "custom" ? undefined : POSE_PRESETS.find((item) => item.presetId === selectedPreset);
  return (
    <section className="pose-preset-panel" aria-labelledby="pose-preset-title">
      <div className="utility-heading"><div><p className="kicker">Pose composition</p><h2 id="pose-preset-title">姿势预设与细调</h2></div>{character.adjustedJointIds.length > 0 && <span className="refined-badge">已细调 {character.adjustedJointIds.length}</span>}</div>
      {character.locked && <div className="locked-notice" role="note"><strong>姿势编辑已锁定</strong><span>场景对象解锁后可继续应用和细调姿势。</span></div>}
      <label className="preset-select"><span>基础姿势</span><select value={selectedPreset} disabled={disabled} onChange={(event) => applyPosePreset(selectedCharacterId, event.target.value as PosePresetId)}>{selectedPreset === "custom" && <option value="custom" disabled>自定义 / 镜像姿势</option>}{POSE_PRESET_FAMILIES.map((family) => <optgroup key={family.familyId} label={family.label}>{posePresetsByFamily.get(family.familyId)?.map((preset) => <option key={preset.presetId} value={preset.presetId}>{preset.label}</option>)}</optgroup>)}</select></label>
      <p>{selectedPreset === "custom" ? "当前姿势来自镜像或独立关节调整。" : preset?.description}</p>
      <div className="pose-offset-control">
        <div className="semantic-control-heading"><label htmlFor="pose-height-offset">姿势局部高度</label><output>{character.poseRootOffsetM[2].toFixed(2)} m</output></div>
        <div className="axis-inputs">
          <input id="pose-height-offset" type="range" min={-1} max={0.5} step={0.01} value={character.poseRootOffsetM[2]} disabled={disabled} onChange={(event) => setPoseRootOffsetAxis(selectedCharacterId, 2, Number(event.target.value))} />
          <label className="number-input"><input aria-label="姿势局部高度数值" type="number" min={-1} max={0.5} step={0.01} value={character.poseRootOffsetM[2]} disabled={disabled} onChange={(event) => setPoseRootOffsetAxis(selectedCharacterId, 2, Number(event.target.value))} /><span>m</span></label>
        </div>
      </div>
      {preset?.contactHint && <small className="contact-hint">接触提示：{preset.contactHint}</small>}
      <button type="button" disabled={disabled} onClick={() => mirrorPose(selectedCharacterId)}>左右镜像当前姿势</button>
      <small>镜像策略：左右关节互换，X 保持，Y/Z 取反；完整浏览器/Blender 镜像校验仍属于后续 parity gate。</small>
    </section>
  );
}
