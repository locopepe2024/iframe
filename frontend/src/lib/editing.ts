import axios from 'axios';
import { API_URL, type AssemblyEditPlan } from './api';
export interface EditMaterial { id: string; name: string; url: string; origin?: string; sha256: string; duration_ms: number; video: boolean; audio: boolean }
export interface EditProject { id: string; title: string; revision: number; plan: AssemblyEditPlan | null; sources: Record<string, EditMaterial>; output: { url: string; revision: number } | null }
const base = `${API_URL}/editing`;
export const editing = {
  list: async (): Promise<EditProject[]> => (await axios.get(`${base}/projects`)).data,
  create: async (title: string): Promise<EditProject> => (await axios.post(`${base}/projects`, { title })).data,
  get: async (id: string): Promise<EditProject> => (await axios.get(`${base}/projects/${id}`)).data,
  materials: async (q = '', cursor = 0): Promise<{ items: EditMaterial[]; next_cursor: number | null }> => (await axios.get(`${base}/materials`, { params: { q, cursor } })).data,
  material: async (id: string): Promise<EditMaterial> => (await axios.get(`${base}/materials/${encodeURIComponent(id)}`)).data,
  upload: async (file: File): Promise<EditMaterial> => { const data = new FormData(); data.append('file', file); return (await axios.post(`${base}/materials`, data)).data; },
  save: async (id: string, revision: number, plan: AssemblyEditPlan): Promise<EditProject> => (await axios.put(`${base}/projects/${id}/plan`, { revision, plan })).data,
  render: async (id: string, revision: number): Promise<EditProject> => (await axios.post(`${base}/projects/${id}/render`, { revision }, { timeout: 660000 })).data,
  versions: async (id: string): Promise<{ revision: number }[]> => (await axios.get(`${base}/projects/${id}/versions`)).data,
  restore: async (id: string, revision: number, target_revision: number): Promise<EditProject> => (await axios.post(`${base}/projects/${id}/restore`, { revision, target_revision })).data,
  subtitles: async (id: string, lane: string): Promise<Blob> => (await axios.get(`${base}/projects/${id}/subtitles/${lane}`, { responseType: 'blob' })).data,
};
