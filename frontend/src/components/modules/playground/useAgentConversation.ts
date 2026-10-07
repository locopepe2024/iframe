import { useEffect, useRef, useState } from 'react';
import { agentRequest, type ChatMessage, type ChatModel, type ChatSession } from '@/lib/api';
import { usePlaygroundStore } from './usePlaygroundStore';
import { referenceName } from './referenceMedia';
import { readCompanionSkills, COMPANION_SKILLS_STORAGE_KEY, type CompanionSkillId } from './companionSkills';

export type AgentMemory = { id: string; content: string; category: string; source_quote: string; updated_at: number };
export type MemoryCandidate = { content: string; category: string; source_session_id: string; source_message_id: string; source_quote: string };

export function useAgentConversation(enabled: boolean, sessionId: string | null) {
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const shouldLoadModels = enabled || !!sessionId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [companionSkills, setCompanionSkills] = useState<CompanionSkillId[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [memoryError, setMemoryError] = useState('');
  const active = useRef(sessionId);
  active.current = sessionId;
  const sending = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setCompanionSkills(readCompanionSkills(window.localStorage));
    setSkillsLoaded(true);
  }, []);
  useEffect(() => {
    if (!skillsLoaded) return;
    try { window.localStorage.setItem(COMPANION_SKILLS_STORAGE_KEY, JSON.stringify(companionSkills)); } catch { /* Preferences are optional. */ }
  }, [companionSkills, skillsLoaded]);
  function toggleCompanionSkill(id: CompanionSkillId) {
    setCompanionSkills(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  async function refreshMemories() {
    try {
      const result = await agentRequest<{ memories: AgentMemory[] }>('/memories');
      setMemories(result.memories);
      setMemoryError('');
    } catch (error) { setMemoryError(error instanceof Error ? error.message : '加载记忆失败'); }
  }
  async function extractMemories() {
    try {
      const result = await agentRequest<{ candidates: MemoryCandidate[] }>('/memories/extract', 'POST');
      setMemoryCandidates(result.candidates);
      setMemoryError('');
    } catch (error) { setMemoryError(error instanceof Error ? error.message : '提取候选失败'); }
  }
  async function saveMemory(candidate: MemoryCandidate) {
    try {
      await agentRequest('/memories', 'POST', candidate);
      setMemoryCandidates(current => current.filter(item => item !== candidate));
      await refreshMemories();
    } catch (error) { setMemoryError(error instanceof Error ? error.message : '保存记忆失败'); }
  }
  async function editMemory(id: string, content: string) {
    try { await agentRequest(`/memories/${id}`, 'PATCH', { content }); await refreshMemories(); }
    catch (error) { setMemoryError(error instanceof Error ? error.message : '更新记忆失败'); }
  }
  async function deleteMemory(id: string) {
    try { await agentRequest(`/memories/${id}`, 'DELETE'); await refreshMemories(); }
    catch (error) { setMemoryError(error instanceof Error ? error.message : '删除记忆失败'); }
  }
  useEffect(() => { if (enabled && companionSkills.includes('memory')) void refreshMemories(); }, [enabled, companionSkills]);
  useEffect(() => {
    const changed = () => setRevision(r => r + 1);
    window.addEventListener('lumenx:uniart-skus-changed', changed);
    return () => window.removeEventListener('lumenx:uniart-skus-changed', changed);
  }, []);
  useEffect(() => {
    if (!sessionId) { setMessages([]); setRemoteBusy(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    setLoading(true); setError(''); setMessages([]); setRemoteBusy(false);
    async function refresh() {
      try {
        const conversation = await agentRequest<{ session: ChatSession | null; messages: ChatMessage[]; busy_until: number }>(`/playground/${sessionId}`);
        if (cancelled) return;
        setMessages(conversation.messages);
        setRemoteBusy(conversation.busy_until > Date.now() / 1000);
        if (first && conversation.session) setModel(conversation.session.model);
        if (!conversation.busy_until) setError(current => current === '当前会话正在回复' ? '' : current);
      } catch (e) { if (!cancelled && first) setError(e instanceof Error ? e.message : '加载失败'); }
      finally {
        if (!cancelled) { first = false; setLoading(false); timer = setTimeout(refresh, 2500); }
      }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId]);
  useEffect(() => {
    if (!shouldLoadModels) return;
    let cancelled = false;
    setModelsLoading(true); setModelsError('');
    agentRequest<{ models: ChatModel[] }>('/models').then(catalog => {
      if (cancelled) return;
      const available = catalog.models;
      setModels(available); setModel(current => available.some(m => m.api_model_id === current) ? current : available[0]?.api_model_id || '');
    }).catch(e => { if (!cancelled) setModelsError(e instanceof Error ? e.message : '加载模型失败'); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [shouldLoadModels, revision]);
  useEffect(() => {
    if (models.length && !models.some(m => m.api_model_id === model)) setModel(models[0].api_model_id);
  }, [models, model]);
  async function removeMessage(id: string) {
    if (!sessionId) return;
    try {
      await agentRequest(`/sessions/playground-${sessionId}/messages/${id}`, 'DELETE');
      if (active.current === sessionId) setMessages(m => m.filter(x => x.id !== id));
    } catch (e) { if (active.current === sessionId) setError(e instanceof Error ? e.message : '删除失败'); }
  }
  async function send() {
    if (!sessionId || sending.current || remoteBusy || loading || modelsLoading || modelsError || !models.some(m => m.api_model_id === model)) return;
    const snapshot = usePlaygroundStore.getState();
    if (!snapshot.prompt.trim()) return;
    sending.current = true; setBusy(true); setError('');
    usePlaygroundStore.getState().setPrompt('');
    try {
      const { session } = await agentRequest<{ session: ChatSession }>('/sessions', 'POST', {
        model, playground_session_id: sessionId,
      });
      const result = await agentRequest<{ user_message: ChatMessage; assistant_message: ChatMessage }>(`/sessions/${session.id}/messages`, 'POST', {
        content: snapshot.prompt, input_media: snapshot.inputMedia,
        companion_skills: companionSkills,
        asset_names: snapshot.inputMedia.map(p => referenceName(p, snapshot.mediaNames, snapshot.history)),
      });
      if (active.current === sessionId) {
        setMessages(m => [...m.filter(x => x.id !== result.user_message.id && x.id !== result.assistant_message.id), result.user_message, result.assistant_message]);
        if (companionSkills.includes('memory')) void extractMemories();
      }
    } catch (e) {
      if (active.current === sessionId) {
        const message = e instanceof Error ? e.message : '发送失败';
        setError(message);
        if (message === '当前会话正在回复') setRemoteBusy(true);
        // The composer is intentionally cleared at submission time. A slow or
        // busy Qwen/UniArt request must not put the submitted text back into
        // the live input after the user has already cleared it (or started a
        // new draft). The submitted content remains in the session/message
        // request for retry or inspection instead of being restored into the
        // editable composer.
      }
    }
    finally { sending.current = false; setBusy(false); }
  }
  return { models, model, setModel, modelsLoading, modelsError, reloadModels: () => setRevision(r => r + 1), messages, busy: busy || remoteBusy, loading: loading || modelsLoading || !!modelsError, error, send, removeMessage, companionSkills, toggleCompanionSkill, memories, memoryCandidates, memoryError, refreshMemories, extractMemories, saveMemory, editMemory, deleteMemory };
}
