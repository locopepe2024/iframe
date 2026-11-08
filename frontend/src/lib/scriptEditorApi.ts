import axios from 'axios';
import type { L3Result } from '@/store/editorStore';

// Reuse the same API URL detection logic as the main api.ts
const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT || '17177';

const getApiUrl = (): string => {
  const override = process.env.NEXT_PUBLIC_API_URL;
  if (override && override.trim()) {
    return override.trim().replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;

    if (process.env.NODE_ENV === 'development') {
      return `${protocol}//${hostname}:${BACKEND_PORT}`;
    }

    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
  }

  return `http://localhost:${BACKEND_PORT}`;
};

const API_BASE = getApiUrl();

export interface DocumentResponse {
  project_id?: string;
  id?: string;
  title?: string;
  content: object;
  updated_at: string | null;
}

export interface SnapshotResponse {
  project_id?: string;
  document_id?: string;
  timestamp: string;
  created_at: string;
  size_bytes: number;
}

export interface SaveDocumentResponse {
  status: 'ok';
  project_id?: string;
  id?: string;
  size_bytes: number;
  updated_at: string;
  snapshot_created: boolean;
  snapshot?: SnapshotResponse;
}

export interface ScriptDocumentResponse extends DocumentResponse {
  id: string;
  title: string;
  authoring_parent_id?: string;
  episode_number?: number;
}

export type ScriptWritingMode = 'expand_outline' | 'continue';

export interface ScriptWritingJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: { draft: string; mode: ScriptWritingMode; title: string } | null;
  error?: string | null;
}

export interface WritingEpisodeOutline {
  source_excerpt?: string;
  number: number;
  title: string;
  outline: string;
  opening_state: string;
  ending_state: string;
  characters: string;
  target_word_count: number;
}

export interface WritingPlanDraft {
  background: string;
  style: string;
  point_of_view: string;
  characters: string;
  constraints: string;
  missing_information: string[];
  suggestions: string[];
  episodes: WritingEpisodeOutline[];
}

export interface WritingPlan extends Omit<WritingPlanDraft, 'episodes'> {
  revision: string;
  source_hash: string;
  episodes: Array<WritingEpisodeOutline & { document_id: string; word_count: number }>;
}

export interface WritingWorkspace {
  root_document_id: string;
  root_title: string;
  selected_episode_number: number | null;
  source_text: string;
  source_hash: string;
  source_changed: boolean;
  plan: WritingPlan | null;
}

export interface OutlineAnalysisJob {
  id: string;
  status: ScriptWritingJob['status'];
  result?: { draft: WritingPlanDraft; source_hash: string } | null;
  error?: string | null;
}

