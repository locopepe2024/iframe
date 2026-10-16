import { useEffect, useRef, useState } from "react";
import { Download, Film, Square, X } from "lucide-react";

import { useWorkbenchStore } from "../state/workbench-store";
import { aspectRatioValue, evaluateDirectorFrame } from "../timeline/timeline-evaluation";
import { recordWhiteModelVideo } from "./record-white-model-video";

interface VideoResult { url: string; extension: "webm" | "mp4"; }

export function WhiteModelVideoRecorder({ recording, setRecording, stopPlayback }: {
  recording: boolean;
  setRecording: (recording: boolean) => void;
  stopPlayback: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
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
    const first = evaluateDirectorFrame({
      frame: 1, durationSeconds: state.dialogueTimeline.durationSeconds, fps: state.dialogueTimeline.fps,
      tracks: state.dialogueTimeline.tracks, activeCameraTrackId: state.dialogueTimeline.activeCameraTrackId,
      selectedCameraId: state.selectedCameraId, characters: state.characters, cameras: state.cameras,
      sceneObjects: state.sceneObjects, actorPaths: state.actorPaths, cameraPaths: state.cameraPaths,
    });
    const aspect = aspectRatioValue(first.cameras[first.activeCameraId]?.aspectRatio ?? "16:9");
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
      setResult({ url, extension: video.extension });
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

  return <div className="white-model-video-recorder">
    <div className="white-model-video-actions">
      {recording
        ? <button type="button" onClick={() => abortRef.current?.abort()}><Square size={15} aria-hidden="true"/>停止录制</button>
        : <button type="button" onClick={() => void start()}><Film size={16} aria-hidden="true"/>录制白模视频</button>}
      {result && <a href={result.url} download={`director-reference.${result.extension}`} title="下载白模参考视频"><Download size={16} aria-hidden="true"/>下载</a>}
      {result && <button type="button" onClick={() => setReviewOpen(true)}>查看视频</button>}
      {recording && <span role="status">录制中 · {progress} 帧</span>}
      {error && <span role="alert">{error}</span>}
    </div>
    {result && reviewOpen && <div className="white-model-video-overlay" role="presentation" onClick={() => setReviewOpen(false)}>
      <section className="white-model-video-dialog" role="dialog" aria-modal="true" aria-label="白模运镜参考视频" onClick={(event) => event.stopPropagation()}>
        <div className="white-model-video-dialog-header"><strong>白模运镜参考视频</strong><button type="button" aria-label="关闭视频预览" onClick={() => setReviewOpen(false)}><X size={17} aria-hidden="true"/></button></div>
        <video controls autoPlay playsInline src={result.url} aria-label="白模运镜参考视频"/>
        <a href={result.url} download={`director-reference.${result.extension}`}><Download size={16} aria-hidden="true"/>下载视频</a>
      </section>
    </div>}
  </div>;
}
