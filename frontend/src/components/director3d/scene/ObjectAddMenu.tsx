import { useRef } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { PrimitiveKind } from "../types";

const PRIMITIVES: Array<{ kind: PrimitiveKind; label: string; description: string }> = [
  { kind: "cube", label: "立方体", description: "箱体、桌面与空间占位" },
  { kind: "sphere", label: "球体", description: "球形产品与碰撞占位" },
  { kind: "cylinder", label: "圆柱体", description: "杯、瓶、柱状产品" },
  { kind: "torus", label: "圆环", description: "环形产品与轨迹标记" },
  { kind: "cone", label: "圆锥体", description: "锥形物体与方向标记" },
  { kind: "pyramid", label: "棱锥", description: "棱锥产品与构图标记" },
];

function PrimitiveGlyph({ kind }: { kind: PrimitiveKind }) {
  if (kind === "sphere") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M5 12h14M12 5c2.2 2 3.3 4.3 3.3 7S14.2 17 12 19c-2.2-2-3.3-4.3-3.3-7S9.8 7 12 5Z"/></svg>;
  if (kind === "cylinder") return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="6" ry="3"/><path d="M6 6v12c0 1.7 2.7 3 6 3s6-1.3 6-3V6"/><path d="M6 18c0-1.7 2.7-3 6-3s6 1.3 6 3"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 7-4 7 4v10l-7 4-7-4V7Z"/><path d="m5 7 7 4 7-4M12 11v10"/></svg>;
}

export function ObjectAddMenu() {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const addPrimitive = useWorkbenchStore((state) => state.addPrimitive);
  const addEmptyObject = useWorkbenchStore((state) => state.addEmptyObject);
  const finish = (action: () => void) => {
    action();
    menuRef.current?.removeAttribute("open");
  };

  return (
    <details className="object-add-menu" ref={menuRef}>
      <summary aria-label="添加场景对象"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>添加对象</span></summary>
      <div className="object-add-popover">
        <div className="object-add-heading"><strong>本地基础几何体</strong><small>无需网络，可用于站位、产品和空间占位。</small></div>
        <div className="primitive-grid">
          {PRIMITIVES.map((primitive) => <button key={primitive.kind} type="button" onClick={() => finish(() => addPrimitive(primitive.kind))}><PrimitiveGlyph kind={primitive.kind}/><span><strong>{primitive.label}</strong><small>{primitive.description}</small></span><span className="availability available">可用</span></button>)}
        </div>
        <button className="empty-object-action" type="button" onClick={() => finish(addEmptyObject)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="3"/></svg><span><strong>空对象</strong><small>创建空间锚点，不生成可见表面。</small></span></button>
        <p className="director-boundary-note">素材与三维资产导入将在 iFrame Core 资产契约接入后开放。</p>
      </div>
    </details>
  );
}