export const scriptEditorApi = {
  getWritingPlan: async (documentId: string): Promise<WritingWorkspace> => {
    return (await axios.get(`${API_BASE}/script-documents/${documentId}/writing-plan`)).data;
  },
  confirmWritingPlan: async (documentId: string, data: { draft: WritingPlanDraft; base_revision: string | null; source_hash: string }): Promise<WritingWorkspace> => {
    return (await axios.put(`${API_BASE}/script-documents/${documentId}/writing-plan`, data)).data;
  },
  startOutlineAnalysis: async (documentId: string): Promise<OutlineAnalysisJob> => {
    return (await axios.post(`${API_BASE}/script-documents/${documentId}/outline-analysis`)).data;
  },
  getOutlineAnalysisJob: async (documentId: string, jobId: string): Promise<OutlineAnalysisJob> => {
    return (await axios.get(`${API_BASE}/script-documents/${documentId}/outline-analysis/jobs/${jobId}`)).data;
  },
  /** Independent authoring documents */
  createScriptDocument: async (title: string, content?: object): Promise<ScriptDocumentResponse> => {
    const res = await axios.post(`${API_BASE}/script-documents`, { title, content });
    return res.data;
  },

  listScriptDocuments: async (): Promise<Array<{ id: string; title: string; updated_at: string }>> => {
    const res = await axios.get(`${API_BASE}/script-documents`);
    return res.data;
  },

  loadScriptDocument: async (documentId: string): Promise<ScriptDocumentResponse> => {
    const res = await axios.get(`${API_BASE}/script-documents/${documentId}`);
    return res.data;
  },

  deleteScriptDocument: async (documentId: string): Promise<void> => {
    await axios.delete(`${API_BASE}/script-documents/${documentId}`);
  },

  saveScriptDocument: async (documentId: string, content: object, title?: string, createSnapshot = false): Promise<SaveDocumentResponse> => {
    const res = await axios.put(`${API_BASE}/script-documents/${documentId}`, {
      content,
      title,
      create_snapshot: createSnapshot,
    });
    return res.data;
  },

  listScriptDocumentSnapshots: async (documentId: string): Promise<SnapshotResponse[]> => {
    const res = await axios.get(`${API_BASE}/script-documents/${documentId}/snapshots`);
    return res.data;
  },

  restoreScriptDocumentSnapshot: async (documentId: string, timestamp: string): Promise<DocumentResponse> => {
    const res = await axios.post(`${API_BASE}/script-documents/${documentId}/snapshots/${timestamp}/restore`);
    return res.data;
  },

  /** 保存文档 */
  saveDocument: async (projectId: string, content: object, createSnapshot = false): Promise<SaveDocumentResponse> => {
    const res = await axios.post(`${API_BASE}/projects/${projectId}/document`, {
      content,
      create_snapshot: createSnapshot,
    });
    return res.data;
  },

  /** 加载文档 */
  loadDocument: async (projectId: string): Promise<DocumentResponse> => {
    const res = await axios.get(`${API_BASE}/projects/${projectId}/document`);
    return res.data;
  },

  /** 列出快照 */
  listSnapshots: async (projectId: string): Promise<SnapshotResponse[]> => {
    const res = await axios.get(`${API_BASE}/projects/${projectId}/document/snapshots`);
    return res.data;
  },

  /** 创建快照 */
  createSnapshot: async (projectId: string): Promise<SnapshotResponse> => {
    const res = await axios.post(`${API_BASE}/projects/${projectId}/document/snapshots`);
    return res.data;
  },

  /** 恢复快照 */
  restoreSnapshot: async (projectId: string, timestamp: string): Promise<DocumentResponse> => {
    const res = await axios.post(
      `${API_BASE}/projects/${projectId}/document/snapshots/${timestamp}/restore`
    );
    return res.data;
  },

  /** 导入文档（FDX/Fountain/TXT/DOCX → Tiptap JSON） */
  importDocument: async (file: File): Promise<any> => {
    const buffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    const fileType = ext === 'fdx' ? 'fdx' : ext === 'fountain' ? 'fountain' : ext === 'docx' ? 'docx' : 'txt';

    const res = await axios.post(`${API_BASE}/script-documents/import`, {
      filename: file.name,
      content: base64,
      file_type: fileType,
    });
    return res.data;
  },

  startScriptWriting: async (data: {
    mode: ScriptWritingMode;
    project_id?: string;
    script_document_id?: string;
    title: string;
    source_text: string;
    target_word_count: number;
    instruction?: string;
  }): Promise<ScriptWritingJob> => {
    const res = await axios.post(`${API_BASE}/script-writing/generate`, data);
    return res.data;
  },

  getScriptWritingJob: async (jobId: string, resource: { project_id?: string; script_document_id?: string }): Promise<ScriptWritingJob> => {
    const res = await axios.get(`${API_BASE}/script-writing/jobs/${jobId}`, { params: resource });
    return res.data;
  },

  importProjectDocument: async (projectId: string, file: File): Promise<any> => {
    const buffer = await file.arrayBuffer();
    const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    const fileType = ext === 'fdx' ? 'fdx' : ext === 'fountain' ? 'fountain' : ext === 'docx' ? 'docx' : 'txt';
    const res = await axios.post(`${API_BASE}/projects/${projectId}/document/import`, {
      filename: file.name,
      content: base64,
      file_type: fileType,
    });
    return res.data;
  },

  /** 导出文档（Tiptap JSON → PDF/DOCX，返回 Blob） */
  exportDocument: async (projectId: string, content: any, format: string): Promise<Blob> => {
    const res = await axios.post(
      `${API_BASE}/projects/${projectId}/document/export`,
      { content, format, options: {} },
      { responseType: 'blob' }
    );
    return res.data;
  },

  /** 同步派生数据到后端 */
  syncDerivation: async (projectId: string, data: any): Promise<void> => {
    await axios.post(`${API_BASE}/projects/${projectId}/sync_derivation`, data);
  },

  /** L3 LLM 增量补全请求 */
  deriveGaps: async (
    projectId: string,
    params: {
      already_extracted?: { scenes: string[]; characters: string[] };
      gaps?: string[]; // e.g. ['props', 'beats', 'locations']
      raw_text_blocks?: string[];
    },
    scriptDocumentId?: string,
  ): Promise<{ results?: L3Result[]; entities?: L3Result[]; task_id?: string }> => {
    const path = scriptDocumentId ? `/script-documents/${scriptDocumentId}` : `/projects/${projectId}`;
    const res = await axios.post(`${API_BASE}${path}/derive_gaps`, params);
    return res.data;
  },

  /** 确认 ShotBlock */
  confirmShotBlock: async (projectId: string, shotId: string, data: any): Promise<any> => {
    const res = await axios.post(
      `${API_BASE}/projects/${projectId}/shot_blocks/${shotId}/confirm`,
      data
    );
    return res.data;
  },
};
