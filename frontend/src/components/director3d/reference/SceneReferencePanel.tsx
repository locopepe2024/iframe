import { useEffect, useRef, useState } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import { currentDirectorShotPackage } from "./current-shot-package";
import type { DirectorShotPackage } from "./director-shot-package";

interface SceneReferenceResult {
  schemaVersion: "iframe.director3d.scene-reference.v1";
  shotPackage: DirectorShotPackage;
  image: { dataUrl: string; width: number; height: number };
  limitations: string[];
}

export function SceneReferencePanel() {
  const [result, setResult] = useState<SceneReferenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const capturing = useRef(false);
  const checksum = useWorkbenchStore((state) => currentDirectorShotPackage(state).packageChecksum);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const capture = async () => {
    if (capturing.current) return;
    capturing.current = true;
    setBusy(true);
    setError(null);
    try {
      const state = useWorkbenchStore.getState();
      if (state.viewMode !== "camera") throw new Error("请先切换到机位视图，再导出场景参考图。");
      if (state.rigAdmissionStatus !== "passed") throw new Error("白模尚未加载完成，请稍后重试。");
      const shotPackage = currentDirectorShotPackage(state);
      const panorama = shotPackage.environment.renderScene.panorama.inputId;
      const source = shotPackage.environment.panoramaSource;
      if (panorama && (!source?.environmentAllowed || source.admissionChecksum !== source.checksum || state.panoramaPreviewStatus.state !== "ready")) throw new Error("全景背景尚未就绪，请等待加载完成或移除全景后重试。");
      // Let the evaluated frame and camera reach the canvas before reading pixels.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!mounted.current) return;
      const current = useWorkbenchStore.getState();
      if (current.viewMode !== "camera" || currentDirectorShotPackage(current).packageChecksum !== shotPackage.packageChecksum) {
        throw new Error("截图期间导演设置或帧已变化，请暂停播放后重新导出。");
      }
      const canvas = document.querySelector<HTMLCanvasElement>("#director-viewport canvas");
      if (!canvas || canvas.width < 2 || canvas.height < 2) throw new Error("三维舞台尚未就绪，请稍后重试。");
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png")) throw new Error("浏览器未能生成 PNG，请重试。");
      setResult({
        schemaVersion: "iframe.director3d.scene-reference.v1",
        shotPackage,
        image: { dataUrl, width: canvas.width, height: canvas.height },
        limitations: ["浏览器机位视图参考，保留舞台辅助显示；不含 DOM 构图辅助线。", "不是米制深度结果，也不是已确认场景资产；全景背景不代表测量几何。", "米制深度需使用“深度”工具提交。"],
      });
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "场景参考图导出失败。");
    } finally {
      capturing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const stale = result !== null && result.shotPackage.packageChecksum !== checksum;
  const shot = result?.shotPackage;
  const filename = shot ? `director-scene-frame-${shot.frame}-${shot.packageChecksum.split(":")[1]}` : "";
  return <section className="blocking-reference-panel" aria-labelledby="scene-reference-title">
    <div className="dialogue-heading"><div><p className="kicker">Scene reference</p><h3 id="scene-reference-title">场景参考图</h3></div><span className="revision-badge">浏览器参考</span></div>
    <p>导出当前机位中的角色、道具和场景背景，保留舞台辅助显示。全景背景和灰色预览背景均不是米制深度结果。</p>
    <p>请切换到机位视图并暂停播放。米制深度需使用“深度”工具提交。</p>
    <div className="blocking-reference-actions">
      <button type="button" disabled={busy} onClick={() => void capture()}>{busy ? "正在导出…" : "导出当前场景参考图"}</button>
      {result && <><a href={result.image.dataUrl} download={`${filename}.png`}>下载场景 PNG</a><a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result, null, 2))}`} download={`${filename}.json`}>下载参考记录 JSON</a></>}
    </div>
    {busy && <p role="status">正在读取当前机位…</p>}
    {stale && <p role="status">当前导演设置已变化，场景参考图为旧版本；请重新导出。</p>}
    {result && shot && <div className="blocking-reference-result">
      <img src={result.image.dataUrl} alt={`第 ${shot.frame} 帧场景参考图，${shot.camera.label}`} />
      <dl><div><dt>帧</dt><dd>{shot.frame}</dd></div><div><dt>机位</dt><dd>{shot.camera.label}</dd></div><div><dt>package</dt><dd title={shot.packageChecksum}>{shot.packageChecksum}</dd></div></dl>
      <p>背景：{shot.environment.renderScene.panorama.inputId ? "全景背景" : "纯色预览背景"} · {result.image.width} × {result.image.height} · 画幅 {shot.aspectRatio}</p>
      <small>浏览器场景参考 · 不是米制深度结果，也不是已确认场景资产。JSON 包含同一 PNG 与完整镜头记录。</small>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
