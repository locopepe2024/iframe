import axios from "axios";
import { API_URL } from "./api";
import { parseDesignProposal } from "@/components/director3d/design/design-proposal";

export interface DesignTurn { role: "user" | "assistant"; content: string }
export interface DesignReferenceImage { url: string; mediaId?: string | null }
export interface DirectorReferenceAsset { mediaId: string; kind: "reference_image" | "design_bundle" | "camera_motion_video"; name: string; sha256: string; metadata: Record<string, unknown> & { sourcePackageChecksum: string } }
export const directorDesignApi = {
  async listReferenceAssets() { return (await axios.get<DirectorReferenceAsset[]>(`${API_URL}/director3d/reference-assets`)).data; },
  async readReferenceAsset(mediaId: string) { return (await axios.get<Blob>(`${API_URL}/director3d/reference-assets/${encodeURIComponent(mediaId)}/content`, { responseType: "blob" })).data; },
  async saveReferenceAsset(file: Blob, name: string, kind: "reference_image" | "design_bundle" | "camera_motion_video", sourcePackageChecksum: string, metadata: Record<string, unknown> = {}) {
    const form = new FormData();
    form.append("file", file, name);
    form.append("kind", kind);
    form.append("sourcePackageChecksum", sourcePackageChecksum);
    form.append("metadata", JSON.stringify(metadata));
    const response = await axios.post<{ mediaId: string; kind: string; sourcePackageChecksum: string }>(`${API_URL}/director3d/reference-assets`, form);
    return response.data;
  },
  async propose(request: { prompt: string; baseRevision: string; context: string; history: DesignTurn[]; referenceImage?: DesignReferenceImage | null; mode?: "edit" | "spatial_draft" }, signal?: AbortSignal) {
    const response = await axios.post<unknown>(`${API_URL}/director3d/design-proposals`, request, { timeout: 150000, signal });
    return parseDesignProposal(response.data);
  },
};
