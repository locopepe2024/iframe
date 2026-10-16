import { afterEach, expect, it, vi } from "vitest";

import { recordWhiteModelVideo } from "./record-white-model-video";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("samples each timeline frame into a video canvas and returns encoded data", async () => {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const requestFrame = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, fillRect, set fillStyle(_value: string) {} } as unknown as GPUCanvasContext);
  const stopTrack = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  vi.spyOn(HTMLCanvasElement.prototype, "captureStream").mockReturnValue({ getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{ requestFrame }] } as unknown as MediaStream);
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
  expect(requestFrame).toHaveBeenCalledTimes(3);
  expect(result.extension).toBe("mp4");
  expect(result.blob.size).toBeGreaterThan(0);
  expect(stopTrack).toHaveBeenCalledOnce();
});

it("skips intermediate timeline frames when painting falls behind real time", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn(), set fillStyle(_value: string) {} } as unknown as GPUCanvasContext);
  vi.spyOn(HTMLCanvasElement.prototype, "captureStream").mockReturnValue({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ requestFrame: vi.fn() }] } as unknown as MediaStream);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 30));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  class Recorder {
    static isTypeSupported = () => true;
    mimeType = "video/mp4";
    state: RecordingState = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["encoded"]) }); this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const source = document.createElement("canvas");
  source.width = 640;
  source.height = 360;
  const setFrame = vi.fn();
  await recordWhiteModelVideo({ source, aspect: 16 / 9, fps: 30, frameCount: 8, setFrame, onProgress: vi.fn(), signal: new AbortController().signal });
  const frames = setFrame.mock.calls.map(([frame]) => frame);
  expect(frames[0]).toBe(1);
  expect(frames.at(-1)).toBe(8);
  expect(frames.length).toBeLessThan(8);
});
