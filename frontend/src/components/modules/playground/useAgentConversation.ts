import { useEffect, useRef, useState } from 'react';
import { agentRequest, type ChatMessage, type ChatModel, type ChatSession } from '@/lib/api';
import { usePlaygroundStore } from './usePlaygroundStore';
import { referenceName } from './referenceMedia';

export function useAgentConversation(enabled: boolean, sessionId: string | null) {
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(sessionId);
  active.current = sessionId;
  const sending = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision(r => r + 1);
    window.addEventListener('lumenx:uniart-skus-changed', changed);
    return () => window.removeEventListener('lumenx:uniart-skus-changed', changed);
  }, []);
  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;
    setLoading(true); setError(''); setMessages([]);
    Promise.all([
      agentRequest<{ models: ChatModel[] }>('/models'),
      agentRequest<{ session: ChatSession | null; messages: ChatMessage[] }>(`/playground/${sessionId}`),
    ]).then(([catalog, conversation]) => {
      if (cancelled) return;
      let enabledSkus: string[] | null = null;
      try { enabledSkus = JSON.parse(localStorage.getItem('lumenx_uniart_enabled_skus') || 'null'); } catch { /* catalog default */ }
      const available = catalog.models.filter(m => !enabledSkus || enabledSkus.includes(m.id));
      setModels(available);
      setModel(conversation.session?.model || available[0]?.api_model_id || '');
      setMessages(conversation.messages);
    }).catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, sessionId, revision]);
  async function send() {
    if (!sessionId || sending.current || loading) return;
    const snapshot = usePlaygroundStore.getState();
    if (!snapshot.prompt.trim()) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const { session } = await agentRequest<{ session: ChatSession }>('/sessions', 'POST', {
        model, playground_session_id: sessionId,
      });
      const result = await agentRequest<{ user_message: ChatMessage; assistant_message: ChatMessage }>(`/sessions/${session.id}/messages`, 'POST', {
        content: snapshot.prompt, input_media: snapshot.inputMedia,
        asset_names: snapshot.inputMedia.map(p => referenceName(p, snapshot.mediaNames, snapshot.history)),
      });
      if (active.current === sessionId) {
        setMessages(m => [...m, result.user_message, result.assistant_message]);
        if (usePlaygroundStore.getState().prompt === snapshot.prompt) usePlaygroundStore.getState().setPrompt('');
      }
    } catch (e) { if (active.current === sessionId) setError(e instanceof Error ? e.message : '发送失败'); }
    finally { sending.current = false; setBusy(false); }
  }
  return { models, model, setModel, messages, busy, loading, error, send };
}
