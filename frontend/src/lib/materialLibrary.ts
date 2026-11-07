import axios from 'axios';
import { API_URL } from './api';
export interface MaterialVersion {
  id: string; asset_id: string; parent_version_id: string | null; title: string;
  reference: string; content_url: string; sha256: string; media_type: 'image' | 'video' | 'audio';
  created_at: number; retention_state: 'permanent';
}
export interface TemporaryMaterial {
  id: string; title: string; reference: string | null; media_type: 'image' | 'video' | 'audio';
  source_kind: string; created_at: number | null; proposed_expires_at: number | null;
  retention_state: 'legacy_review' | 'permanent'; source_reference?: string;
}
export interface MaterialInventory { items: TemporaryMaterial[]; total: number; next_offset: number | null; date_counts: Record<string, number>; diagnostics: string[]; cleanup_enabled: boolean }
export interface MaterialTrashEntry { id: string; scope: 'temporary' | 'saved'; material: TemporaryMaterial | MaterialVersion; deleted_at: number }
export interface MaterialInventoryFilters { query?: string; media_type?: string; created_after?: number; created_before?: number; timezone_name?: string; temporary_only?: boolean }
export const materialLibrary = {
  inventory: async (offset = 0, filters: MaterialInventoryFilters = {}): Promise<MaterialInventory> => {
    const { data } = await axios.get(`${API_URL}/playground/media-inventory`, { params: { offset, limit: 48, ...filters } });
    if (!data || !Array.isArray(data.items)) throw new Error('Invalid media inventory');
    return data;
  },
  list: async (): Promise<MaterialVersion[]> => {
    const { data } = await axios.get(`${API_URL}/playground/material-library`);
    if (!Array.isArray(data)) throw new Error('Invalid saved material list');
    return data;
  },
  save: async (reference: string, title: string): Promise<MaterialVersion> =>
    (await axios.post(`${API_URL}/playground/material-library`, { reference, title })).data,
  trash: async (): Promise<MaterialTrashEntry[]> => {
    const { data } = await axios.get(`${API_URL}/playground/material-trash`);
    if (!Array.isArray(data)) throw new Error('Invalid material recycle bin');
    return data;
  },
  remove: async (scope: 'temporary' | 'saved', material_id: string): Promise<MaterialTrashEntry> =>
    (await axios.post(`${API_URL}/playground/material-trash`, { scope, material_id })).data,
  restore: async (id: string): Promise<void> => { await axios.delete(`${API_URL}/playground/material-trash/${encodeURIComponent(id)}`); },
};
