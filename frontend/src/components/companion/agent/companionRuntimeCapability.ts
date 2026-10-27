export type CompanionRuntimeCapability = {
  status: "checking" | "edge_ready" | "server_fallback";
  reason: string;
  memoryGb: number | null;
};

export async function detectCompanionRuntimeCapability(): Promise<CompanionRuntimeCapability> {
  const memoryGb = typeof navigator !== "undefined" && typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null : null;
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return { status: "server_fallback", reason: "当前浏览器没有 WebGPU。", memoryGb };
  }
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<GPUAdapter | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) return { status: "server_fallback", reason: "没有可用的 GPU 适配器。", memoryGb };
    const device = await adapter.requestDevice();
    device.destroy();
    if (memoryGb !== null && memoryGb < 3) return { status: "server_fallback", reason: "设备可用内存不足，使用服务端协调器。", memoryGb };
    return { status: "edge_ready", reason: "设备支持端侧协调器。", memoryGb };
  } catch {
    return { status: "server_fallback", reason: "WebGPU 初始化失败，使用服务端协调器。", memoryGb };
  }
}
