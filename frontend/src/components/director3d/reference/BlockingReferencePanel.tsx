import { useState } from "react";

import { projectDirectorShotPackage } from "./director-shot-package";
import { useWorkbenchStore } from "../state/workbench-store";

interface BlockingReferenceResult {
  dataUrl: string;
  frame: number;
  cameraLabel: string;
  packageChecksum: string;
}

function currentPackage() {
  const state = useWorkbenchStore.getState();
  return projectDirectorShotPackage({
    frame: state.playheadFrame,
    durationSeconds: state.dialogueTimeline.durationSeconds,
    fps: state.dialogueTimeline.fps,
    tracks: state.dialogueTimeline.tracks,
    activeCameraTrackId: state.dialogueTimeline.activeCameraTrackId,
    selectedCameraId: state.selectedCameraId,
    characters: state.characters,
    cameras: state.cameras,
    sceneObjects: state.sceneObjects,
    actorPaths: state.actorPaths,
    cameraPaths: state.cameraPaths,
  });
}

export function BlockingReferencePanel() {
  const [result, setResult] = useState<BlockingReferenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capture = () => {
    setError(null);
    try {
      const canvas = document.querySelector<HTMLCanvasElement>("#director-viewport canvas");
      if (!canvas || canvas.width < 2 || canvas.height < 2) throw new Error("三维舞台尚未就绪，请稍后重试。");
      const shot = currentPackage();
      setResult({
        dataUrl: canvas.toDataURL("image/png"),
        frame: shot.frame,
        cameraLabel: shot.camera.label,
        packageChecksum: shot.packageChecksum,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "占位图导出失败。");
    }
  };
  const download = () => {
    if (!result) return;
    const link = document.createElement("a");
    link.href = result.dataUrl;
    link.download = `director-blocking-frame-${result.frame}.png`;
    link.click();
  };
  return <section className="blocking-reference-panel" aria-labelledby="blocking-reference-title">
    <div className="dialogue-heading"><div><p className="kicker">Blocking reference</p><h3 id="blocking-reference-title">占位图</h3></div><span className="revision-badge">浏览器参考</span></div>
    <p>导出当前视口的站位与构图参考。它记录三维空间关系，不代表米制深度结果。</p>
    <div className="blocking-reference-actions"><button type="button" onClick={capture}>导出当前占位图</button>{result && <button type="button" className="secondary" onClick={download}>下载 PNG</button>}</div>
    {result && <div className="blocking-reference-result"><img src={result.dataUrl} alt={`第 ${result.frame} 帧占位参考图，${result.cameraLabel}`} /><dl><div><dt>帧</dt><dd>{result.frame}</dd></div><div><dt>机位</dt><dd>{result.cameraLabel}</dd></div><div><dt>package</dt><dd>{result.packageChecksum}</dd></div></dl><small>浏览器占位参考 · 米制深度请使用“深度”工具提交。</small></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
