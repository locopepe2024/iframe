import { validateRecreationFrameManifest, type RecreationFrameManifest } from "@/lib/recreation";

import type { FrameManifestImportState } from "../types";

export const FRAME_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;

export function createIdleFrameManifestImportState(): FrameManifestImportState {
  return { status: "idle", fileName: null, manifest: null, revision: 0, errors: [], importedAt: null };
}

export function createFrameManifestImportErrorState(fileName: string | null, message: string, revision = 0): FrameManifestImportState {
  return { status: "error", fileName, manifest: null, revision, errors: [message], importedAt: null };
}

export interface FrameManifestParseResult {
  ok: boolean;
  state: FrameManifestImportState;
  manifest?: RecreationFrameManifest;
}

export function parseFrameManifest(input: unknown, options: { fileName?: string; revision?: number } = {}): FrameManifestParseResult {
  try {
    const manifest = validateRecreationFrameManifest(input);
    return {
      ok: true,
      manifest,
      state: {
        status: "ready",
        fileName: options.fileName ?? null,
        manifest,
        revision: options.revision ?? 0,
        errors: [],
        importedAt: new Date().toISOString(),
      },
    };
  } catch (caught) {
    return {
      ok: false,
      state: createFrameManifestImportErrorState(options.fileName ?? null, caught instanceof Error ? caught.message : "frame manifest 无法验证。", options.revision ?? 0),
    };
  }
}
