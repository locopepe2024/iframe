import type { SavedImageEdit } from "@/lib/imageEditor";

export const PANORAMA_HANDOFF_KEY = "iframe.director3d.panorama-handoff.v1";

export function eligiblePanoramaHandoff(record: SavedImageEdit): boolean {
  return record.projection_type === "equirectangular" && record.panorama_quality?.status === "pass"
    && record.width > 0 && record.width === record.height * 2
    && /^\/playground\/input-media\/[^/]+$/.test(record.path) && /^[a-f0-9]{64}$/.test(record.sha256);
}

export function stagePanoramaHandoff(record: SavedImageEdit, storage: Pick<Storage, "setItem">): boolean {
  if (!eligiblePanoramaHandoff(record)) return false;
  storage.setItem(PANORAMA_HANDOFF_KEY, JSON.stringify({ inputId: record.path, checksum: record.sha256 }));
  return true;
}

export function takePanoramaHandoff(storage: Pick<Storage, "getItem" | "removeItem">): { inputId: string; checksum: string } | null {
  const raw = storage.getItem(PANORAMA_HANDOFF_KEY);
  storage.removeItem(PANORAMA_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.inputId === "string" && /^\/playground\/input-media\/[^/]+$/.test(value.inputId)
      && typeof value.checksum === "string" && /^[a-f0-9]{64}$/.test(value.checksum)
      ? { inputId: value.inputId, checksum: value.checksum } : null;
  } catch { return null; }
}
