import { initializeNavigation } from "./navmesh-routing";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { directorDesignApi, type DirectorReferenceAsset, type DesignReferenceImage, type DesignTurn } from "@/lib/directorDesign";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, type DesignPreview, type DesignProposal } from "./design-proposal";

export function DesignAssistantPanel({ onPreview, previewing, disabled = false }: {
  onPreview: (preview: DesignPreview | null) => void; previewing: boolean; disabled?: boolean;
}) {
  const [navigation, setNavigation] = useState<"boxes" | "navmesh">("boxes");
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [savedDesigns, setSavedDesigns] = useState<DirectorReferenceAsset[] | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [referenceImage, setReferenceImage] = useState<DesignReferenceImage | null>(null);
  const [referenceImageName, setReferenceImageName] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceHash, setReferenceHash] = useState("");
  const [proposalReference, setProposalReference] = useState<{ file: File; hash: string } | null>(null);
  const [proposal, setProposal] = useState<DesignProposal | null>(null);
  const [rejectedDesign, setRejectedDesign] = useState<{ proposal: DesignProposal; reason: string } | null>(null);
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
    const requestReference = referenceFile && referenceHash ? { file: referenceFile, hash: referenceHash } : null;
    try {
      const state = useWorkbenchStore.getState();
      const baseRevision = designRevision(state);
      const context = JSON.parse(designContext(state));
      if (rejectedDesign?.proposal === proposal && proposal?.baseRevision === baseRevision) {
        context.rejectedDesign = { operations: proposal.operations, reason: rejectedDesign.reason };
      }
      const next = await directorDesignApi.propose({ prompt: requestText, baseRevision, context: JSON.stringify(context), history, referenceImage }, controller.signal);
      if (controller.signal.aborted) return;
      if (next.baseRevision !== baseRevision) throw new Error("设计提案与请求场景不匹配，请重试。");
      setProposal(next); setRejectedDesign(null);
      setProposalReference(requestReference);
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
      onPreview(candidate); setError(""); setRejectedDesign(null);
      const waits = proposal.operations.flatMap((op) => op.kind === "crowd_motion" ? op.members.flatMap((member) => {
        const track = candidate.dialogueTimeline.tracks.find((item) => item.target.targetId === member.actorId && item.propertyKey === "transform.position_m");
        const firstMove = track?.keyframes.findIndex((key) => JSON.stringify(key.value) !== JSON.stringify(member.positionM)) ?? -1;
        const actualStart = firstMove > 0 ? track!.keyframes[firstMove - 1].timeSeconds : member.startSeconds;
        return actualStart > member.startSeconds ? [`${candidate.characters[member.actorId].label}等待 ${(actualStart - member.startSeconds).toFixed(2)} 秒`] : [];
      }) : []);
      setMessage(waits.length ? `通行避让：${waits.join("；")}。实际时间线 ${candidate.dialogueTimeline.durationSeconds.toFixed(2)} 秒。` : "");
    }
    catch (caught) {
      onPreview(null);
      const reason = caught instanceof Error ? caught.message : "设计无法预览。";
      setRejectedDesign({ proposal, reason }); setError(reason);
    }
  };
  const apply = () => {
    if (!proposal || !previewing || disabled || busy) return;
    try {
      useWorkbenchStore.getState().applyDesignProposal(proposal, navigation, proposalReference ? {
        fileName: proposalReference.file.name, mimeType: proposalReference.file.type, sizeBytes: proposalReference.file.size,
        sha256: proposalReference.hash, mediaId: null, assumptions: proposal.assumptions,
      } : null);
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
  const saveBundle = async () => {
    try {
      setBusy(true); setError("");
      let state = useWorkbenchStore.getState();
      let bundle = state.exportDirectorDesignBundle();
      if (proposalReference && state.designSource?.sha256 === proposalReference.hash && !state.designSource.mediaId) {
        const savedImage = await directorDesignApi.saveReferenceAsset(proposalReference.file, proposalReference.file.name, "reference_image", bundle.sourcePackageChecksum, { sha256: proposalReference.hash });
        state.setDesignSourceMediaId(proposalReference.hash, savedImage.mediaId);
        state = useWorkbenchStore.getState();
        bundle = state.exportDirectorDesignBundle();
      }
      const saved = await directorDesignApi.saveReferenceAsset(new Blob([JSON.stringify(bundle)], { type: "application/json" }), `director-design-${bundle.sourcePackageChecksum}.json`, "design_bundle", bundle.sourcePackageChecksum, { referenceImageMediaId: bundle.authoring.designSource?.mediaId ?? null, assumptions: bundle.authoring.designAssumptions });
      setMessage(`设计包已保存到过程素材库：${saved.mediaId}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存设计包失败。"); }
    finally { setBusy(false); }
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
  const loadSavedDesigns = async () => {
    setBusy(true); setError("");
    try {
      const assets = (await directorDesignApi.listReferenceAssets()).filter((asset) => asset.kind === "design_bundle");
      setSavedDesigns(assets); setSelectedDesignId("");
    } catch { setError("读取已保存的设计失败，请重试。"); }
    finally { setBusy(false); }
  };
  const restoreSavedDesign = async () => {
    if (!selectedDesignId || busy || disabled) return;
    const baseRevision = designRevision(useWorkbenchStore.getState());
    setBusy(true); setError("");
    try {
      const blob = await directorDesignApi.readReferenceAsset(selectedDesignId);
      const raw = JSON.parse(await blob.text());
      if (designRevision(useWorkbenchStore.getState()) !== baseRevision) throw new Error("读取期间场景已变化，请重新导入。");
      const result = useWorkbenchStore.getState().importDirectorDesignBundle(raw);
      if (!result.ok) throw new Error(result.errors.join("；"));
      onPreview(null); setProposal(null); setProposalReference(null); setHistory([]);
      setMessage("已从素材库导入设计，可继续调整；可通过撤销恢复原场景。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "导入设计失败。"); }
    finally { setBusy(false); }
  };
  return <section className="design-assistant" aria-labelledby="design-assistant-title">
    <div className="dialogue-heading"><h2 id="design-assistant-title">自然语言设计</h2><span className="revision-badge">场景与机位</span></div>
    <details><summary>重新编排动画</summary>
      <p>清除人物和机位路径、时间线内容（含对白、焦点与接触）及路径事件，保留布局、姿态、机位和来源信息，回到第 1 帧。可通过撤销恢复；建议先保存设计包。</p>
      <button type="button" disabled={disabled || busy || navigationLoading} onClick={() => {
        useWorkbenchStore.getState().clearAnimationForDesign();
        onPreview(null); setProposal(null); setProposalReference(null); setHistory([]); setError("");
        setMessage("动画已清除，布局已保留；现在可以生成新的群演或运镜方案，可撤销恢复。");
      }}>清除动画，保留布局</button>
    </details>
    <div className="blocking-reference-actions"><button type="button" disabled={disabled || busy} onClick={() => void loadSavedDesigns()}>读取已保存的设计</button></div>
    {savedDesigns !== null && <div>
      {savedDesigns.length === 0 ? <p role="status">还没有保存的 3D 设计。</p> : <>
        <label>已保存的 3D 设计<select value={selectedDesignId} disabled={disabled || busy} onChange={(event) => setSelectedDesignId(event.target.value)}><option value="">选择设计</option>{savedDesigns.map((asset) => <option key={asset.mediaId} value={asset.mediaId}>{asset.name}</option>)}</select></label>
        <button type="button" disabled={disabled || busy || !selectedDesignId} onClick={() => void restoreSavedDesign()}>导入所选设计</button>
      </>}
    </div>}
    <div className="blocking-reference-actions"><button type="button" onClick={exportBundle} disabled={disabled}>导出设计包</button><button type="button" onClick={() => void saveBundle()} disabled={disabled || busy}>保存设计包到素材库</button><label className="button-like">导入设计包<input type="file" accept="application/json,.json" hidden disabled={disabled} onChange={(event) => { importBundle(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
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
      <label className="director-reference-picker">场景参考图（可选）<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || disabled} onChange={(event) => {
        const file = event.target.files?.[0]; event.currentTarget.value = "";
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) { setError("参考图不能超过 3 MB。"); return; }
        const reader = new FileReader();
        reader.onload = async () => { const url = String(reader.result || ""); if (!url.startsWith("data:image/")) { setError("参考图格式无效。"); return; } setReferenceImage({ url }); setReferenceFile(file); setReferenceImageName(file.name); setReferenceHash(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map((byte) => byte.toString(16).padStart(2, "0")).join("")); setError(""); };
        reader.onerror = () => setError("参考图读取失败，请重试。");
        reader.readAsDataURL(file);
      }} /></label>
      {referenceImage && <p role="status">已绑定参考图：{referenceImageName}。它只用于解析构图和白模假设。</p>}
      <div className="blocking-reference-actions"><button type="submit" disabled={busy || disabled || !prompt.trim()}>{busy ? "正在设计…" : "生成设计提案"}</button>{busy && pending.current && <button type="button" onClick={cancelRequest}>停止生成</button>}{history.length > 0 && !busy && <button type="button" disabled={disabled} onClick={() => { setHistory([]); setProposal(null); onPreview(null); setMessage("已清空对话，场景保持当前编辑结果。"); }}>新对话</button>}</div>
    </form>
    {disabled && <p role="status">录制期间暂不可设计场景。</p>}
    {busy && <p role="status">{pending.current ? "正在根据当前场景生成提案，尚未修改舞台…" : "正在读写素材库，请稍候…"}</p>}
    {rejectedDesign?.proposal === proposal && !stale && <p role="status">预览校验未通过。继续输入调整要求并生成时，会附上本次方案和校验原因。</p>}
    {proposal && <div className="design-proposal">
      <h3>设计提案</h3><p>{proposal.summary}</p>
      {proposal.assumptions.length > 0 && <details open><summary>设计假设</summary><ul>{proposal.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {proposal.clarification ? <p role="status">{proposal.clarification}</p> : <>
        <p>{proposal.operations.length} 项操作。预览不会保存；应用后可拖动或输入数值继续编辑。</p>
        <ol>{proposal.operations.map((op, index) => <li key={index}>{{street_layout: "街区建筑与通道布局", crowd_motion: "群演分组与分时移动", add_camera: "新增构图机位", camera_cut: "时间线切镜", place_entity: "调整对象位置与朝向", arrange_pair: "双人相对摆位", arrange_group: "多人编号占位编排", add_box: "添加道具占位", frame_camera: "设计静态机位", dolly_camera: "调整机位距离", camera_motion: "创建带时长的运镜路径", set_pose: "设置人物姿态", seat_actor: "坐在程序化椅子参考上"}[op.kind]} · {"layoutId" in op ? op.layoutId : "cameraId" in op ? op.cameraId : "entityId" in op ? op.entityId : "actorId" in op ? op.actorId : "actorIds" in op ? op.actorIds.join(" / ") : op.members.map((member) => member.actorId).join(" / ")}{op.kind === "camera_motion" && ` · ${op.durationSeconds} 秒 · ${op.distanceM == null ? "预设距离" : `${op.distanceM} 米`}`}</li>)}</ol>
        {proposal.operations.some((op) => op.kind === "crowd_motion") && <p role="status">群演将自动绕开方盒障碍并按顺序避让，必要时增加最多 8 秒等待；请拖动预览时间检查实际反应与通行节奏。步态为程序化参考，含标准白模直线段平地支撑脚锁定；转角仍为离散换向，请检查脚步衔接。</p>}
        {proposal.operations.some((op) => op.kind === "seat_actor") && <p role="status">椅子是可编辑的程序化占位，不是真实家具资产。坐姿仅适配标准白模；手动移动后需重新检查接触。</p>}
        <div className="blocking-reference-actions"><button type="button" disabled={stale || busy || navigationLoading || disabled} onClick={preview}>预览设计</button><button type="button" disabled={stale || busy || navigationLoading || disabled || !previewing} onClick={apply}>应用设计</button>{previewing && <button type="button" onClick={() => onPreview(null)}>退出预览</button>}<button type="button" disabled={busy} onClick={() => { setProposal(null); onPreview(null); setError(""); }}>放弃提案</button></div>
      </>}
      {stale && <p role="status">场景已变化，此提案已过期；请重新生成。</p>}
    </div>}
    <small>支持在第 1 帧保留既有动画的前提下创建静态街区、道具和摆位；群演分组、分时直线移动、观察停留和多机位切镜需在无既有动画的草稿中创建；以及标准白模摆位、2–10 人编号占位编排、挥手、抱臂、思考、单膝跪姿、坐姿椅子参考和一条新的带时长机位路径。道具为几何占位；群演支持方盒绕行、人物等待避让与近似步态，含标准白模直线段平地支撑脚锁定，但不含连续转弯步、地形适配、物理推搡或任意模型寻路；草图解析、躺姿、通用接触和真实家具适配尚未支持。</small>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
