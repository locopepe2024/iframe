import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { directorDesignApi, type DesignTurn } from "@/lib/directorDesign";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, type DesignPreview, type DesignProposal } from "./design-proposal";

export function DesignAssistantPanel({ onPreview, previewing, disabled = false }: {
  onPreview: (preview: DesignPreview | null) => void; previewing: boolean; disabled?: boolean;
}) {
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
    try { onPreview(compileDesignProposal(useWorkbenchStore.getState(), proposal)); setError(""); setMessage(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "设计无法预览。"); }
  };
  const apply = () => {
    if (!proposal || !previewing || disabled || busy) return;
    try {
      useWorkbenchStore.getState().applyDesignProposal(proposal);
      onPreview(null); setProposal(null); setError(""); setMessage("设计已应用，可继续输入修改，也可一步撤销。");
    } catch (caught) { onPreview(null); setError(caught instanceof Error ? caught.message : "应用失败。"); }
  };
  const cancelRequest = () => {
    pending.current?.abort(); pending.current = null; setBusy(false); setMessage("已停止生成，当前场景未修改。");
  };
  return <section className="design-assistant" aria-labelledby="design-assistant-title">
    <div className="dialogue-heading"><h2 id="design-assistant-title">自然语言设计</h2><span className="revision-badge">静态场景</span></div>
    <p>描述人物摆位、姿态、坐椅子、当前机位或带时长的运镜，也可以说“四秒缓慢推进”。先预览，再应用。</p>
    <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
      <label htmlFor="director-design-prompt">设计要求</label>
      <textarea id="director-design-prompt" value={prompt} maxLength={2000} rows={3} disabled={busy || disabled} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：让两个人相对站立，间隔三米；用当前机位、35mm 镜头拍摄两人。" />
      <div className="blocking-reference-actions"><button type="submit" disabled={busy || disabled || !prompt.trim()}>{busy ? "正在设计…" : "生成设计提案"}</button>{busy && <button type="button" onClick={cancelRequest}>停止生成</button>}{history.length > 0 && !busy && <button type="button" disabled={disabled} onClick={() => { setHistory([]); setProposal(null); onPreview(null); setMessage("已清空对话，场景保持当前编辑结果。"); }}>新对话</button>}</div>
    </form>
    {disabled && <p role="status">录制期间暂不可设计场景。</p>}
    {busy && <p role="status">正在根据当前场景生成提案，尚未修改舞台…</p>}
    {proposal && <div className="design-proposal">
      <h3>待评审设计</h3><p>{proposal.summary}</p>
      {proposal.assumptions.length > 0 && <details open><summary>设计假设</summary><ul>{proposal.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {proposal.clarification ? <p role="status">{proposal.clarification}</p> : <>
        <p>{proposal.operations.length} 项操作。预览不会保存；应用后可拖动或输入数值继续编辑。</p>
        <ol>{proposal.operations.map((op, index) => <li key={index}>{{place_entity: "调整对象位置与朝向", arrange_pair: "双人相对摆位", arrange_group: "多人编号占位编排", add_box: "添加道具占位", frame_camera: "设计静态机位", dolly_camera: "调整机位距离", camera_motion: "创建带时长的运镜路径", set_pose: "设置人物姿态", seat_actor: "坐在程序化椅子参考上"}[op.kind]} · {"cameraId" in op ? op.cameraId : "entityId" in op ? op.entityId : "actorId" in op ? op.actorId : "actorIds" in op ? op.actorIds.join(" / ") : op.members.map((member) => member.actorId).join(" / ")}</li>)}</ol>
        {proposal.operations.some((op) => op.kind === "seat_actor") && <p role="status">椅子是可编辑的程序化占位，不是真实家具资产。坐姿仅适配标准白模；手动移动后需重新检查接触。</p>}
        <div className="blocking-reference-actions"><button type="button" disabled={stale || busy || disabled} onClick={preview}>预览设计</button><button type="button" disabled={stale || busy || disabled || !previewing} onClick={apply}>应用设计</button>{previewing && <button type="button" onClick={() => onPreview(null)}>退出预览</button>}<button type="button" disabled={busy} onClick={() => { setProposal(null); onPreview(null); setError(""); }}>放弃提案</button></div>
      </>}
      {stale && <p role="status">场景已变化，此提案已过期；请重新生成。</p>}
    </div>}
    <small>支持无动画场景第 1 帧的标准白模摆位、2–10 人编号占位编排、挥手、抱臂、思考、单膝跪姿、坐姿椅子参考和一条新的带时长机位路径。道具为几何占位；草图图片解析、躺姿、通用接触、完整遮挡和真实家具适配尚未支持。</small>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
