import { useMemo, useState } from "react";
import type { DesignPreview } from "../design/design-proposal";
import { useWorkbenchStore } from "../state/workbench-store";
import { diagnoseFraming, type FramingInput, type FramingReport, type FramingRules } from "./framing-diagnostics";

export function FramingDiagnosticsPanel({ preview, disabled = false }: { preview: DesignPreview | null; disabled?: boolean }) {
  const characters = useWorkbenchStore(s => s.characters);
  const cameras = useWorkbenchStore(s => s.cameras);
  const sceneObjects = useWorkbenchStore(s => s.sceneObjects);
  const actorPaths = useWorkbenchStore(s => s.actorPaths);
  const cameraPaths = useWorkbenchStore(s => s.cameraPaths);
  const timeline = useWorkbenchStore(s => s.dialogueTimeline);
  const selectedCameraId = useWorkbenchStore(s => s.selectedCameraId);
  const sceneRootTransform = useWorkbenchStore(s => s.renderScene.sceneRootTransform);
  const input = useMemo<FramingInput>(() => {
    const source = preview?.dialogueTimeline ?? timeline;
    return { characters: preview?.characters ?? characters, cameras: preview?.cameras ?? cameras,
      sceneObjects: preview?.sceneObjects ?? sceneObjects, actorPaths, cameraPaths: preview?.cameraPaths ?? cameraPaths,
      selectedCameraId: preview?.cameraId ?? selectedCameraId, sceneRootTransform,
      durationSeconds: source.durationSeconds, fps: source.fps, tracks: source.tracks, activeCameraTrackId: source.activeCameraTrackId };
  }, [preview, characters, cameras, sceneObjects, actorPaths, cameraPaths, timeline, selectedCameraId, sceneRootTransform]);
  const [extent, setExtent] = useState<FramingRules["extent"]>("bounds");
  const [minimumHeightPercent, setMinimumHeightPercent] = useState(15);
  const [result, setResult] = useState<{ input: FramingInput; extent: FramingRules["extent"]; minimumHeightPercent: number; report: FramingReport } | null>(null);
  const stale = result && (result.input !== input || result.extent !== extent || result.minimumHeightPercent !== minimumHeightPercent);
  const report = !stale ? result?.report : null;
  const time = (frame: number) => `${((frame - 1) / input.fps).toFixed(2)} 秒（${frame}f）`;
  return <details className="design-assistant">
    <summary>镜头构图检查</summary>
    <p>{preview ? "检查未应用的设计预览。" : "检查当前设计。"}按时间线的活动机位检查其构图主体，不修改布局或机位。</p>
    <label>留框范围<select value={extent} disabled={disabled} onChange={e => setExtent(e.target.value as FramingRules["extent"])}>
      <option value="bounds">完整占位范围</option><option value="center">主体中心（允许近景裁切）</option>
    </select></label>
    <label>人物最小画面高度（%）<input type="number" min={0} max={100} step={1} value={minimumHeightPercent} disabled={disabled} onChange={e => setMinimumHeightPercent(Math.min(100, Math.max(0, Number(e.target.value))))}/></label>
    <p>人物范围按站立占位估计，不代表姿态轮廓；物体采用声明的包围盒。此检查不判断遮挡，不能确认柜台或人物是否可见。全景可降低最小高度，近景可选择主体中心。</p>
    <button type="button" disabled={disabled} onClick={() => setResult({ input, extent, minimumHeightPercent, report: diagnoseFraming(input, { extent, minimumHeightPercent }) })}>检查{preview ? "预览" : "当前设计"}构图</button>
    {stale && <p role="status">设计或检查规则已变化，请重新检查。</p>}
    {report && <div role="status">
      <p>{report.sampledFrames === report.totalFrames ? `已检查全部 ${report.totalFrames} 帧。` : `已抽查 ${report.sampledFrames} / ${report.totalFrames} 帧（含首尾），采样间隔内仍可能出画。`}</p>
      {report.subjects.length === 0 && <p>活动机位没有可检查的构图主体；请选择主体并确认其可见。</p>}
      <ul>{report.subjects.map(row => <li key={JSON.stringify([row.cameraId, row.targetId])}>
        <strong>{row.cameraLabel} · {row.label}</strong>：{row.unavailable === "missing" ? "目标缺失，未检查。" : row.unavailable === "custom_proxy" ? "自定义人物代理的范围未知，未检查。" : <>
          {row.minHeightPercent === null ? "画面高度无法估计；" : `估计画面高度 ${row.minHeightPercent.toFixed(1)}–${row.maxHeightPercent!.toFixed(1)}%；`}
          {row.firstOutsideFrame === null ? "检查帧内未发现超出留框范围。" : `首次超出留框范围：${time(row.firstOutsideFrame)}。`}
          {row.firstSmallFrame !== null && `首次低于最小画面高度：${time(row.firstSmallFrame)}。`}
        </>}
      </li>)}</ul>
    </div>}
  </details>;
}
