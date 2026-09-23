import { useState } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { PathEventState, PathEventType } from "../types";

export function PathEventPanel() {
  const selectedActorId = useWorkbenchStore((state) => state.selectedCharacterId);
  const actor = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const sceneObjects = useWorkbenchStore((state) => state.sceneObjects);
  const events = useWorkbenchStore((state) => state.pathEvents);
  const diagnostic = useWorkbenchStore((state) => state.pathEventDiagnostic);
  const duration = useWorkbenchStore((state) => state.dialogueTimeline.durationSeconds);
  const upsert = useWorkbenchStore((state) => state.upsertPathEvent);
  const remove = useWorkbenchStore((state) => state.removePathEvent);
  const [eventType, setEventType] = useState<PathEventType>("approach");
  const [obstacleObjectId, setObstacleObjectId] = useState("");
  const [startSeconds, setStartSeconds] = useState("1");
  const [endSeconds, setEndSeconds] = useState("2");
  const [pathParameter, setPathParameter] = useState("0.5");
  const [anchor, setAnchor] = useState<[string, string, string]>(["0", "0", "0"]);
  const [requiredJoints, setRequiredJoints] = useState("");
  const [contactMode, setContactMode] = useState<PathEventState["requiredContacts"][number]["contactMode"]>("support");
  const [releasePolicy, setReleasePolicy] = useState<PathEventState["releasePolicy"]>("at_event_end");
  const [previewLabel, setPreviewLabel] = useState("");
  const [exportMarker, setExportMarker] = useState(true);
  const submit = () => {
    const jointIds = requiredJoints.split(",").map((value) => value.trim()).filter(Boolean);
    const requiredContacts = obstacleObjectId && jointIds[0] ? [{ jointId: jointIds[0], targetObjectId: obstacleObjectId, contactMode }] : [];
    upsert({ pathId: `path-${selectedActorId}`, actorId: selectedActorId, eventType, obstacleObjectId: obstacleObjectId || null, startSeconds: Number(startSeconds), endSeconds: Number(endSeconds), pathParameter: pathParameter.trim() ? Number(pathParameter) : null, spatialAnchorM: anchor.map(Number) as [number, number, number], requiredJointIds: jointIds, requiredContacts, releasePolicy, previewLabel, exportMarker });
  };
  return (
    <section className="path-event-panel" aria-labelledby="path-event-title">
      <div className="dialogue-heading"><div><p className="kicker">Actor path events</p><h3 id="path-event-title">障碍与路径事件</h3></div><span className="revision-badge">path-{selectedActorId}</span></div>
      <p>事件只标记明确角色路径上的空间、时间、关节与接触要求；不会自动生成动作或碰撞解算。</p>
      {diagnostic && <p className="path-event-diagnostic" role="alert">{diagnostic}</p>}
      <div className="path-event-form">
        <label><span>事件类型</span><select value={eventType} onChange={(event) => setEventType(event.target.value as PathEventType)}><option value="approach">接近</option><option value="avoid">避让</option><option value="pass">经过</option><option value="vault">翻越</option><option value="take_cover">寻找掩体</option><option value="reveal">揭示</option><option value="contact">接触</option><option value="release">释放</option></select></label>
        <label><span>障碍 / 道具</span><select value={obstacleObjectId} onChange={(event) => setObstacleObjectId(event.target.value)}><option value="">无</option>{Object.values(sceneObjects).map((object) => <option key={object.sceneObjectId} value={object.sceneObjectId}>{object.label}</option>)}</select></label>
        <label><span>开始秒</span><input type="number" min="0" max={duration} step="0.1" value={startSeconds} onChange={(event) => setStartSeconds(event.target.value)}/></label>
        <label><span>结束秒</span><input type="number" min="0" max={duration} step="0.1" value={endSeconds} onChange={(event) => setEndSeconds(event.target.value)}/></label>
        <label><span>路径参数 0-1</span><input type="number" min="0" max="1" step="0.01" value={pathParameter} onChange={(event) => setPathParameter(event.target.value)}/></label>
        <label><span>所需关节（逗号分隔）</span><input value={requiredJoints} onChange={(event) => setRequiredJoints(event.target.value)} placeholder="hand_l, hand_r"/></label>
        <fieldset className="path-anchor-fields"><legend>空间锚点（米）</legend>{anchor.map((value, index) => <label key={index}><span>{["X", "Y", "Z"][index]}</span><input type="number" step="0.05" value={value} onChange={(event) => setAnchor((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as [string, string, string])}/></label>)}</fieldset>
        <label><span>首关节接触模式</span><select value={contactMode} onChange={(event) => setContactMode(event.target.value as typeof contactMode)}><option value="touch">触碰</option><option value="grip">抓握</option><option value="support">支撑</option><option value="release">释放</option></select></label>
        <label><span>释放策略</span><select value={releasePolicy} onChange={(event) => setReleasePolicy(event.target.value as typeof releasePolicy)}><option value="none">无</option><option value="at_event_end">事件结束释放</option><option value="explicit_release_event">显式释放事件</option></select></label>
        <label><span>预览标记名称</span><input maxLength={80} value={previewLabel} onChange={(event) => setPreviewLabel(event.target.value)} placeholder={eventType}/></label>
        <label className="path-export-marker"><span>写入导出标记</span><input className="director-checkbox" type="checkbox" checked={exportMarker} onChange={(event) => setExportMarker(event.target.checked)}/></label>
      </div>
      <button type="button" className="path-event-add" disabled={actor.locked} onClick={submit}>添加路径事件</button>
      {events.length > 0 && <ol className="path-event-list">{events.map((event) => <li key={event.pathEventId}><span className="path-event-swatch" style={{ background: event.previewMarker.color }}/><div><strong>{event.previewMarker.label}</strong><small>{event.actorId} · {event.eventType} · {event.startSeconds}-{event.endSeconds}s · anchor {event.spatialAnchorM.join(", ")}</small></div><button type="button" onClick={() => remove(event.pathEventId)}>删除</button></li>)}</ol>}
    </section>
  );
}
