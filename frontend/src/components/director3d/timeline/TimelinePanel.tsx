import { useEffect, useMemo, useRef, useState } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { TimelineTrackKind } from "../types";

const TRACK_LABELS: Record<TimelineTrackKind, string> = {
  character_transform: "人物变换",
  character_pose: "人物姿态",
  actor_path_progress: "人物路径进度",
  camera_transform: "机位变换",
  camera_target: "机位目标",
  camera_fov: "机位水平 FOV",
  camera_path_progress: "机位路径进度",
  object_visibility: "物体可见性",
  active_camera: "活动机位",
};

const PROPERTY_KEYS: Record<TimelineTrackKind, string> = {
  character_transform: "transform.position_m",
  character_pose: "pose.normalized_values",
  actor_path_progress: "path.progress",
  camera_transform: "transform.position_m",
  camera_target: "camera.target",
  camera_fov: "camera.fov_deg",
  camera_path_progress: "path.progress",
  object_visibility: "visible",
  active_camera: "active_camera_id",
};

export function TimelinePanel() {
  const timeline = useWorkbenchStore((state) => state.dialogueTimeline);
  const playheadFrame = useWorkbenchStore((state) => state.playheadFrame);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const selectedCameraId = useWorkbenchStore((state) => state.selectedCameraId);
  const selectedSceneObjectId = useWorkbenchStore((state) => state.selectedSceneObjectId);
  const characters = useWorkbenchStore((state) => state.characters);
  const cameras = useWorkbenchStore((state) => state.cameras);
  const sceneObjects = useWorkbenchStore((state) => state.sceneObjects);
  const actorPaths = useWorkbenchStore((state) => state.actorPaths);
  const cameraPaths = useWorkbenchStore((state) => state.cameraPaths);
  const setPlayheadFrame = useWorkbenchStore((state) => state.setPlayheadFrame);
  const setTimelineDuration = useWorkbenchStore((state) => state.setTimelineDuration);
  const setTimelineFps = useWorkbenchStore((state) => state.setTimelineFps);
  const addTimelineTrack = useWorkbenchStore((state) => state.addTimelineTrack);
  const removeTimelineTrack = useWorkbenchStore((state) => state.removeTimelineTrack);
  const upsertTimelineKeyframe = useWorkbenchStore((state) => state.upsertTimelineKeyframe);
  const moveTimelineKeyframe = useWorkbenchStore((state) => state.moveTimelineKeyframe);
  const copyTimelineKeyframe = useWorkbenchStore((state) => state.copyTimelineKeyframe);
  const removeTimelineKeyframe = useWorkbenchStore((state) => state.removeTimelineKeyframe);
  const setActiveCameraTrack = useWorkbenchStore((state) => state.setActiveCameraTrack);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [minimized, setMinimized] = useState(false);
  const [trackKind, setTrackKind] = useState<TimelineTrackKind>("character_transform");
  const lastTick = useRef<number | null>(null);
  const maximumFrame = Math.max(1, Math.round(timeline.durationSeconds * timeline.fps) + 1);

  useEffect(() => {
    if (!playing) { lastTick.current = null; return; }
    let handle = 0;
    const tick = (now: number) => {
      if (lastTick.current === null) lastTick.current = now;
      const elapsedFrames = Math.floor((now - lastTick.current) * timeline.fps / 1000);
      if (elapsedFrames < 1) { handle = requestAnimationFrame(tick); return; }
      lastTick.current += elapsedFrames * 1000 / timeline.fps;
      const current = useWorkbenchStore.getState().playheadFrame;
      if (current + elapsedFrames > maximumFrame) {
        if (loop) setPlayheadFrame(1);
        else { setPlayheadFrame(maximumFrame); setPlaying(false); return; }
      } else setPlayheadFrame(current + elapsedFrames);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [loop, maximumFrame, playing, setPlayheadFrame, timeline.fps]);

  const target = useMemo(() => {
    if (trackKind === "active_camera") return { targetType: "timeline" as const, targetId: timeline.timelineId };
    if (trackKind.startsWith("camera_")) {
      if (trackKind === "camera_path_progress") return { targetType: "path" as const, targetId: cameraPaths[`path-${selectedCameraId}-motion`]?.pathId ?? "" };
      return { targetType: "camera" as const, targetId: selectedCameraId };
    }
    if (trackKind === "actor_path_progress") return { targetType: "path" as const, targetId: actorPaths[`path-${selectedCharacterId}`]?.pathId ?? "" };
    if (trackKind === "object_visibility") return { targetType: "scene_object" as const, targetId: selectedSceneObjectId ?? "" };
    return { targetType: "character" as const, targetId: selectedCharacterId };
  }, [actorPaths, cameraPaths, selectedCameraId, selectedCharacterId, selectedSceneObjectId, timeline.timelineId, trackKind]);

  const addTrack = () => {
    if (!target.targetId) return;
    addTimelineTrack({ trackKind, ...target, propertyKey: PROPERTY_KEYS[trackKind] });
  };
  const addKeyframe = (trackId: string) => {
    const track = timeline.tracks.find((item) => item.trackId === trackId);
    if (!track) return;
    let value: unknown = 0;
    if (track.trackKind === "active_camera") value = selectedCameraId;
    else if (track.trackKind === "camera_fov") value = cameras[track.target.targetId]?.fovDeg ?? 50;
    else if (track.trackKind === "camera_transform") value = cameras[track.target.targetId]?.transform.position ?? [0, 0, 0];
    else if (track.trackKind === "camera_target") { const target = cameras[track.target.targetId]?.lookAt; value = target ? { target_type: target.targetType, target_id: target.targetId } : null; }
    else if (track.trackKind === "actor_path_progress") value = Math.min(1, Math.max(0, ((playheadFrame - 1) / timeline.fps) / Math.max(0.000001, actorPaths[track.target.targetId]?.durationSeconds ?? timeline.durationSeconds)));
    else if (track.trackKind === "camera_path_progress") value = Math.min(1, Math.max(0, ((playheadFrame - 1) / timeline.fps) / Math.max(0.000001, cameraPaths[track.target.targetId]?.durationSeconds ?? timeline.durationSeconds)));
    else if (track.trackKind === "object_visibility") value = sceneObjects[track.target.targetId]?.visible ?? true;
    else if (track.trackKind === "character_transform") value = characters[track.target.targetId]?.transform.position ?? [0, 0, 0];
    else if (track.trackKind === "character_pose") value = Object.fromEntries(Object.entries(characters[track.target.targetId]?.jointRotations ?? {}).map(([jointId, rotation]) => [jointId, [rotation.x, rotation.y, rotation.z]]));
    upsertTimelineKeyframe(trackId, { timeSeconds: (playheadFrame - 1) / timeline.fps, value, interpolation: track.trackKind === "active_camera" || track.trackKind === "object_visibility" ? "step" : "linear" });
  };

  return <section className={`timeline-panel ${minimized ? "minimized" : ""}`} aria-label="有界时间线">
    <div className="timeline-heading">
      <div><p className="kicker">Timeline</p><h3>有界时间线 · {timeline.durationSeconds.toFixed(2)}s / {timeline.fps}fps</h3></div>
      <div className="timeline-actions">
        <button type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? "暂停" : "播放"}</button>
        <label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)}/> 循环</label>
        <button type="button" onClick={() => setMinimized((value) => !value)}>{minimized ? "展开" : "最小化"}</button>
      </div>
    </div>
    {!minimized && <>
      <div className="timeline-settings">
        <label>时长（秒）<input type="number" min="0.05" max="3600" step="0.05" value={timeline.durationSeconds} onChange={(event) => setTimelineDuration(Number(event.target.value))}/></label>
        <label>FPS<input type="number" min="1" max="120" step="1" value={timeline.fps} onChange={(event) => setTimelineFps(Number(event.target.value))}/></label>
        <label>缩放<input type="range" min="0.5" max="4" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}/></label>
      </div>
      <label className="timeline-scrubber"><span>播放头</span><div style={{ width: `${Math.max(100, zoom * 100)}%` }}><input type="range" min="1" max={maximumFrame} value={Math.min(playheadFrame, maximumFrame)} onChange={(event) => setPlayheadFrame(Number(event.target.value))}/></div><output>{playheadFrame}f · {((playheadFrame - 1) / timeline.fps).toFixed(2)}s</output></label>
      <div className="timeline-track-create">
        <select aria-label="轨道类型" value={trackKind} onChange={(event) => setTrackKind(event.target.value as TimelineTrackKind)}>{Object.entries(TRACK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button type="button" disabled={!target.targetId} onClick={addTrack}>添加目标轨道</button>
        {!target.targetId && <small>请先选择该类型所需的对象或创建对应路径。</small>}
      </div>
      <ol className="timeline-track-list">
        {timeline.tracks.map((track) => <li key={track.trackId}>
          <div className="timeline-track-meta"><strong>{TRACK_LABELS[track.trackKind]}{timeline.activeCameraTrackId === track.trackId ? " · 活动" : ""}</strong><small>{track.target.targetType}:{track.target.targetId} · {track.propertyKey}</small>{track.trackKind === "active_camera" && timeline.activeCameraTrackId !== track.trackId && <button type="button" onClick={() => setActiveCameraTrack(track.trackId)}>设为活动</button>}<button type="button" onClick={() => addKeyframe(track.trackId)}>当前帧加关键帧</button><button type="button" className="danger" onClick={() => removeTimelineTrack(track.trackId)}>删轨</button></div>
          <div className="timeline-keyframes">{track.keyframes.length === 0 ? <span>暂无关键帧</span> : track.keyframes.map((keyframe) => <div key={keyframe.keyframeId}>
            <button type="button" title="跳到关键帧" onClick={() => setPlayheadFrame(Math.round(keyframe.timeSeconds * timeline.fps) + 1)}>{keyframe.timeSeconds.toFixed(2)}s</button>
            <select aria-label={`${keyframe.keyframeId} 插值`} value={keyframe.interpolation} disabled={track.trackKind === "active_camera"} onChange={(event) => upsertTimelineKeyframe(track.trackId, { ...keyframe, interpolation: event.target.value as "step" | "linear" | "bezier" })}><option value="step">step</option><option value="linear">linear</option><option value="bezier">bezier</option></select>
            <button type="button" onClick={() => moveTimelineKeyframe(track.trackId, keyframe.keyframeId, (playheadFrame - 1) / timeline.fps)}>移动到播放头</button>
            <button type="button" onClick={() => copyTimelineKeyframe(track.trackId, keyframe.keyframeId, Math.min(timeline.durationSeconds, keyframe.timeSeconds + 1 / timeline.fps))}>复制 +1f</button>
            <button type="button" className="danger" onClick={() => removeTimelineKeyframe(track.trackId, keyframe.keyframeId)}>删除</button>
          </div>)}</div>
        </li>)}
      </ol>
    </>}
  </section>;
}
