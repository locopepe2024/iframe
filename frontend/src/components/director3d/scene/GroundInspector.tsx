import { useEffect, useState, type KeyboardEvent } from "react";

import { useWorkbenchStore } from "../state/workbench-store";

function GroundNumberField({ id, value, minimum, maximum, step, unit, onCommit }: { id: string; value: number; minimum: number; maximum: number; step: number; unit: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(value));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      setDraft(String(value));
      event.currentTarget.blur();
    }
  };
  return <span className="number-input"><input id={id} type="number" min={minimum} max={maximum} step={step} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} /><span>{unit}</span></span>;
}

export function GroundInspector() {
  const ground = useWorkbenchStore((state) => state.renderScene.ground);
  const calibrationCount = useWorkbenchStore((state) => state.renderScene.calibrationRevisionIds.length);
  const snappedCharacterCount = useWorkbenchStore((state) => Object.values(state.characters).filter((character) => character.transform.groundSnap).length);
  const toggleGroundVisible = useWorkbenchStore((state) => state.toggleGroundVisible);
  const toggleGroundLocked = useWorkbenchStore((state) => state.toggleGroundLocked);
  const setGroundHeightM = useWorkbenchStore((state) => state.setGroundHeightM);
  const setGroundOpacity = useWorkbenchStore((state) => state.setGroundOpacity);
  const setGroundGridSpacingM = useWorkbenchStore((state) => state.setGroundGridSpacingM);
  const toggleGroundGridSnap = useWorkbenchStore((state) => state.toggleGroundGridSnap);
  const toggleGroundSurfaceSnap = useWorkbenchStore((state) => state.toggleGroundSurfaceSnap);

  return (
    <section className="ground-inspector" aria-labelledby="ground-inspector-title">
      <div className="ground-inspector-heading">
        <div>
          <p className="kicker">Metric ground</p>
          <h3 id="ground-inspector-title">地面与吸附</h3>
        </div>
        <button type="button" className={ground.locked ? "ground-lock active" : "ground-lock"} aria-pressed={ground.locked} onClick={toggleGroundLocked}>
          {ground.locked ? "已锁定" : "锁定地面"}
        </button>
      </div>

      <div className="ground-summary" role="status" aria-live="polite">
        <span>高度 <strong>{ground.heightM.toFixed(2)} m</strong></span>
        <span>贴地人物 <strong>{snappedCharacterCount}</strong></span>
      </div>

      <label className="ground-toggle">
        <input type="checkbox" checked={ground.visible} onChange={toggleGroundVisible} />
        <span><strong>显示地面</strong><small>仅显隐地面，不改变人物空间坐标。</small></span>
      </label>

      <fieldset disabled={ground.locked} className="ground-controls">
        <legend>{ground.locked ? "解锁后可编辑地面参数" : "地面参数"}</legend>
        <label className="ground-number-control" htmlFor="ground-height">
          <span><strong>地面高度</strong><small>贴地人物会同步到该 Z 高度。</small></span>
          <GroundNumberField id="ground-height" value={ground.heightM} minimum={-10} maximum={10} step={0.05} unit="m" onCommit={setGroundHeightM} />
        </label>
        <label className="ground-range-control" htmlFor="ground-opacity">
          <span><strong>地面透明度</strong><output>{Math.round(ground.opacity * 100)}%</output></span>
          <input id="ground-opacity" type="range" min="0" max="1" step="0.05" value={ground.opacity} onChange={(event) => setGroundOpacity(Number(event.target.value))} />
        </label>
        <label className="ground-number-control" htmlFor="ground-grid-spacing">
          <span><strong>网格间距</strong><small>移动人物时 X/Y 使用同一米制步长。</small></span>
          <GroundNumberField id="ground-grid-spacing" value={ground.gridSpacingM} minimum={0.05} maximum={5} step={0.05} unit="m" onCommit={setGroundGridSpacingM} />
        </label>
        <label className="ground-toggle compact">
          <input type="checkbox" checked={ground.gridSnap} onChange={toggleGroundGridSnap} />
          <span><strong>网格吸附</strong><small>移动人物时按网格间距对齐 X/Y。</small></span>
        </label>
        <label className="ground-toggle compact" aria-disabled={calibrationCount === 0}>
          <input type="checkbox" checked={ground.surfaceSnap} disabled={calibrationCount === 0} onChange={toggleGroundSurfaceSnap} />
          <span><strong>校准表面吸附</strong><small>{calibrationCount === 0 ? "尚无已确认的场景表面。" : `可用校准 revision：${calibrationCount}`}</small></span>
        </label>
      </fieldset>
    </section>
  );
}
