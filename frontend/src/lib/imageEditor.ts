import axios from 'axios';
import { API_URL, type AssetReferenceIndexEntry } from './api';

export interface EditSource { reference: string; sha256: string; width: number; height: number; mime: string }
export type ImageProjectionType = 'perspective_plane' | 'equirectangular';
export interface SavedImageEdit { id: string; media_id?: string; path: string; title: string; source_reference: string; source_sha256: string; sha256: string; width: number; height: number; projection_type?: ImageProjectionType }
export interface ImportedLibraryImage { media_id?: string; path: string; title: string; width: number; height: number; sha256: string; asset_type: string; asset_id: string; variant_id: string }
export const imageEditorApi = {
  async importLibraryVariant(entry: AssetReferenceIndexEntry, variantId: string): Promise<ImportedLibraryImage> {
    const body = new FormData();
    body.append('source_scope', entry.source_scope);
    body.append('source_container_id', entry.source_container_id || '');
    body.append('asset_type', entry.asset_type);
    body.append('asset_id', entry.asset_id);
    body.append('variant_id', variantId);
    const { data } = await axios.post<ImportedLibraryImage>(`${API_URL}/playground/image-editor/library-import`, body);
    if (!data.path?.startsWith('/playground/input-media/') || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error('Invalid library import');
    return data;
  },
  async load(reference: string, signal?: AbortSignal): Promise<{ source: EditSource; blob: Blob }> {
    const { data: source } = await axios.get<EditSource>(`${API_URL}/playground/image-editor/source`, { params: { reference }, signal });
    if (!source || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Invalid image source');
    const { data: blob } = await axios.get<Blob>(`${API_URL}/playground/image-editor/preview`, {
      params: { reference, expected_sha256: source.sha256 }, responseType: 'blob', signal,
    });
    return { source, blob };
  },
  async list(limit = 50, offset = 0): Promise<SavedImageEdit[]> {
    const { data } = await axios.get(`${API_URL}/playground/image-edits`, { params: { limit, offset } });
    if (!Array.isArray(data)) throw new Error('Invalid image edit list');
    return data;
  },
  async save(source: EditSource, file: File, operationKey: string, projectionType: ImageProjectionType = 'perspective_plane'): Promise<SavedImageEdit> {
    const body = new FormData();
    body.append('file', file); body.append('reference', source.reference);
    body.append('source_sha256', source.sha256); body.append('operation_key', operationKey);
    body.append('projection_type', projectionType);
    const { data } = await axios.post(`${API_URL}/playground/image-edits`, body);
    if (!data?.id || !data.path?.startsWith('/playground/input-media/')) throw new Error('Invalid saved image');
    return data;
  },
};
