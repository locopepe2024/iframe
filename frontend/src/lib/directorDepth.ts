import axios from 'axios';
import { API_URL } from './api';
import type { DepthSnapshot } from '@/components/director3d/state/depth-snapshot';
export interface DepthTask {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed';
  frame: number; cameraLabel: string; nearM: number; farM: number; error: string | null;
}
export const directorDepthApi = {
  async capability() { return (await axios.get<{available: boolean; message: string}>(`${API_URL}/director3d/depth-capability`)).data; },
  async list() { return (await axios.get<DepthTask[]>(`${API_URL}/director3d/depth-tasks`)).data; },
  async submit(snapshot: DepthSnapshot) { return (await axios.post<DepthTask>(`${API_URL}/director3d/depth-tasks`, snapshot, {timeout: 30000})).data; },
  async get(id: string) { return (await axios.get<DepthTask>(`${API_URL}/director3d/depth-tasks/${id}`)).data; },
  async blob(id: string, kind: 'preview' | 'meters' | 'manifest') {
    return (await axios.get<Blob>(`${API_URL}/director3d/depth-tasks/${id}/outputs/${kind}`, {responseType: 'blob'})).data;
  },
};
