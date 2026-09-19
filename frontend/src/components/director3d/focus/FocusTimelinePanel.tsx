import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { FocusTargetState, FocusTrackState } from "../types";

function targetKey(target: FocusTargetState) { return target.targetType === "world_point" ? "world_point:" : `${target.targetType}:${target.targetId}`; }

export function FocusTimelinePanel() {
  const timeline = useWorkbenchStore((state) => state.dialogueTimeline);
  const characters = useWorkbenchStore((state) => state.characters);
  const sceneObjects = useWorkbenchStore((state) => state.sceneObjects);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const cameras = useWorkbenchStore((state) => state.cameras);
  const selectedCameraId = useWorkbenchStore((state) => state.selectedCameraId);
  const upsert = useWorkbenchStore((state) => state.upsertFocusTrack);
  const remove = useWorkbenchStore((state) => state.removeFocusTrack);
  const options = useMemo(() => [
    ...Object.values(characters).map((character) => ({ key: `character:${character.characterId}`, label: `人物 · ${character.label}` })),
    ...Object.values(sceneObjects).map((object) => ({ key: `scene_object:${object.sceneObjectId}`, label: `物体 · ${object.label}` })),
    { key: "world_point:", label: "世界点 · 输入坐标" },
  ], [characters, sceneObjects]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState(selectedCameraId);
  useEffect(() => { if (!editingId) setCameraId(selectedCameraId); }, [editingId, selectedCameraId]);
  const [fromKey, setFromKey] = useState(`character:${selectedCharacterId}`);
  const [toKey, setToKey] = useState(`character:${selectedCharacterId}`);
  const [fromWorld, setFromWorld] = useState<[string, string, string]>(["0", "0", "1.5"]);
  const [toWorld, setToWorld] = useState<[string, string, string]>(["0", "2", "1.5"]);
  const [startSeconds, setStartSeconds] = useState("0"); const [endSeconds, setEndSeconds] = useState("1");
  const [transition, setTransition] = useState<FocusTrackState["transition"]>("ease_in_out"); const [intent, setIntent] = useState("");
  const reset = () => { setEditingId(null); setCameraId(useWorkbenchStore.getState().selectedCameraId); setFromKey(`character:${selectedCharacterId}`); setToKey(`character:${selectedCharacterId}`); setFromWorld(["0", "0", "1.5"]); setToWorld(["0", "2", "1.5"]); setStartSeconds("0"); setEndSeconds("1"); setTransition("ease_in_out"); setIntent(""); };
  const makeTarget = (key: string, coordinates: [string, string, string], side: "from" | "to"): FocusTargetState => {
    const [targetType, targetId] = key.split(":") as [FocusTargetState["targetType"], string];
    if (targetType !== "world_point") return { targetType, targetId, worldPositionM: null };
    const existing = editingId ? timeline.focusTracks.find((track) => track.focusTrackId === editingId)?.[side === "from" ? "fromTarget" : "toTarget"] : null;
    const sequence = String(timeline.focusTracks.length + 1).padStart(4, "0");
    return { targetType: "world_point", targetId: existing?.targetType === "world_point" ? existing.targetId : `world-point-focus-${sequence}-${side}`, worldPositionM: coordinates.map(Number) as [number, number, number] };
  };
  const submit = (event: FormEvent) => { event.preventDefault(); const before = timeline.focusTracks.length; upsert({ focusTrackId: editingId ?? undefined, cameraId, startSeconds: Number(startSeconds), endSeconds: Number(endSeconds), fromTarget: makeTarget(fromKey, fromWorld, "from"), toTarget: makeTarget(toKey, toWorld, "to"), transition, narrativeIntent: intent }); const after = useWorkbenchStore.getState().dialogueTimeline.focusTracks.length; if (editingId || after > before) reset(); };
  const edit = (track: FocusTrackState) => { setEditingId(track.focusTrackId); setCameraId(track.cameraId); setFromKey(targetKey(track.fromTarget)); setToKey(targetKey(track.toTarget)); if (track.fromTarget.worldPositionM) setFromWorld(track.fromTarget.worldPositionM.map(String) as [string, string, string]); if (track.toTarget.worldPositionM) setToWorld(track.toTarget.worldPositionM.map(String) as [string, string, string]); setStartSeconds(String(track.startSeconds)); setEndSeconds(String(track.endSeconds)); setTransition(track.transition); setIntent(track.narrativeIntent ?? ""); };
  const worldInputs = (side: "from" | "to", values: [string, string, string], setter: (value: [string, string, string]) => void) => <fieldset className="focus-world-fields"><legend>{side === "from" ? "起始世界点 (m)" : "目标世界点 (m)"}</legend>{(["X", "Y", "Z"] as const).map((axis, index) => <label key={axis}><span>{axis}</span><input type="number" step="0.05" value={values[index]} onChange={(event) => { const next = [...values] as [string, string, string]; next[index] = event.target.value; setter(next); }}/></label>)}</fieldset>;
  return <section className="focus-timeline" aria-labelledby="focus-timeline-title"><div className="dialogue-heading"><div><p className="kicker">Narrative focus</p><h3 id="focus-timeline-title">叙事焦点轨道</h3></div><span className="count-badge">{timeline.focusTracks.length}</span></div><p>焦点表达观众注意力，不修改机位 look-at、位置或运镜路径。</p><form className="focus-form" onSubmit={submit}><label><span>机位</span><select value={cameraId} disabled={Boolean(editingId)} onChange={(event) => setCameraId(event.target.value)}>{Object.values(cameras).map((camera) => <option key={camera.cameraId} value={camera.cameraId}>{camera.label}</option>)}</select></label><label><span>起始焦点</span><select value={fromKey} onChange={(event) => setFromKey(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><label><span>目标焦点</span><select value={toKey} onChange={(event) => setToKey(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>{fromKey === "world_point:" && worldInputs("from", fromWorld, setFromWorld)}{toKey === "world_point:" && worldInputs("to", toWorld, setToWorld)}<label><span>开始 (s)</span><input type="number" min={0} max={timeline.durationSeconds} step="0.05" value={startSeconds} onChange={(event) => setStartSeconds(event.target.value)}/></label><label><span>结束 (s)</span><input type="number" min={0} max={timeline.durationSeconds} step="0.05" value={endSeconds} onChange={(event) => setEndSeconds(event.target.value)}/></label><label><span>过渡</span><select value={transition} onChange={(event) => setTransition(event.target.value as FocusTrackState["transition"])}><option value="cut">直接切换</option><option value="linear">线性转移</option><option value="ease_in_out">缓入缓出</option></select></label><label><span>叙事意图</span><input maxLength={240} value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="例如：从说话者转向门口动静"/></label><div className="dialogue-form-actions"><button type="submit">{editingId ? "保存焦点" : "添加焦点"}</button>{editingId && <button type="button" className="secondary" onClick={reset}>取消编辑</button>}</div></form>{timeline.focusTracks.length > 0 && <ol className="focus-track-list">{timeline.focusTracks.map((track) => <li key={track.focusTrackId}><button type="button" className="dialogue-beat-main" onClick={() => edit(track)}><strong>{track.startSeconds.toFixed(2)}–{track.endSeconds.toFixed(2)}s · {track.transition}</strong><span>{track.cameraId} · {track.fromTarget.targetId} → {track.toTarget.targetId}</span><small>{track.narrativeIntent ?? "无叙事说明"}</small></button><button type="button" className="dialogue-remove" aria-label={`删除焦点轨道 ${track.focusTrackId}`} onClick={() => remove(track.focusTrackId)}>删除</button></li>)}</ol>}</section>;
}
