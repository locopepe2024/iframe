import { rigProfile } from "../data/humanoid";
import { useWorkbenchStore } from "../state/workbench-store";

const GROUP_LABELS = {
  center: "躯干",
  left: "左侧",
  right: "右侧",
} as const;

export function JointTree() {
  const selectedJointId = useWorkbenchStore((state) => state.selectedJointId);
  const jointFilter = useWorkbenchStore((state) => state.jointFilter);
  const showInternalBones = useWorkbenchStore((state) => state.showInternalBones);
  const selectJoint = useWorkbenchStore((state) => state.selectJoint);
  const setJointFilter = useWorkbenchStore((state) => state.setJointFilter);
  const toggleInternalBones = useWorkbenchStore((state) => state.toggleInternalBones);
  const normalizedFilter = jointFilter.trim().toLowerCase();
  const visible = rigProfile.joints.filter((joint) => {
    if (!showInternalBones && joint.control_class !== "product_joint") return false;
    return !normalizedFilter || `${joint.joint_id} ${joint.semantic_role}`.toLowerCase().includes(normalizedFilter);
  });

  return (
    <section className="panel-section joint-tree" aria-labelledby="joint-tree-title">
      <div className="section-heading">
        <div>
          <p className="kicker">Rig hierarchy</p>
          <h2 id="joint-tree-title">人体骨骼</h2>
        </div>
        <span className="count-badge">{visible.length}</span>
      </div>
      <label className="search-field">
        <span className="sr-only">搜索关节</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input value={jointFilter} onChange={(event) => setJointFilter(event.target.value)} placeholder="搜索关节名称" />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={showInternalBones} onChange={toggleInternalBones} />
        <span>显示 Helper / Attachment</span>
      </label>
      <div className="joint-groups">
        {(["center", "left", "right"] as const).map((side) => {
          const joints = visible.filter((joint) => joint.side === side);
          if (!joints.length) return null;
          return (
            <div className="joint-group" key={side}>
              <h3>{GROUP_LABELS[side]}</h3>
              {joints.map((joint) => {
                const editable = joint.control_class === "product_joint" && joint.edit_policy === "direct";
                return (
                  <button
                    className={`joint-row ${selectedJointId === joint.joint_id ? "selected" : ""}`}
                    type="button"
                    key={joint.joint_id}
                    onClick={() => selectJoint(joint.joint_id)}
                    aria-pressed={selectedJointId === joint.joint_id}
                  >
                    <span className={`joint-dot ${editable ? "editable" : "internal"}`} aria-hidden="true" />
                    <span className="joint-name">{joint.joint_id}</span>
                    <span className={`joint-policy ${editable ? "editable" : "readonly"}`}>
                      {editable ? "可调" : joint.control_class === "deformation_helper" ? "派生" : "只读"}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
