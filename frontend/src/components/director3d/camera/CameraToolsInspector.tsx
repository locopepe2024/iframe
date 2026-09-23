import { useState } from "react";

import { CameraCompositionPanel } from "./CameraCompositionPanel";
import { CameraNoisePanel } from "./CameraNoisePanel";
import { CameraPathPresetPanel } from "./CameraPathPresetPanel";

type CameraTool = "composition" | "motion" | "noise";

const CAMERA_TOOLS: ReadonlyArray<{ id: CameraTool; label: string }> = [
  { id: "composition", label: "构图" },
  { id: "motion", label: "运镜" },
  { id: "noise", label: "噪声" },
];

export function CameraToolsInspector() {
  const [activeTool, setActiveTool] = useState<CameraTool>("composition");

  return (
    <aside className="inspector-panel camera-tools-inspector" aria-labelledby="camera-tools-title">
      <div className="camera-tools-header">
        <div className="section-heading">
          <div>
            <p className="kicker">Camera tools</p>
            <h2 id="camera-tools-title">镜头工具</h2>
          </div>
          <span className="revision-badge">实时预览</span>
        </div>
        <div className="camera-tool-tabs" role="tablist" aria-label="镜头工具">
          {CAMERA_TOOLS.map((tool) => (
            <button
              key={tool.id}
              id={`camera-tool-tab-${tool.id}`}
              type="button"
              role="tab"
              aria-selected={activeTool === tool.id}
              aria-controls={`camera-tool-panel-${tool.id}`}
              tabIndex={activeTool === tool.id ? 0 : -1}
              className={activeTool === tool.id ? "active" : ""}
              onClick={() => setActiveTool(tool.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const currentIndex = CAMERA_TOOLS.findIndex((item) => item.id === tool.id);
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? CAMERA_TOOLS.length - 1
                    : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + CAMERA_TOOLS.length) % CAMERA_TOOLS.length;
                const nextTool = CAMERA_TOOLS[nextIndex];
                setActiveTool(nextTool.id);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#camera-tool-tab-${nextTool.id}`)?.focus();
              }}
            >
              {tool.label}
            </button>
          ))}
        </div>
      </div>

      <div id={`camera-tool-panel-${activeTool}`} role="tabpanel" aria-labelledby={`camera-tool-tab-${activeTool}`}>
        {activeTool === "composition" && <CameraCompositionPanel />}
        {activeTool === "motion" && <CameraPathPresetPanel />}
        {activeTool === "noise" && <CameraNoisePanel />}
      </div>
    </aside>
  );
}
