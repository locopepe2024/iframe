import { useWorkbenchStore } from "../state/workbench-store";

const AXIS_LABELS = ["X", "Y", "Z"];

export function ObjectTransformPanel() {
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const character = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const setTransformAxis = useWorkbenchStore((state) => state.setTransformAxis);
  const toggleGroundSnap = useWorkbenchStore((state) => state.toggleGroundSnap);
  return (
    <section className="object-transform-panel" aria-labelledby="object-transform-title">
      <div className="utility-heading"><div><p className="kicker">Object transform</p><h2 id="object-transform-title">空间位置</h2></div><span className="unit-badge">m / °</span></div>
      {character.locked && <div className="locked-notice" role="note"><strong>人物已锁定</strong><span>请先在场景对象中解锁，才能修改空间位置。</span></div>}
      {([
        ["position", "位置", character.transform.position, 0.1],
        ["rotationDeg", "旋转", character.transform.rotationDeg, 1],
        ["scale", "缩放", character.transform.scale, 0.05],
      ] as const).map(([field, label, values, step]) => (
        <fieldset className="transform-vector" key={field}>
          <legend>{label}</legend>
          <div>{values.map((value, axis) => <label key={AXIS_LABELS[axis]}><span>{AXIS_LABELS[axis]}</span><input type="number" step={step} value={Number(value.toFixed(3))} disabled={character.locked} onChange={(event) => setTransformAxis(selectedCharacterId, field, axis, Number(event.target.value))} /></label>)}</div>
        </fieldset>
      ))}
      <label className="check-row ground-snap"><input type="checkbox" checked={character.transform.groundSnap} disabled={character.locked} onChange={() => toggleGroundSnap(selectedCharacterId)} /><span>地面吸附（Z = 0）</span></label>
    </section>
  );
}
