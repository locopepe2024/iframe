import { useEffect, useRef, useState } from "react";
import { Download, Film, Square, X } from "lucide-react";

import { useWorkbenchStore } from "../state/workbench-store";
import { activeCameraAtFrame } from "../timeline/timeline-evaluation";
import { currentDirectorShotPackage } from "./current-shot-package";
import { recordWhiteModelVideo } from "./record-white-model-video";
import { directorDesignApi } from "@/lib/directorDesign";

interface VideoResult { url: string; blob: Blob; extension: "webm" | "mp4"; signature: string; snapshotId: string; packageChecksum: string; fps: number; durationSeconds: number; mediaId: string | null; }

function recordingSignature(state: ReturnType<typeof useWorkbenchStore.getState>): string {
  return JSON.stringify({
    crowdGroups: state.crowdGroups, characters: state.characters, sceneObjects: state.sceneObjects, renderScene: state.renderScene,
    cameras: state.cameras, actorPaths: state.actorPaths, cameraPaths: state.cameraPaths,
    dialogueTimeline: state.dialogueTimeline, selectedCameraId: state.selectedCameraId,
  });
}

function recordingSnapshotId(signature: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `director-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function aspectValue(aspectRatio: string): number {
  if (aspectRatio === "auto") return 16 / 9;
  const [width, height] = aspectRatio.split(":").map(Number);
  return width / height;
}

export function WhiteModelVideoRecorder({ recording, setRecording, stopPlayback }: {
  recording: boolean;
  setRecording: (recording: boolean) => void;
  stopPlayback: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentSignature = useWorkbenchStore(recordingSignature);
  const stale = result !== null && result.signature !== currentSignature;
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<string | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (resultRef.current) URL.revokeObjectURL(resultRef.current);
  }, []);

  const start = async () => {
    if (recording || abortRef.current) return;
    const state = useWorkbenchStore.getState();
    if (state.rigAdmissionStatus !== "passed") {
      setError("白模尚未加载完成，无法录制。");
      return;
    }
    const fps = Math.min(30, state.dialogueTimeline.fps);
    const frameCount = Math.round(state.dialogueTimeline.durationSeconds * fps) + 1;
    if (state.dialogueTimeline.durationSeconds > 10) {
      setError("单次录制最长 10 秒；请先缩短时间轴时长。");
      return;
    }
    const first = currentDirectorShotPackage(state, 1);
    const aspect = aspectValue(first.aspectRatio);
    const authoredFrameCount = Math.round(state.dialogueTimeline.durationSeconds * state.dialogueTimeline.fps) + 1;
    for (let frame = 2; frame <= authoredFrameCount; frame += 1) {
      const cameraId = activeCameraAtFrame(state.dialogueTimeline.activeCameraTrackId, state.dialogueTimeline.tracks, frame, state.dialogueTimeline.fps, state.selectedCameraId);
      const camera = state.cameras[cameraId] ?? state.cameras[state.selectedCameraId];
      if (camera && Math.abs(aspectValue(camera.aspectRatio) - aspect) > 0.0001) {
        setError("时间线包含不同画幅的机位；请统一机位画幅后录制。");
        return;
      }
    }
    const signature = recordingSignature(state);
    const previousView = state.viewMode;
    const previousFrame = state.playheadFrame;
    const controller = new AbortController();
    abortRef.current = controller;
    stopPlayback();
    setError(null);
    setProgress(0);
    setRecording(true);
    state.setViewMode("camera");
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const source = document.querySelector<HTMLCanvasElement>("#director-viewport canvas");
      if (!source || source.width < 2 || source.height < 2) throw new Error("三维舞台尚未就绪，请稍后重试。");
      const video = await recordWhiteModelVideo({
        source, aspect, fps, frameCount,
        setFrame: (frame) => useWorkbenchStore.getState().setPlayheadFrame(Math.round((frame - 1) * state.dialogueTimeline.fps / fps) + 1),
        onProgress: setProgress,
        signal: controller.signal,
      });
      const url = URL.createObjectURL(video.blob);
      if (resultRef.current) URL.revokeObjectURL(resultRef.current);
      resultRef.current = url;
      setResult({ url, blob: video.blob, extension: video.extension, signature, snapshotId: recordingSnapshotId(signature), packageChecksum: first.packageChecksum, fps, durationSeconds: state.dialogueTimeline.durationSeconds, mediaId: null });
      setReviewOpen(true);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "录制失败。");
    } finally {
      useWorkbenchStore.getState().setPlayheadFrame(previousFrame);
      useWorkbenchStore.getState().setViewMode(previousView);
      abortRef.current = null;
      setRecording(false);
    }
  };

  const save = async () => {
    if (!result || stale || saving) return;
    setSaving(true); setError(null);
    try {
      const bundle = useWorkbenchStore.getState().exportDirectorDesignBundle();
      if (bundle.sourcePackageChecksum !== result.packageChecksum) throw new Error("设计包首帧已变化，请重新录制。");
      const bundleAsset = await directorDesignApi.saveReferenceAsset(new Blob([JSON.stringify(bundle)], { type: "application/json" }), `director-design-${bundle.sourcePackageChecksum}.json`, "design_bundle", bundle.sourcePackageChecksum);
      if (recordingSignature(useWorkbenchStore.getState()) !== result.signature) throw new Error("保存期间导演设置已变化，请重新录制。");
      const saved = await directorDesignApi.saveReferenceAsset(result.blob, `director-camera-${result.snapshotId}.${result.extension}`, "camera_motion_video", result.packageChecksum, {
        designBundleMediaId: bundleAsset.mediaId, snapshotId: result.snapshotId, fps: result.fps,
        durationSeconds: result.durationSeconds, referenceImageMediaId: bundle.authoring.designSource?.mediaId ?? null,
      });
      setResult((current) => current?.snapshotId === result.snapshotId ? { ...current, mediaId: saved.mediaId } : current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存视频失败。"); }
    finally { setSaving(false); }
  };

  return <div className="white-model-video-recorder">
    <div className="white-model-video-actions">
      {recording
        ? <button type="button" onClick={() => abortRef.current?.abort()}><Square size={15} aria-hidden="true"/>停止录制</button>
        : <button type="button" onClick={() => void start()}><Film size={16} aria-hidden="true"/>录制白模视频</button>}
      {result && <a href={result.url} download={`director-reference.${result.extension}`} title="下载白模参考视频"><Download size={16} aria-hidden="true"/>下载</a>}
      {result && <button type="button" onClick={() => setReviewOpen(true)}>查看视频</button>}
      {result && <button type="button" onClick={() => void save()} disabled={stale || saving || Boolean(result.mediaId)}>{saving ? "保存中…" : result.mediaId ? "已保存" : "保存视频到素材库"}</button>}
      {result?.mediaId && <span>素材 ID {result.mediaId}</span>}
      {result && <span>录制快照 {result.snapshotId} · package {result.packageChecksum}</span>}
      {stale && <span role="status">当前导演设置已变化，视频为旧版本；请重新录制。</span>}
      {recording && <span role="status">录制中 · {progress} 帧</span>}
      {error && <span role="alert">{error}</span>}
    </div>
    {result && reviewOpen && <div className="white-model-video-overlay" role="presentation" onClick={() => setReviewOpen(false)}>
      <section className="white-model-video-dialog" role="dialog" aria-modal="true" aria-label="白模运镜参考视频" onClick={(event) => event.stopPropagation()}>
        <div className="white-model-video-dialog-header"><strong>白模运镜参考视频</strong><button type="button" aria-label="关闭视频预览" onClick={() => setReviewOpen(false)}><X size={17} aria-hidden="true"/></button></div>
        {stale && <p role="status">当前导演设置已变化，视频为旧版本；请重新录制。</p>}
        <video controls autoPlay playsInline src={result.url} aria-label="白模运镜参考视频"/>
        <a href={result.url} download={`director-reference.${result.extension}`}><Download size={16} aria-hidden="true"/>下载视频</a>
      </section>
    </div>}
  </div>;
}
