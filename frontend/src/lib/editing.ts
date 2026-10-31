import axios from 'axios';
import { API_URL, type AssemblyEditPlan } from './api';
export interface EditMaterial { id: string; name: string; url: string; origin?: string; sha256: string; duration_ms: number; video: boolean; audio: boolean; folder_id?: string | null; folder_name?: string | null; deletable?: boolean }
export interface EditFolder { id: string; name: string; parent_id?: string | null; created_at: number }
export interface EditProject { id: string; title: string; revision: number; plan: AssemblyEditPlan | null; sources: Record<string, EditMaterial>; output: { url: string; revision: number } | null }
// Reject SPA HTML and incompatible API payloads before they enter React state.
const contractError = () => new Error('剪辑服务返回的数据格式异常，请刷新重试 / Invalid editing API response; reload and retry');
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const array = <T>(value: unknown, valid: (item: any) => boolean): T[] => {
  if (!Array.isArray(value) || !value.every(valid)) throw contractError();
  return value;
};
const named = (value: any) => object(value) && typeof value.id === 'string' && typeof value.name === 'string';
const project = (value: unknown): EditProject => {
  if (!object(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || !Number.isInteger(value.revision) || !object(value.sources)) throw contractError();
  if (value.plan !== null && (!object(value.plan) || !Array.isArray(value.plan.lanes) || !value.plan.lanes.every((lane: any) => object(lane) && Array.isArray(lane.clips)))) throw contractError();
  return value as unknown as EditProject;
};
const projectList = (value: unknown) => array<EditProject>(value, item => { project(item); return true; });
const materialPage = (value: unknown): { items: EditMaterial[]; next_cursor: number | null } => {
  if (!object(value) || !(value.next_cursor === null || Number.isInteger(value.next_cursor))) throw contractError();
  return { items: array<EditMaterial>(value.items, named), next_cursor: value.next_cursor };
};
const base = `${API_URL}/editing`;
export const editing = {
  list: async (): Promise<EditProject[]> => projectList((await axios.get(`${base}/projects`)).data),
  create: async (title: string): Promise<EditProject> => project((await axios.post(`${base}/projects`, { title })).data),
  delete: async (id: string): Promise<{ id: string; deleted: boolean }> => (await axios.delete(`${base}/projects/${encodeURIComponent(id)}`)).data,
  get: async (id: string): Promise<EditProject> => project((await axios.get(`${base}/projects/${id}`)).data),
  folders: async (): Promise<EditFolder[]> => array<EditFolder>((await axios.get(`${base}/folders`)).data, named),
  createFolder: async (name: string, parentId?: string | null): Promise<EditFolder> => (await axios.post(`${base}/folders`, { name, parent_id: parentId || null })).data,
  renameFolder: async (id: string, name: string) => (await axios.patch(`${base}/folders/${encodeURIComponent(id)}`, { name })).data,
  moveMaterial: async (id: string, folderId: string | null) => (await axios.patch(`${base}/materials/${encodeURIComponent(id)}`, { folder_id: folderId })).data,
  deleteFolder: async (id: string) => (await axios.delete(`${base}/folders/${encodeURIComponent(id)}`)).data,
  materials: async (q = '', cursor = 0, folderId?: string | null): Promise<{ items: EditMaterial[]; next_cursor: number | null }> => materialPage((await axios.get(`${base}/materials`, { params: { q, cursor, folder_id: folderId || undefined } })).data),
  material: async (id: string): Promise<EditMaterial> => (await axios.get(`${base}/materials/${encodeURIComponent(id)}`)).data,
  upload: async (file: File, folderId?: string | null): Promise<EditMaterial> => { const data = new FormData(); data.append('file', file); return (await axios.post(`${base}/materials`, data, { params: { folder_id: folderId || undefined } })).data; },
  deleteMaterial: async (id: string) => (await axios.delete(`${base}/materials/${encodeURIComponent(id)}`)).data,
  save: async (id: string, revision: number, plan: AssemblyEditPlan): Promise<EditProject> => project((await axios.put(`${base}/projects/${id}/plan`, { revision, plan })).data),
  render: async (id: string, revision: number): Promise<EditProject> => project((await axios.post(`${base}/projects/${id}/render`, { revision }, { timeout: 660000 })).data),
  versions: async (id: string): Promise<{ revision: number }[]> => array<{ revision: number }>((await axios.get(`${base}/projects/${id}/versions`)).data, item => object(item) && Number.isInteger(item.revision)),
  restore: async (id: string, revision: number, target_revision: number): Promise<EditProject> => project((await axios.post(`${base}/projects/${id}/restore`, { revision, target_revision })).data),
  subtitles: async (id: string, lane: string): Promise<Blob> => (await axios.get(`${base}/projects/${id}/subtitles/${lane}`, { responseType: 'blob' })).data,
};
