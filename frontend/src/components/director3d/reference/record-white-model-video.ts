export interface WhiteModelVideoResult {
  blob: Blob;
  extension: "webm" | "mp4";
}

export interface WhiteModelVideoOptions {
  source: HTMLCanvasElement;
  aspect: number;
  fps: number;
  frameCount: number;
  setFrame: (frame: number) => void;
  onProgress: (frame: number) => void;
  signal: AbortSignal;
}

const FORMATS = [
  { mimeType: "video/mp4", extension: "mp4" as const },
  { mimeType: "video/webm;codecs=vp9", extension: "webm" as const },
  { mimeType: "video/webm;codecs=vp8", extension: "webm" as const },
];

function supportedFormat() {
  if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持视频录制。");
  const format = FORMATS.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType));
  if (!format) throw new Error("当前浏览器没有可用的视频编码格式。");
  return format;
}

function waitForPaint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("录制已取消。", "AbortError")); return; }
    let frame = 0;
    const abort = () => { cancelAnimationFrame(frame); reject(new DOMException("录制已取消。", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { signal.removeEventListener("abort", abort); resolve(); });
    });
  });
}

function waitUntil(deadline: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("录制已取消。", "AbortError")); return; }
    const delay = Math.max(0, deadline - performance.now());
    const abort = () => { clearTimeout(timer); reject(new DOMException("录制已取消。", "AbortError")); };
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function recordWhiteModelVideo(options: WhiteModelVideoOptions): Promise<WhiteModelVideoResult> {
  const { source, aspect, fps, frameCount, setFrame, onProgress, signal } = options;
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 30 || !Number.isInteger(frameCount) || frameCount < 2 || frameCount > fps * 10 + 1) {
    throw new Error("录制范围须在 10 秒、30 fps 以内。");
  }
  if (!source.captureStream) throw new Error("当前浏览器不支持画布录制。");
  const format = supportedFormat();
  const width = aspect >= 1 ? 640 : Math.max(2, Math.round(640 * aspect / 2) * 2);
  const height = aspect >= 1 ? Math.max(2, Math.round(640 / aspect / 2) * 2) : 640;
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建视频画布。");
  const stream = output.captureStream(0);
  const captureTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!captureTrack || typeof captureTrack.requestFrame !== "function") {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("当前浏览器不支持按时间轴帧录制。");
  }
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("浏览器无法启动视频编码器。");
  }
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("视频编码失败。"));
    recorder.onstop = () => chunks.length ? resolve(new Blob(chunks, { type: recorder.mimeType })) : reject(new Error("视频录制为空。"));
  });
  try {
    signal.throwIfAborted();
    setFrame(1);
    await waitForPaint(signal);
    recorder.start();
    const start = performance.now();
    let index = 0;
    while (true) {
      signal.throwIfAborted();
      context.fillStyle = "#101820";
      context.fillRect(0, 0, width, height);
      const scale = Math.min(width / source.width, height / source.height);
      const imageWidth = source.width * scale;
      const imageHeight = source.height * scale;
      context.drawImage(source, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
      captureTrack.requestFrame();
      onProgress(index + 1);
      if (index === frameCount - 1) break;
      // Keep video time aligned with the authored timeline when rendering falls behind.
      const nextIndex = Math.min(frameCount - 1, Math.max(index + 1, Math.floor((performance.now() - start) * fps / 1000)));
      await waitUntil(start + nextIndex * 1000 / fps, signal);
      index = nextIndex;
      setFrame(index + 1);
      await waitForPaint(signal);
    }
    await waitUntil(start + Math.max(1, frameCount - 1) * 1000 / fps, signal);
    recorder.stop();
    return { blob: await finished, extension: format.extension };
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    void finished.catch(() => {});
    throw error;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
