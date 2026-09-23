import { useState } from "react";

import { matchActionIntent, type ActionMatch } from "./action-intent";
import { useWorkbenchStore } from "../state/workbench-store";

export function ActionProposalPanel() {
  const characters = useWorkbenchStore((state) => state.characters);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const playheadFrame = useWorkbenchStore((state) => state.playheadFrame);
  const fps = useWorkbenchStore((state) => state.dialogueTimeline.fps);
  const applyActionStructure = useWorkbenchStore((state) => state.applyActionStructure);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<ActionMatch | null>(null);
  const [preview, setPreview] = useState(false);
  const [characterId, setCharacterId] = useState(selectedCharacterId);
  const [opponentId, setOpponentId] = useState("");
  const [duration, setDuration] = useState(15);
  const [startSeconds, setStartSeconds] = useState(() => (playheadFrame - 1) / fps);
  const [includeContact, setIncludeContact] = useState(false);
  const [message, setMessage] = useState("");
  const action = match?.status === "matched" ? match.candidates[0] : null;
  const actorOptions = Object.values(characters);
  const valid = Boolean(action && characters[characterId] && !characters[characterId].locked && Number.isFinite(duration) && duration >= action.durationRangeSeconds[0] && duration <= action.durationRangeSeconds[1] && Number.isFinite(startSeconds) && startSeconds >= 0 && startSeconds + duration <= 3600 && (!opponentId || opponentId !== characterId && characters[opponentId]));
  const search = () => {
    const result = matchActionIntent(query);
    setMatch(result);
    setPreview(false);
    setMessage("");
    if (result.status === "matched") setDuration(result.candidates[0].defaultDurationSeconds);
  };
  const apply = () => {
    if (!action || !valid || !preview) return;
    applyActionStructure({ actionId: action.actionId, characterId, opponentId: opponentId || null, startSeconds, durationSeconds: duration, includeContact });
    setMessage("动作结构已写入时间线，可撤销。");
    setPreview(false);
  };

  return <section className="action-proposal" aria-label="动作结构提案">
    <div className="action-proposal-heading"><strong>动作结构提案</strong><small>本地示意白模编排</small></div>
    <label>动作描述<input value={query} onChange={(event) => { setQuery(event.target.value); setMatch(null); setPreview(false); setMessage(""); }} onKeyDown={(event) => { if (event.key === "Enter") search(); }} placeholder="例如：让 A 做一段鹤形拳" /></label>
    <button type="button" onClick={search} disabled={!query.trim()}>查找动作</button>
    {match?.status === "no_match" && <p role="status">{match.limitation}</p>}
    {match?.status === "ambiguous" && <p role="status">{match.limitation}</p>}
    {action && <div className="action-proposal-detail">
      <strong>{action.label}</strong>
      <p>{action.intent.description}</p>
      <p>{match?.limitation} 匹配置信度 {Math.round(action.confidence * 100)}%。</p>
      <div className="action-proposal-fields">
        <label>执行人物<select value={characterId} onChange={(event) => { setCharacterId(event.target.value); setPreview(false); }}>{actorOptions.map((actor) => <option key={actor.characterId} value={actor.characterId} disabled={actor.locked}>{actor.label}</option>)}</select></label>
        <label>对手目标<select value={opponentId} onChange={(event) => { setOpponentId(event.target.value); setPreview(false); }}><option value="">无</option>{actorOptions.filter((actor) => actor.characterId !== characterId).map((actor) => <option key={actor.characterId} value={actor.characterId}>{actor.label}</option>)}</select></label>
        <label>起点（秒）<input type="number" min={0} max={3600} step={0.1} value={startSeconds} onChange={(event) => { setStartSeconds(Number(event.target.value)); setPreview(false); }} /></label>
        <label>时长（秒）<input type="number" min={action.durationRangeSeconds[0]} max={action.durationRangeSeconds[1]} step={0.1} value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setPreview(false); }} /></label>
      </div>
      <label className="action-proposal-check"><input type="checkbox" checked={includeContact} disabled={!opponentId} onChange={(event) => { setIncludeContact(event.target.checked); setPreview(false); }} />插入接触候选</label>
      <div className="action-proposal-actions"><button type="button" onClick={() => setPreview(true)} disabled={!valid}>预览动作</button><button type="button" onClick={apply} disabled={!preview || !valid}>应用到时间线</button><button type="button" onClick={() => { setMatch(null); setPreview(false); setMessage(""); }}>取消</button></div>
      {preview && <div className="action-proposal-preview" role="status"><strong>待应用：{action.phases.length} 段动作</strong><ol>{action.phases.map((phase) => <li key={phase.phaseId}>{phase.label} · {(startSeconds + phase.startFraction * duration).toFixed(1)} 秒</li>)}</ol><small>仅白模预览；需要人工校正。尚未更改时间线。</small></div>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
