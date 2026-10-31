import axios from 'axios';
import { API_URL, type AssemblyEditPlan } from './api';
export interface EditMaterial { id: string; name: string; url: string; origin?: string; sha256: string; duration_ms: number; video: boolean; audio: boolean; folder_id?: string | null; folder_name?: string | null; deletable?: boolean }
export interface EditFolder { id: string; name: string; parent_id?: string | null; created_at: number }
export interface EditProject { id: string; title: string; revision: number; plan: AssemblyEditPlan | null; sources: Record<string, EditMaterial>; output: { url: string; revision: number } | null }
const base = `${API_URL}/editing`;
export const editing = {
  list: async (): Promise<EditProject[]> => (await axios.get(`${base}/projects`)).data,
  create: async (title: string): Promise<EditProject> => (await axios.post(`${base}/projects`, { title })).data,
  delete: async (id: string): Promise<{ id: string; deleted: boolean }> => (await axios.delete(`${base}/projects/${encodeURIComponent(id)}`)).data,
  get: async (id: string): Promise<EditProject> => (await axios.get(`${base}/projects/${id}`)).data,
  folders: async (): Promise<EditFolder[]> => (await axios.get(`${base}/folders`)).data,
  createFolder: async (name: string, parentId?: string | null): Promise<EditFolder> => (await axios.post(`${base}/folders`, { name, parent_id: parentId || null })).data,
  renameFolder: async (id: string, name: string) => (await axios.patch(`${base}/folders/${encodeURIComponent(id)}`, { name })).data,
  moveMaterial: async (id: string, folderId: string | null) => (await axios.patch(`${base}/materials/${encodeURIComponent(id)}`, { folder_id: folderId })).data,
  deleteFolder: async (id: string) => (await axios.delete(`${base}/folders/${encodeURIComponent(id)}`)).data,
  materials: async (q = '', cursor = 0, folderId?: string | null): Promise<{ items: EditMaterial[]; next_cursor: number | null }> => (await axios.get(`${base}/materials`, { params: { q, cursor, folder_id: folderId || undefined } })).data,
  material: async (id: string): Promise<EditMaterial> => (await axios.get(`${base}/materials/${encodeURIComponent(id)}`)).data,
  upload: async (file: File, folderId?: string | null): Promise<EditMaterial> => { const data = new FormData(); data.append('file', file); return (await axios.post(`${base}/materials`, data, { params: { folder_id: folderId || undefined } })).data; },
  deleteMaterial: async (id: string) => (await axios.delete(`${base}/materials/${encodeURIComponent(id)}`)).data,
  save: async (id: string, revision: number, plan: AssemblyEditPlan): Promise<EditProject> => (await axios.put(`${base}/projects/${id}/plan`, { revision, plan })).data,
  render: async (id: string, revision: number): Promise<EditProject> => (await axios.post(`${base}/projects/${id}/render`, { revision }, { timeout: 660000 })).data,
  versions: async (id: string): Promise<{ revision: number }[]> => (await axios.get(`${base}/projects/${id}/versions`)).data,
  restore: async (id: string, revision: number, target_revision: number): Promise<EditProject> => (await axios.post(`${base}/projects/${id}/restore`, { revision, target_revision })).data,
  subtitles: async (id: string, lane: string): Promise<Blob> => (await axios.get(`${base}/projects/${id}/subtitles/${lane}`, { responseType: 'blob' })).data,
};
