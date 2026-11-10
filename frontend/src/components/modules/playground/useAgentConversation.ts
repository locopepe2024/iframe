import { useEffect, useRef, useState } from 'react';
import { agentRequest, knowledgeRequest, type ChatMessage, type ChatModel, type ChatSession } from '@/lib/api';
import { usePlaygroundStore } from './usePlaygroundStore';
import { selectMentionedReferences, referenceName } from './referenceMedia';
import { readCompanionSkills, COMPANION_SKILLS_STORAGE_KEY, type CompanionSkillId } from './companionSkills';

export function requestsCurrentInformation(content: string): boolean {
  return /截至目前|截止目前|截至今天|截止今天|至今|到今天|今年|最近一年/.test(content)
    && /资讯|新闻|公告|研究|分析|近况|动态|运营|经营/.test(content);
}

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
  const [knowledgeSearch, setKnowledgeSearch] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [liveResearch, setLiveResearch] = useState(false);
  const [liveResearchAvailable, setLiveResearchAvailable] = useState(false);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const active = useRef(sessionId);
  active.current = sessionId;
  const sending = useRef(false);
  const lastSubmittedAt = useRef(0);
  const failedMessages = useRef(new Map<string, ChatMessage[]>());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setCompanionSkills(readCompanionSkills(window.localStorage));
    setSkillsLoaded(true);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    knowledgeRequest<{ enabled: boolean }>('/research-capability')
      .then(result => { if (!cancelled) setLiveResearchAvailable(result.enabled); })
      .catch(() => { if (!cancelled) setLiveResearchAvailable(false); });
    return () => { cancelled = true; };
  }, [enabled]);
  useEffect(() => {
    if (!skillsLoaded) return;
    try { window.localStorage.setItem(COMPANION_SKILLS_STORAGE_KEY, JSON.stringify(companionSkills)); } catch { /* Preferences are optional. */ }
  }, [companionSkills, skillsLoaded]);
  function toggleCompanionSkill(id: CompanionSkillId) {
    setCompanionSkills(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  useEffect(() => {
    const changed = () => setRevision(r => r + 1);
    window.addEventListener('lumenx:uniart-skus-changed', changed);
    return () => window.removeEventListener('lumenx:uniart-skus-changed', changed);
  }, []);
  useEffect(() => {
    if (!sessionId) { setMessages([]); setRemoteBusy(false); return; }
    const currentSessionId = sessionId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    setLoading(true); setError(''); setMessages(failedMessages.current.get(currentSessionId) || []); setRemoteBusy(false);
    async function refresh() {
      const startedAt = Date.now();
      try {
        const conversation = await agentRequest<{ session: ChatSession | null; messages: ChatMessage[]; busy_until: number }>(`/playground/${currentSessionId}`);
        if (cancelled) return;
        if (!sending.current && startedAt >= lastSubmittedAt.current) {
          const failed = (failedMessages.current.get(currentSessionId) || []).filter(local => !conversation.messages.some(remote =>
            remote.role === 'user' && remote.content === local.content
            && JSON.stringify(remote.input_media || []) === JSON.stringify(local.input_media || [])
            && Math.abs((remote.created_at || 0) - (local.created_at || 0)) < 120));
          failedMessages.current.set(currentSessionId, failed);
          setMessages([...conversation.messages, ...failed]);
        }
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
  useEffect(() => {
    if (model === 'minimax-h3-ir') setKnowledgeSearch(false);
  }, [model]);
  async function removeMessage(id: string) {
    if (!sessionId) return;
    if (id.startsWith('local-')) {
      failedMessages.current.set(sessionId, (failedMessages.current.get(sessionId) || []).filter(message => message.id !== id));
      setMessages(messages => messages.filter(message => message.id !== id));
      return;
    }
    try {
      await agentRequest(`/sessions/playground-${sessionId}/messages/${id}`, 'DELETE');
      if (active.current === sessionId) setMessages(m => m.filter(x => x.id !== id));
    } catch (e) { if (active.current === sessionId) setError(e instanceof Error ? e.message : '删除失败'); }
  }
  async function send() {
    if (!sessionId || sending.current || remoteBusy || loading || modelsLoading || modelsError || !models.some(m => m.api_model_id === model)) return;
    const snapshot = usePlaygroundStore.getState();
    if (!snapshot.prompt.trim()) return;
    const { inputMedia, prompt: submittedPrompt } = selectMentionedReferences(snapshot.prompt, snapshot.inputMedia, snapshot.mediaNames, snapshot.history);
    const currentResearch = liveResearchAvailable && requestsCurrentInformation(snapshot.prompt) && model !== 'minimax-h3-ir';
    if (knowledgeSearch && model === 'minimax-h3-ir') {
      setError('H3 提示词优化模型不支持知识库检索，请切换普通 Chat 模型');
      return;
    }
    sending.current = true; setBusy(true); setError('');
    const pendingId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const assetNames = inputMedia.map(p => referenceName(p, snapshot.mediaNames, snapshot.history));
    setMessages(current => [...current, {
      id: pendingId, role: 'user', content: submittedPrompt,
      input_media: inputMedia, asset_names: assetNames,
      created_at: Date.now() / 1000, model, pending: true,
    }]);
    usePlaygroundStore.getState().setPrompt('');
    try {
      const { session } = await agentRequest<{ session: ChatSession }>('/sessions', 'POST', {
        model, playground_session_id: sessionId,
      });
      const result = await agentRequest<{ user_message: ChatMessage; assistant_message: ChatMessage }>(`/sessions/${session.id}/messages`, 'POST', {
        content: submittedPrompt, input_media: inputMedia,
        companion_skills: companionSkills,
        knowledge_search: knowledgeSearch || currentResearch,
        live_research: (knowledgeSearch && liveResearch && liveResearchAvailable) || currentResearch,
        knowledge_query: knowledgeSearch && knowledgeQuery.trim() ? knowledgeQuery.trim() : undefined,
        asset_names: assetNames,
        ...(model === 'minimax-h3-ir' ? {
          duration: typeof snapshot.parameters.duration === 'number' ? snapshot.parameters.duration : undefined,
          ratio: typeof snapshot.parameters.ratio === 'string' ? snapshot.parameters.ratio : undefined,
        } : {}),
      });
      if (active.current === sessionId) {
        lastSubmittedAt.current = Date.now();
        setMessages(m => [...m.filter(x => x.id !== pendingId && x.id !== result.user_message.id && x.id !== result.assistant_message.id), result.user_message, result.assistant_message]);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '发送失败';
      const failed: ChatMessage = { id: pendingId, role: 'user', content: submittedPrompt,
        input_media: inputMedia, asset_names: assetNames, created_at: Date.now() / 1000,
        model, pending: false, delivery_error: message };
      failedMessages.current.set(sessionId, [...(failedMessages.current.get(sessionId) || []), failed]);
      if (active.current === sessionId) {
        setMessages(m => [...m.filter(x => x.id !== pendingId), failed]);
        setError(message);
        if (message === '当前会话正在回复') setRemoteBusy(true);
      }
    }
    finally { sending.current = false; setBusy(false); }
  }
  return { models, model, setModel, modelsLoading, modelsError, reloadModels: () => setRevision(r => r + 1), messages, busy: busy || remoteBusy, loading: loading || modelsLoading || !!modelsError, error, send, removeMessage, companionSkills, toggleCompanionSkill, knowledgeSearch, setKnowledgeSearch, knowledgeQuery, setKnowledgeQuery, liveResearch, setLiveResearch, liveResearchAvailable };
}
