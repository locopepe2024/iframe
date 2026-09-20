import { rigProfile } from "../data/humanoid";
import { useWorkbenchStore } from "../state/workbench-store";
import { semanticControlLabel } from "./semantic-control-labels";
import { degreesToSemanticValue, enumerateSemanticControls, semanticValueToDegrees, type SemanticControlDefinition } from "./semantic-controls";

const controlsByJoint = new Map<string, SemanticControlDefinition[]>();
for (const control of enumerateSemanticControls(rigProfile)) {
  controlsByJoint.set(control.targetJointId, [...(controlsByJoint.get(control.targetJointId) ?? []), control]);
}

export function SemanticControlPanel() {
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const selectedJointId = useWorkbenchStore((state) => state.selectedJointId);
  const character = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const setJointRotation = useWorkbenchStore((state) => state.setJointRotation);
  const controls = controlsByJoint.get(selectedJointId) ?? [];
  const rotations = character.jointRotations[selectedJointId] ?? { x: 0, y: 0, z: 0 };

  return (
    <fieldset className="semantic-control-panel">
      <legend>语义姿势控制</legend>
      <p>用标准化幅度调整身体动作；0% 是当前 rig 的中立角度。精确角度可在下方展开。</p>
      {controls.map((control) => {
        const degrees = rotations[control.targetAxis];
        const normalized = degreesToSemanticValue(control, degrees);
        const label = semanticControlLabel(control);
        const inputId = `semantic-${control.targetJointId}-${control.targetAxis}`;
        return (
          <div className="semantic-control" key={control.controlId}>
            <div className="semantic-control-heading">
              <label htmlFor={inputId}>{label}</label>
              <output htmlFor={inputId}>{Math.round(normalized * 100)}% · {Number(degrees.toFixed(1))}°</output>
            </div>
            <input
              id={inputId}
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={normalized}
              aria-valuetext={`${Math.round(normalized * 100)}%，${Number(degrees.toFixed(1))} 度`}
              onChange={(event) => setJointRotation(
                selectedCharacterId,
                control.targetJointId,
                control.targetAxis,
                Number(semanticValueToDegrees(control, Number(event.target.value)).toFixed(3)),
              )}
            />
            <div className="semantic-range"><span>{control.outputRangeDeg[0]}°</span><span>中立</span><span>{control.outputRangeDeg[1]}°</span></div>
          </div>
        );
      })}
    </fieldset>
  );
}
