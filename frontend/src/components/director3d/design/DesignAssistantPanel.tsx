import { initializeNavigation } from "./navmesh-routing";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { directorDesignApi, type DesignTurn } from "@/lib/directorDesign";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, type DesignPreview, type DesignProposal } from "./design-proposal";

export function DesignAssistantPanel({ onPreview, previewing, disabled = false }: {
  onPreview: (preview: DesignPreview | null) => void; previewing: boolean; disabled?: boolean;
}) {
  const [navigation, setNavigation] = useState<"boxes" | "navmesh">("boxes");
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<DesignProposal | null>(null);
  const [history, setHistory] = useState<DesignTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const revision = useWorkbenchStore(designRevision);
  const stale = proposal !== null && proposal.baseRevision !== revision;
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => { if (stale || disabled) onPreview(null); }, [stale, disabled, onPreview]);

  const generate = async () => {
    if (!prompt.trim() || pending.current || disabled) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(""); setMessage(""); onPreview(null);
    const requestText = prompt.trim();
    try {
      const state = useWorkbenchStore.getState();
      const baseRevision = designRevision(state);
      const next = await directorDesignApi.propose({ prompt: requestText, baseRevision, context: designContext(state), history }, controller.signal);
      if (controller.signal.aborted) return;
      if (next.baseRevision !== baseRevision) throw new Error("设计提案与请求场景不匹配，请重试。");
      setProposal(next);
      setHistory((turns) => [...turns, { role: "user", content: requestText }, { role: "assistant", content: (next.clarification ?? next.summary).slice(0, 2000) }].slice(-8) as DesignTurn[]);
      setPrompt("");
    } catch (caught) {
      if (controller.signal.aborted) return;
      const detail = axios.isAxiosError(caught) ? caught.response?.data?.detail : null;
      setError(typeof detail === "string" ? detail : caught instanceof Error ? caught.message : "生成设计失败，请重试。");
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(false); }
    }
  };
  const preview = () => {
    if (!proposal || disabled || busy) return;
    try {
      const candidate = compileDesignProposal(useWorkbenchStore.getState(), proposal, navigation);
      onPreview(candidate); setError("");
      const waits = proposal.operations.flatMap((op) => op.kind === "crowd_motion" ? op.members.flatMap((member) => {
        const track = candidate.dialogueTimeline.tracks.find((item) => item.target.targetId === member.actorId && item.propertyKey === "transform.position_m");
        const firstMove = track?.keyframes.findIndex((key) => JSON.stringify(key.value) !== JSON.stringify(member.positionM)) ?? -1;
        const actualStart = firstMove > 0 ? track!.keyframes[firstMove - 1].timeSeconds : member.startSeconds;
        return actualStart > member.startSeconds ? [`${candidate.characters[member.actorId].label}等待 ${(actualStart - member.startSeconds).toFixed(2)} 秒`] : [];
      }) : []);
      setMessage(waits.length ? `通行避让：${waits.join("；")}。实际时间线 ${candidate.dialogueTimeline.durationSeconds.toFixed(2)} 秒。` : "");
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "设计无法预览。"); }
  };
  const apply = () => {
    if (!proposal || !previewing || disabled || busy) return;
    try {
      useWorkbenchStore.getState().applyDesignProposal(proposal, navigation);
      onPreview(null); setProposal(null); setError(""); setMessage("设计已应用，可继续输入修改，也可一步撤销。");
    } catch (caught) { onPreview(null); setError(caught instanceof Error ? caught.message : "应用失败。"); }
  };
  const cancelRequest = () => {
    pending.current?.abort(); pending.current = null; setBusy(false); setMessage("已停止生成，当前场景未修改。");
  };
  const exportBundle = () => {
    const bundle = useWorkbenchStore.getState().exportDirectorDesignBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `director3d-design-${bundle.sourcePackageChecksum.replace(/[^a-z0-9_-]/gi, "-")}.json`; anchor.click();
    URL.revokeObjectURL(url); setMessage("设计包已导出；保存到资产库仍需用户显式操作。");
  };
  const importBundle = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = useWorkbenchStore.getState().importDirectorDesignBundle(JSON.parse(String(reader.result)));
        if (!result.ok) setError(result.errors.join("；"));
        else { onPreview(null); setProposal(null); setMessage("设计包已导入，可继续调整；如需复用请再显式保存到资产库。"); setError(""); }
      } catch (caught) { setError(caught instanceof Error ? caught.message : "设计包文件无效。"); }
    };
    reader.readAsText(file);
  };
  return <section className="design-assistant" aria-labelledby="design-assistant-title">
    <div className="dialogue-heading"><h2 id="design-assistant-title">自然语言设计</h2><span className="revision-badge">场景与机位</span></div>
    <div className="blocking-reference-actions"><button type="button" onClick={exportBundle} disabled={disabled}>导出设计包</button><label className="button-like">导入设计包<input type="file" accept="application/json,.json" hidden disabled={disabled} onChange={(event) => { importBundle(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
    <label>群演寻路模式<select aria-label="群演寻路模式" value={navigation} disabled={busy || navigationLoading || disabled} onChange={async (event) => {
      const mode = event.target.value as "boxes" | "navmesh";
      onPreview(null); setMessage(""); setError("");
      if (mode === "navmesh") {
        setNavigationLoading(true);
        try { await initializeNavigation(); setNavigation(mode); }
        catch { setError("导航网格初始化失败，请重新选择；尚未使用导航网格。"); }
        finally { setNavigationLoading(false); }
      } else setNavigation(mode);
    }}><option value="boxes">方盒绕行</option><option value="navmesh">导航网格（旋转方盒代理）</option></select></label>
    {navigationLoading && <p role="status">正在加载导航网格引擎…</p>}
    <p>描述人物摆位、姿态、坐椅子、当前机位或带时长的运镜，也可以说“四秒缓慢推进”。先预览，再应用。</p>
    <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
      <label htmlFor="director-design-prompt">设计要求</label>
      <textarea id="director-design-prompt" value={prompt} maxLength={2000} rows={3} disabled={busy || disabled} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：让两个人相对站立，间隔三米；用当前机位、35mm 镜头拍摄两人。" />
      <div className="blocking-reference-actions"><button type="submit" disabled={busy || disabled || !prompt.trim()}>{busy ? "正在设计…" : "生成设计提案"}</button>{busy && <button type="button" onClick={cancelRequest}>停止生成</button>}{history.length > 0 && !busy && <button type="button" disabled={disabled} onClick={() => { setHistory([]); setProposal(null); onPreview(null); setMessage("已清空对话，场景保持当前编辑结果。"); }}>新对话</button>}</div>
    </form>
    {disabled && <p role="status">录制期间暂不可设计场景。</p>}
    {busy && <p role="status">正在根据当前场景生成提案，尚未修改舞台…</p>}
    {proposal && <div className="design-proposal">
      <h3>设计提案</h3><p>{proposal.summary}</p>
      {proposal.assumptions.length > 0 && <details open><summary>设计假设</summary><ul>{proposal.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {proposal.clarification ? <p role="status">{proposal.clarification}</p> : <>
        <p>{proposal.operations.length} 项操作。预览不会保存；应用后可拖动或输入数值继续编辑。</p>
        <ol>{proposal.operations.map((op, index) => <li key={index}>{{street_layout: "街区建筑与通道布局", crowd_motion: "群演分组与分时移动", add_camera: "新增构图机位", camera_cut: "时间线切镜", place_entity: "调整对象位置与朝向", arrange_pair: "双人相对摆位", arrange_group: "多人编号占位编排", add_box: "添加道具占位", frame_camera: "设计静态机位", dolly_camera: "调整机位距离", camera_motion: "创建带时长的运镜路径", set_pose: "设置人物姿态", seat_actor: "坐在程序化椅子参考上"}[op.kind]} · {"layoutId" in op ? op.layoutId : "cameraId" in op ? op.cameraId : "entityId" in op ? op.entityId : "actorId" in op ? op.actorId : "actorIds" in op ? op.actorIds.join(" / ") : op.members.map((member) => member.actorId).join(" / ")}{op.kind === "camera_motion" && ` · ${op.durationSeconds} 秒 · ${op.distanceM == null ? "预设距离" : `${op.distanceM} 米`}`}</li>)}</ol>
        {proposal.operations.some((op) => op.kind === "crowd_motion") && <p role="status">群演将自动绕开方盒障碍并按顺序避让，必要时增加最多 8 秒等待；请拖动预览时间检查实际反应与通行节奏。步态为程序化参考，含标准白模平地脚踝高度约束，尚无脚掌锁地。</p>}
        {proposal.operations.some((op) => op.kind === "seat_actor") && <p role="status">椅子是可编辑的程序化占位，不是真实家具资产。坐姿仅适配标准白模；手动移动后需重新检查接触。</p>}
        <div className="blocking-reference-actions"><button type="button" disabled={stale || busy || navigationLoading || disabled} onClick={preview}>预览设计</button><button type="button" disabled={stale || busy || navigationLoading || disabled || !previewing} onClick={apply}>应用设计</button>{previewing && <button type="button" onClick={() => onPreview(null)}>退出预览</button>}<button type="button" disabled={busy} onClick={() => { setProposal(null); onPreview(null); setError(""); }}>放弃提案</button></div>
      </>}
      {stale && <p role="status">场景已变化，此提案已过期；请重新生成。</p>}
    </div>}
    <small>支持无动画场景第 1 帧创建群演分组、分时直线移动、观察停留和多机位切镜，以及标准白模摆位、2–10 人编号占位编排、挥手、抱臂、思考、单膝跪姿、坐姿椅子参考和一条新的带时长机位路径。道具为几何占位；群演支持方盒绕行、人物等待避让与近似步态，含标准白模平地腿部 IK，但不含脚掌锁地、物理推搡或任意模型寻路；草图解析、躺姿、通用接触和真实家具适配尚未支持。</small>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
