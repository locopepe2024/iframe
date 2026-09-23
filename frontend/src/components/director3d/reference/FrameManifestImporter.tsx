import { useRef, useState } from "react";

import { FRAME_MANIFEST_MAX_BYTES, parseFrameManifest } from "../state/frame-manifest-import";
import { useWorkbenchStore } from "../state/workbench-store";

function shortChecksum(checksum: string): string {
  return checksum.length > 20 ? `${checksum.slice(0, 12)}…${checksum.slice(-8)}` : checksum;
}

export function FrameManifestImporter() {
  const imported = useWorkbenchStore((state) => state.frameManifestImport);
  const setImportState = useWorkbenchStore((state) => state.setFrameManifestImportState);
  const clearImport = useWorkbenchStore((state) => state.clearFrameManifestImport);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = () => inputRef.current?.click();
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    if (!file.name.toLowerCase().endsWith(".json")) {
      setReading(false);
      setError("请选择 .json 历史视频帧 manifest。");
      return;
    }
    if (file.size > FRAME_MANIFEST_MAX_BYTES) {
      setReading(false);
      setError(`文件不能超过 ${Math.round(FRAME_MANIFEST_MAX_BYTES / 1024 / 1024)} MiB。`);
      return;
    }
    try {
      const parsed = parseFrameManifest(JSON.parse(await file.text()), { fileName: file.name });
      if (parsed.ok) setImportState(parsed.state);
      else setError(parsed.state.errors.join("；"));
    } catch (caught) {
      setError(caught instanceof Error ? `JSON 读取失败：${caught.message}` : "JSON 读取失败。");
    } finally {
      setReading(false);
    }
  };

  return (
    <section className="frame-reference-importer" aria-label="历史视频参考帧导入" aria-live="polite">
      <div className="frame-reference-heading">
        <div><p className="kicker">Reviewed frame reference</p><strong>历史视频参考帧</strong><small>只读参考；不写入姿态、变换、接触或导出轨道。</small></div>
        {imported.manifest && <button type="button" className="frame-reference-clear" onClick={() => { setError(null); clearImport(); }} disabled={reading}>清除参考</button>}
      </div>
      <input ref={inputRef} className="sr-only" type="file" aria-label="选择历史视频帧 manifest" accept=".json,application/json" onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      {imported.status !== "ready" && <div className="frame-reference-empty">
        <p>导入复刻模块导出的 reviewed frame manifest，保留源视频 PTS 与证据帧媒体身份。</p>
        <button type="button" className="frame-reference-select" onClick={openPicker} disabled={reading}>{reading ? "读取中…" : "选择参考帧 JSON"}</button>
      </div>}
      {error && <div className="frame-reference-result error">
        <strong>无法导入参考帧</strong>
        <ul><li>{error}</li></ul>
        <button type="button" onClick={openPicker} disabled={reading}>重新选择</button>
      </div>}
      {imported.status === "ready" && imported.manifest && <div className="frame-reference-result">
        <div className="frame-reference-summary"><strong>{imported.manifest.review_state === "reviewed" ? "已审核参考" : "草稿参考"}</strong><span>{imported.manifest.manifest_id}</span><small>{imported.fileName} · {imported.manifest.frames.length} 帧 · 修订 {imported.revision}</small></div>
        <dl className="frame-reference-meta">
          <div><dt>源视频</dt><dd>{imported.manifest.source_media_id}</dd></div>
          <div><dt>checksum</dt><dd title={imported.manifest.source_checksum}>{shortChecksum(imported.manifest.source_checksum)}</dd></div>
          <div><dt>分析</dt><dd>{imported.manifest.analysis_id}</dd></div>
          <div><dt>时间基</dt><dd>{imported.manifest.time_base}</dd></div>
          <div><dt>PTS 范围</dt><dd>{imported.manifest.frames[0]?.source_pts ?? "—"} → {imported.manifest.frames.at(-1)?.source_pts ?? "—"}</dd></div>
        </dl>
        <p className="frame-reference-note">导入仅建立只读参考身份；下一步人工/Agent 姿态映射仍需单独审核。</p>
        <div className="frame-reference-actions"><button type="button" onClick={openPicker} disabled={reading}>{reading ? "读取中…" : "更换参考"}</button></div>
      </div>}
    </section>
  );
}
