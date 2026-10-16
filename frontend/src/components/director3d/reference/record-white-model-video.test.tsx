import { afterEach, expect, it, vi } from "vitest";

import { recordWhiteModelVideo } from "./record-white-model-video";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("samples each timeline frame into a video canvas and returns encoded data", async () => {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, fillRect, set fillStyle(_value: string) {} } as unknown as GPUCanvasContext);
  const stopTrack = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  vi.spyOn(HTMLCanvasElement.prototype, "captureStream").mockReturnValue({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
  class Recorder {
    static isTypeSupported = () => true;
    mimeType = "video/webm;codecs=vp9";
    state: RecordingState = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["encoded"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const source = document.createElement("canvas");
  source.width = 640;
  source.height = 360;
  const setFrame = vi.fn();
  const onProgress = vi.fn();
  const result = await recordWhiteModelVideo({ source, aspect: 16 / 9, fps: 30, frameCount: 3, setFrame, onProgress, signal: new AbortController().signal });
  expect(setFrame.mock.calls.map(([frame]) => frame)).toEqual([1, 2, 3]);
  expect(onProgress.mock.calls.map(([frame]) => frame)).toEqual([1, 2, 3]);
  expect(drawImage).toHaveBeenCalledTimes(3);
  expect(result.extension).toBe("mp4");
  expect(result.blob.size).toBeGreaterThan(0);
  expect(stopTrack).toHaveBeenCalledOnce();
});
