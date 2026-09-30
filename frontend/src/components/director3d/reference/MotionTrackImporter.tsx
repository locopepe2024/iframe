import { useRef, useState } from "react";

import { MOTION_TRACK_MAX_BYTES, parseMotionTrackManifest } from "../state/motion-track-import";
import { useWorkbenchStore } from "../state/workbench-store";

export function MotionTrackImporter() {
  const imported = useWorkbenchStore((state) => state.motionTrackImport);
  const setImportState = useWorkbenchStore((state) => state.setMotionTrackImportState);
  const clearImport = useWorkbenchStore((state) => state.clearMotionTrackImport);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setError(null);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("请选择 motion-track.v1 JSON 文件。");
      if (file.size > MOTION_TRACK_MAX_BYTES) throw new Error(`文件不能超过 ${Math.round(MOTION_TRACK_MAX_BYTES / 1024 / 1024)} MiB。`);
      const result = parseMotionTrackManifest(JSON.parse(await file.text()), { fileName: file.name });
      if (!result.ok) throw new Error(result.state.errors.join("；"));
      setImportState(result.state);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "motion-track.v1 读取失败。"); }
    finally { setReading(false); }
  };
  const manifest = imported.manifest;
  return <section className="frame-reference-importer" aria-label="motion-track 动作轨迹导入" aria-live="polite">
    <div className="frame-reference-heading"><div><p className="kicker">Motion track v1</p><strong>动作轨迹</strong><small>只读导入：显示语义关节、置信度和脚部接触候选。</small></div>{manifest && <button type="button" className="frame-reference-clear" onClick={clearImport}>清除轨迹</button>}</div>
    <input ref={inputRef} className="sr-only" type="file" accept=".json,application/json" aria-label="选择 motion-track JSON" onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    {!manifest && <div className="frame-reference-empty"><p>复刻侧负责提供轨迹；导演台暂不把脚部候选当作已确认接触。</p><button type="button" className="frame-reference-select" onClick={() => inputRef.current?.click()} disabled={reading}>{reading ? "读取中…" : "选择动作轨迹 JSON"}</button></div>}
    {(error || imported.status === "error") && <div className="frame-reference-result error"><strong>无法导入动作轨迹</strong><ul><li>{error ?? imported.errors.join("；")}</li></ul><button type="button" onClick={() => inputRef.current?.click()}>重新选择</button></div>}
    {manifest && <div className="frame-reference-result"><div className="frame-reference-summary"><strong>{manifest.trackId}</strong><span>{manifest.frames.length} 帧 · {imported.fileName}</span><small>坐标：image X→Blender X，image Y→Blender Z，depth Z→Blender Y</small></div><dl className="frame-reference-meta"><div><dt>语义关节</dt><dd>{new Set(manifest.frames.flatMap((frame) => Object.keys(frame.semanticJoints))).size} 个</dd></div><div><dt>脚部目标</dt><dd>{manifest.frames.filter((frame) => frame.footTargets.left.ankle || frame.footTargets.right.ankle).length} 帧有数据</dd></div><div><dt>接触候选</dt><dd>{manifest.frames.filter((frame) => frame.footContactCandidates.left.candidate || frame.footContactCandidates.right.candidate).length} 帧</dd></div></dl>{imported.warnings.map((warning) => <p key={warning} className="frame-reference-note">{warning}</p>)}<p className="frame-reference-note">当前仅完成契约验证与证据展示；重定向、quaternion、IK 和白模输出尚未由浏览器核心执行。</p><div className="frame-reference-actions"><button type="button" onClick={() => inputRef.current?.click()}>更换轨迹</button></div></div>}
  </section>;
}
