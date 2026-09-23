import { useState } from "react";

import { DialogueTimelinePanel } from "./dialogue/DialogueTimelinePanel";
import { FocusTimelinePanel } from "./focus/FocusTimelinePanel";
import { InteractionAnchorPanel } from "./interaction/InteractionAnchorPanel";
import { ActorPathPanel } from "./path/ActorPathPanel";
import { PathEventPanel } from "./path/PathEventPanel";
import { ConfigPanelToggle } from "./ConfigPanelToggle";
import { FrameManifestImporter } from "./reference/FrameManifestImporter";

type TemporalTool = "dialogue" | "focus" | "interaction" | "actor-path" | "path-event" | "frame-reference";

const TEMPORAL_TOOLS: ReadonlyArray<{ id: TemporalTool; label: string }> = [
  { id: "dialogue", label: "对白" },
  { id: "focus", label: "焦点" },
  { id: "interaction", label: "接触" },
  { id: "actor-path", label: "人物路径" },
  { id: "path-event", label: "路径事件" },
  { id: "frame-reference", label: "参考帧" },
];

function renderTemporalTool(tool: TemporalTool) {
  if (tool === "dialogue") return <DialogueTimelinePanel />;
  if (tool === "focus") return <FocusTimelinePanel />;
  if (tool === "interaction") return <InteractionAnchorPanel />;
  if (tool === "actor-path") return <ActorPathPanel />;
  if (tool === "frame-reference") return <FrameManifestImporter />;
  return <PathEventPanel />;
}

export function TemporalToolsInspector() {
  const [activeTool, setActiveTool] = useState<TemporalTool>("dialogue");
  const [expanded, setExpanded] = useState(true);
  const contentId = "temporal-tools-content";

  return (
    <section className="temporal-tools" aria-labelledby="temporal-tools-title">
      <div className="temporal-tools-header">
        <div>
          <p className="kicker">Temporal tools</p>
          <h2 id="temporal-tools-title">时间工具</h2>
        </div>
        <div className="temporal-tools-actions">
          <span className="revision-badge">上下文面板</span>
          <ConfigPanelToggle expanded={expanded} controls={contentId} expandedLabel="收起时间工具" collapsedLabel="展开时间工具" onToggle={() => setExpanded((value) => !value)} />
        </div>
      </div>

      <div id={contentId} className="temporal-tools-content" hidden={!expanded}>
        <div className="temporal-tool-tabs" role="tablist" aria-label="时间工具">
          {TEMPORAL_TOOLS.map((tool) => (
            <button
              key={tool.id}
              id={`temporal-tool-tab-${tool.id}`}
              type="button"
              role="tab"
              aria-selected={activeTool === tool.id}
              aria-controls={`temporal-tool-panel-${tool.id}`}
              tabIndex={activeTool === tool.id ? 0 : -1}
              className={activeTool === tool.id ? "active" : ""}
              onClick={() => setActiveTool(tool.id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const currentIndex = TEMPORAL_TOOLS.findIndex((item) => item.id === tool.id);
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? TEMPORAL_TOOLS.length - 1
                    : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + TEMPORAL_TOOLS.length) % TEMPORAL_TOOLS.length;
                const nextTool = TEMPORAL_TOOLS[nextIndex];
                setActiveTool(nextTool.id);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#temporal-tool-tab-${nextTool.id}`)?.focus();
              }}
            >
              {tool.label}
            </button>
          ))}
        </div>

        <div className="temporal-tool-panel">
          {TEMPORAL_TOOLS.map((tool) => (
            <div
              key={tool.id}
              id={`temporal-tool-panel-${tool.id}`}
              className="temporal-tool-content"
              role={activeTool === tool.id ? "tabpanel" : undefined}
              aria-labelledby={activeTool === tool.id ? `temporal-tool-tab-${tool.id}` : undefined}
              hidden={activeTool !== tool.id}
            >
              {renderTemporalTool(tool.id)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
