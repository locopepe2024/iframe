import { useState, type FormEvent } from "react";

import { useWorkbenchStore } from "../state/workbench-store";

export function DialogueTimelinePanel() {
  const timeline = useWorkbenchStore((state) => state.dialogueTimeline);
  const characters = useWorkbenchStore((state) => state.characters);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const inputs = useWorkbenchStore((state) => state.dialogueReferenceInputs);
  const upsert = useWorkbenchStore((state) => state.upsertDialogueBeat);
  const remove = useWorkbenchStore((state) => state.removeDialogueBeat);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [startSeconds, setStartSeconds] = useState("0");
  const [endSeconds, setEndSeconds] = useState("1");
  const [deliveryHint, setDeliveryHint] = useState("");
  const [audioInputId, setAudioInputId] = useState("");
  const editingBeat = editingId ? timeline.dialogueBeats.find((beat) => beat.dialogueBeatId === editingId) ?? null : null;
  const formCharacterId = editingBeat?.characterId ?? selectedCharacterId;
  const reset = () => { setEditingId(null); setText(""); setStartSeconds("0"); setEndSeconds("1"); setDeliveryHint(""); setAudioInputId(""); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const before = timeline.dialogueBeats.length;
    upsert({ dialogueBeatId: editingId ?? undefined, characterId: formCharacterId, text, startSeconds: Number(startSeconds), endSeconds: Number(endSeconds), deliveryHint, audioInputId: audioInputId || null });
    const after = useWorkbenchStore.getState().dialogueTimeline.dialogueBeats.length;
    if (editingId || after > before) reset();
  };
  const edit = (dialogueBeatId: string) => {
    const beat = timeline.dialogueBeats.find((item) => item.dialogueBeatId === dialogueBeatId);
    if (!beat) return;
    setEditingId(beat.dialogueBeatId); setText(beat.text); setStartSeconds(String(beat.startSeconds)); setEndSeconds(String(beat.endSeconds)); setDeliveryHint(beat.deliveryHint ?? ""); setAudioInputId(beat.audioInputId ?? "");
  };
  return <section className="dialogue-timeline" aria-labelledby="dialogue-timeline-title">
    <div className="dialogue-heading"><div><p className="kicker">Dialogue tracks</p><h3 id="dialogue-timeline-title">对白与说话人</h3></div><span className="count-badge">{timeline.dialogueBeats.length}</span></div>
    <form onSubmit={submit} className="dialogue-form">
      <label htmlFor="dialogue-character"><span>说话人物</span><select id="dialogue-character" value={formCharacterId} disabled><option value={formCharacterId}>{characters[formCharacterId].label} · {formCharacterId}</option></select></label>
      <label className="dialogue-text" htmlFor="dialogue-text"><span>对白文本</span><textarea id="dialogue-text" maxLength={4000} rows={2} value={text} onChange={(event) => setText(event.target.value)} placeholder="输入该人物在这个时间段说出的内容"/></label>
      <label htmlFor="dialogue-start"><span>开始 (s)</span><input id="dialogue-start" type="number" min={0} max={timeline.durationSeconds} step={0.05} value={startSeconds} onChange={(event) => setStartSeconds(event.target.value)}/></label>
      <label htmlFor="dialogue-end"><span>结束 (s)</span><input id="dialogue-end" type="number" min={0} max={timeline.durationSeconds} step={0.05} value={endSeconds} onChange={(event) => setEndSeconds(event.target.value)}/></label>
      <label htmlFor="dialogue-delivery"><span>表演提示</span><input id="dialogue-delivery" maxLength={200} value={deliveryHint} onChange={(event) => setDeliveryHint(event.target.value)} placeholder="例如：压低声音、停顿后回答"/></label>
      <label htmlFor="dialogue-audio"><span>音频参考</span><select id="dialogue-audio" value={audioInputId} onChange={(event) => setAudioInputId(event.target.value)}><option value="">无音频参考</option>{inputs.map((input) => <option key={input.inputId} value={input.inputId}>{input.label} · {input.mediaKind}{input.durationSeconds === null ? "" : ` · ${input.durationSeconds.toFixed(1)}s`}</option>)}</select></label>
      <div className="dialogue-form-actions"><button type="submit" disabled={!text.trim()}>{editingId ? "保存对白" : "添加对白"}</button>{editingId && <button type="button" className="secondary" onClick={reset}>取消编辑</button>}</div>
    </form>
    {timeline.dialogueBeats.length === 0 ? <p className="dialogue-empty">暂无对白。新增后会自动建立该人物稳定的 speaker track。</p> : <ol className="dialogue-beat-list">{[...timeline.dialogueBeats].sort((left, right) => left.startSeconds - right.startSeconds).map((beat) => <li key={beat.dialogueBeatId}><button type="button" className="dialogue-beat-main" onClick={() => edit(beat.dialogueBeatId)}><strong>{characters[beat.characterId]?.label ?? beat.characterId}</strong><span>{beat.startSeconds.toFixed(2)}–{beat.endSeconds.toFixed(2)}s · {beat.text}</span><small>{beat.deliveryHint ?? "无表演提示"}{beat.audioInputId ? ` · ${beat.audioInputId}` : " · 无音频"}</small></button><button type="button" className="dialogue-remove" aria-label={`删除对白 ${beat.dialogueBeatId}`} onClick={() => remove(beat.dialogueBeatId)}>删除</button></li>)}</ol>}
    <p className="dialogue-status" role="status" aria-live="polite">{timeline.speakerTracks.length} 条 speaker track · {timeline.durationSeconds}s / {timeline.fps}fps</p>
  </section>;
}
