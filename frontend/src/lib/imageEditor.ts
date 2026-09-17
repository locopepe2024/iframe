import axios from 'axios';
import { API_URL } from './api';

export interface EditSource { reference: string; sha256: string; width: number; height: number; mime: string }
export interface SavedImageEdit { id: string; path: string; title: string; source_reference: string; source_sha256: string; sha256: string; width: number; height: number }
export const imageEditorApi = {
  async load(reference: string, signal?: AbortSignal): Promise<{ source: EditSource; blob: Blob }> {
    const { data: source } = await axios.get<EditSource>(`${API_URL}/playground/image-editor/source`, { params: { reference }, signal });
    if (!source || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Invalid image source');
    const { data: blob } = await axios.get<Blob>(`${API_URL}/playground/image-editor/preview`, {
      params: { reference, expected_sha256: source.sha256 }, responseType: 'blob', signal,
    });
    return { source, blob };
  },
  async list(): Promise<SavedImageEdit[]> {
    const { data } = await axios.get(`${API_URL}/playground/image-edits`);
    if (!Array.isArray(data)) throw new Error('Invalid image edit list');
    return data;
  },
  async save(source: EditSource, file: File, operationKey: string): Promise<SavedImageEdit> {
    const body = new FormData();
    body.append('file', file); body.append('reference', source.reference);
    body.append('source_sha256', source.sha256); body.append('operation_key', operationKey);
    const { data } = await axios.post(`${API_URL}/playground/image-edits`, body);
    if (!data?.id || !data.path?.startsWith('/playground/input-media/')) throw new Error('Invalid saved image');
    return data;
  },
};
