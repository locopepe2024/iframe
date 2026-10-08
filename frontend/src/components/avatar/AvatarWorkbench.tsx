"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ScanFace, Plus, Sparkles, Save, Check, History } from "lucide-react";

import { agentRequest, api, type ChatModel } from "@/lib/api";
import type { CharacterDesign, DigitalAvatarCharacter, IdentityDesign } from "@/lib/avatarCharacterAsset";

const fields: { key: keyof Omit<IdentityDesign, "identity_anchors" | "visual_notes">; zh: string; en: string }[] = [
  { key: "face", zh: "脸部结构", en: "Face structure" },
  { key: "facial_features", zh: "五官特征", en: "Facial features" },
  { key: "skin", zh: "肤色与皮肤", en: "Skin" },
  { key: "body", zh: "身材与体态", en: "Body and posture" },
  { key: "age_appearance", zh: "年龄外观", en: "Age appearance" },
  { key: "gender_expression", zh: "性别表达", en: "Gender expression" },
  { key: "base_hair", zh: "基础发型", en: "Base hair" },
];

const emptyDesign = (): CharacterDesign => ({ route: "realistic-modern", identity: {}, look: {}, unresolved: [], basis: {} });

export default function AvatarWorkbench() {
  const zh = useLocale().startsWith("zh");
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [design, setDesign] = useState<CharacterDesign>(emptyDesign);
  const [characters, setCharacters] = useState<DigitalAvatarCharacter[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [historical, setHistorical] = useState<DigitalAvatarCharacter | null>(null);
  const [libraryCharacters, setLibraryCharacters] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = characters.find((character) => character.character_id === selectedId);

  useEffect(() => {
    let active = true;
    void api.listAvatarCharacters().then((result: { characters: DigitalAvatarCharacter[] }) => {
      if (active) setCharacters(result.characters);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    void api.listLibraryAssets().then((result: { characters?: Array<{ id: string; name: string; description?: string }> }) => {
      if (active) setLibraryCharacters(result.characters || []);
    }).catch(() => { if (active) setLibraryCharacters([]); });
    void agentRequest<{ models: ChatModel[] }>("/models").then(({ models: available }) => {
      if (!active) return;
      const chat = available.filter((item) => item.agent_capability !== "h3_prompt_optimization");
      setModels(chat);
      setModel(chat[0]?.api_model_id ?? "");
    }).catch(() => { if (active) setModels([]); });
    return () => { active = false; };
  }, []);

  function choose(character: DigitalAvatarCharacter) {
    setSelectedId(character.character_id);
    setName(character.name);
    setProfile(character.profile || "");
    setDesign(character.character_design?.design_draft ?? emptyDesign());
    setHistorical(null);
    setError("");
  }

  async function createCharacter() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.createAvatarCharacter({ name: name.trim(), profile: profile.trim(), character_design: design });
      setCharacters((current) => [...current, created]);
      choose(created);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function saveDesign(confirmed: boolean) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.updateAvatarDesign(selected.character_id, {
        expected_revision: selected.design_revision, character_design: design, confirmed,
        name: name.trim(), profile: profile.trim(),
      });
      setCharacters((current) => current.map((item) => item.character_id === updated.character_id ? updated : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function viewRevision(revision: number) {
    if (!selected) return;
    setError("");
    try { setHistorical(await api.getAvatarCharacter(selected.character_id, revision)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function writeToLibrary() {
    if (!selected || selected.review_status !== "confirmed" || libraryBusy) return;
    const confirmed = selected.character_design.design_revisions.at(-1)?.design;
    if (!confirmed) return;
    setLibraryBusy(true);
    try {
      const description = [confirmed.identity.visual_notes, ...Object.values(confirmed.identity).filter((value) => typeof value === "string" && value !== confirmed.identity.visual_notes), confirmed.look?.visual_notes].filter(Boolean).join("\n");
      const asset = await api.createLibraryAsset("character", { name: selected.name, description, persona: selected.profile });
      setLibraryCharacters((current) => [...current, { id: asset.id, name: asset.name, description: asset.description }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLibraryBusy(false); }
  }

  async function generateDraft() {
    if (!name.trim() || !profile.trim() || !model || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await agentRequest<{ identity: { visual_notes: string }; look: { visual_notes: string }; unresolved: string[]; skill_revision: string }>("/character-design/draft", "POST", {
        model, character_name: name.trim(), profile: [profile.trim(), libraryCharacters.find((item) => item.id === design.reference_asset_id)?.description ? `Reference material: ${libraryCharacters.find((item) => item.id === design.reference_asset_id)?.description}` : ""].filter(Boolean).join("\n\n"), route: design.route || "realistic-modern",
        age_stage: design.age_stage || "", style: "",
        confirmed_design: selected?.character_design.design_revisions.at(-1)?.design.identity.visual_notes || "",
      });
      setDesign((current) => ({ ...current,
        identity: { ...current.identity, visual_notes: result.identity.visual_notes },
        look: { ...current.look, visual_notes: result.look.visual_notes },
        unresolved: result.unresolved, skill_id: "character-style-routes", skill_revision: result.skill_revision,
        basis: { ...current.basis, visual_notes: "creative_design_choice" },
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const inputClass = "glass-input min-h-10 w-full";
  return <main className="min-h-full bg-background text-foreground">
    <header className="border-b border-glass-border px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center gap-3">
      <ScanFace size={24} className="text-primary" aria-hidden="true" /><h1 className="text-xl font-semibold">{zh ? "数字分身" : "Digital Avatar"}</h1>
    </div></header>
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b border-glass-border pb-5 lg:border-b-0 lg:border-r lg:pr-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{zh ? "人物设计" : "Characters"}</h2>
          <button type="button" title={zh ? "新建人物" : "New character"} aria-label={zh ? "新建人物" : "New character"}
            onClick={() => { setSelectedId(""); setName(""); setProfile(""); setDesign(emptyDesign()); setHistorical(null); setError(""); }}><Plus size={18} /></button></div>
        <div className="space-y-1">{characters.map((item) => <button type="button" key={item.character_id} onClick={() => choose(item)}
          className={`block w-full border-l-2 px-3 py-2 text-left text-sm ${selectedId === item.character_id ? "border-primary bg-hover-bg" : "border-transparent hover:bg-hover-bg"}`}>
          <span className="block truncate font-medium">{item.name}</span><span className="text-xs text-text-muted">v{item.design_revision} · {item.review_status}</span>
        </button>)}</div>
        {selected && <div className="mt-6 border-t border-glass-border pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-secondary"><History size={14} />{zh ? "设计版本" : "Design versions"}</h3>
          <button type="button" onClick={() => setHistorical(null)} className="block w-full py-1 text-left text-xs text-primary">{zh ? "当前编辑版" : "Current draft"} · v{selected.design_revision}</button>
          {(selected.revision_history || []).slice().reverse().map((entry) => <button type="button" key={entry.design_revision} onClick={() => void viewRevision(entry.design_revision)} className="block w-full py-1 text-left text-xs text-text-secondary hover:text-foreground">v{entry.design_revision} · {entry.review_status}</button>)}
        </div>}
        <div className="mt-6 border-t border-glass-border pt-4">
          <h3 className="mb-2 text-xs font-semibold text-text-secondary">{zh ? "素材库参考" : "Library references"}</h3>
          <input className="glass-input mb-2 min-h-9 w-full text-xs" aria-label={zh ? "搜索人物素材" : "Search character materials"} value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
          {libraryCharacters.length ? <div className="max-h-36 space-y-1 overflow-y-auto">{libraryCharacters.filter((item) => item.name.toLowerCase().includes(libraryQuery.trim().toLowerCase())).map((item) => <button type="button" key={item.id} aria-pressed={design.reference_asset_id === item.id} onClick={() => setDesign((current) => ({ ...current, reference_asset_id: current.reference_asset_id === item.id ? undefined : item.id }))} className="block w-full truncate text-left text-xs text-text-secondary hover:text-foreground aria-pressed:text-primary">{item.name}</button>)}</div> : <p className="text-xs text-text-muted">{zh ? "暂无人物素材" : "No character materials"}</p>}
        </div>
      </aside>
      <section className="min-w-0" aria-label={zh ? "人物角色设计" : "Character design"}>
        {error && <div role="alert" className="mb-5 border-l-2 border-red-400 bg-red-400/5 px-4 py-3 text-sm text-red-300">{error}</div>}
        {historical && <section aria-label={zh ? "历史设计预览" : "Historical design preview"} className="mb-6 border-b border-glass-border pb-5 text-sm">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">{historical.name} · v{historical.design_revision}</h2><button type="button" onClick={() => setHistorical(null)} className="text-primary">{zh ? "返回当前版" : "Return to current"}</button></div>
          {historical.profile && <p className="mb-3 whitespace-pre-wrap text-text-secondary">{historical.profile}</p>}
          <dl className="grid gap-2 text-text-secondary sm:grid-cols-2">
            {fields.map(({ key, zh: labelZh, en }) => historical.character_design.design_draft.identity[key] && <div key={key}><dt className="text-xs text-text-muted">{zh ? labelZh : en}</dt><dd className="whitespace-pre-wrap">{historical.character_design.design_draft.identity[key]}</dd></div>)}
          </dl>
          {historical.character_design.design_draft.identity.visual_notes && <p className="mt-3 whitespace-pre-wrap text-text-secondary">{historical.character_design.design_draft.identity.visual_notes}</p>}
          {!!historical.character_design.design_draft.identity.identity_anchors?.length && <p className="mt-2 text-text-secondary">{historical.character_design.design_draft.identity.identity_anchors.join(" · ")}</p>}
          {historical.character_design.design_draft.look?.visual_notes && <p className="mt-2 whitespace-pre-wrap text-text-secondary">{historical.character_design.design_draft.look.visual_notes}</p>}
          {!!historical.character_design.design_draft.unresolved?.length && <ul className="mt-2 list-inside list-disc text-text-secondary">{historical.character_design.design_draft.unresolved.map((item) => <li key={item}>{item}</li>)}</ul>}
        </section>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm"><span>{zh ? "人物名称" : "Character name"}</span><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="grid gap-1 text-sm"><span>{zh ? "设计路线" : "Design route"}</span><select className={inputClass} value={design.route || "realistic-modern"} onChange={(event) => setDesign((current) => ({ ...current, route: event.target.value }))}>
            <option value="realistic-modern">{zh ? "现代写实" : "Modern realistic"}</option><option value="historical-costume">{zh ? "古装" : "Historical"}</option>
            <option value="xianxia-fantasy">{zh ? "仙侠奇幻" : "Fantasy"}</option><option value="anime-stylized">{zh ? "动漫风格" : "Anime"}</option>
          </select></label>
          <label className="grid gap-1 text-sm sm:col-span-2"><span>{zh ? "角色档案" : "Character profile"}</span><textarea className={inputClass} rows={3} value={profile} onChange={(event) => setProfile(event.target.value)} /></label>
          <label className="grid gap-1 text-sm"><span>{zh ? "年龄阶段" : "Age stage"}</span><input className={inputClass} value={design.age_stage || ""} onChange={(event) => setDesign((current) => ({ ...current, age_stage: event.target.value }))} /></label>
          <label className="grid gap-1 text-sm"><span>{zh ? "设计模型" : "Design model"}</span><select className={inputClass} value={model} onChange={(event) => setModel(event.target.value)}><option value="">{zh ? "选择模型" : "Select model"}</option>{models.map((item) => <option key={item.api_model_id} value={item.api_model_id}>{item.display_name}</option>)}</select></label>
        </div>
        <div className="mt-4"><button type="button" className="glass-button inline-flex min-h-10 items-center gap-2 px-3 text-sm disabled:opacity-50" disabled={!model || !profile.trim() || busy} onClick={() => void generateDraft()}><Sparkles size={16} />{zh ? "生成设计草稿" : "Generate design draft"}</button></div>
        <h2 className="mb-4 mt-8 border-b border-glass-border pb-3 text-sm font-semibold">{zh ? "稳定身份特征" : "Stable identity features"}</h2>
        <div className="grid gap-4 sm:grid-cols-2">{fields.map(({ key, zh: zhLabel, en }) => <label key={key} className="grid gap-1 text-sm"><span>{zh ? zhLabel : en}</span><input className={inputClass} value={design.identity[key] || ""} onChange={(event) => setDesign((current) => ({ ...current, identity: { ...current.identity, [key]: event.target.value }, basis: { ...current.basis, [key]: "user_specified" } }))} /></label>)}</div>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1 text-sm"><span>{zh ? "身份识别锚点（每行一个）" : "Identity anchors (one per line)"}</span><textarea className={inputClass} rows={2} value={(design.identity.identity_anchors || []).join("\n")} onChange={(event) => setDesign((current) => ({ ...current, identity: { ...current.identity, identity_anchors: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } }))} /></label>
          <label className="grid gap-1 text-sm"><span>{zh ? "身份视觉说明" : "Identity visual notes"}</span><textarea className={inputClass} rows={4} value={design.identity.visual_notes || ""} onChange={(event) => setDesign((current) => ({ ...current, identity: { ...current.identity, visual_notes: event.target.value }, basis: { ...current.basis, visual_notes: "user_specified" } }))} /></label>
          <label className="grid gap-1 text-sm"><span>{zh ? "造型说明" : "Look notes"}</span><textarea className={inputClass} rows={3} value={design.look?.visual_notes || ""} onChange={(event) => setDesign((current) => ({ ...current, look: { ...current.look, visual_notes: event.target.value } }))} /></label>
          <label className="grid gap-1 text-sm"><span>{zh ? "待确认问题（每行一个）" : "Unresolved questions (one per line)"}</span><textarea className={inputClass} rows={2} value={(design.unresolved || []).join("\n")} onChange={(event) => setDesign((current) => ({ ...current, unresolved: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) }))} /></label>
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-glass-border pt-4">{selected ? <>
          <button type="button" className="glass-button inline-flex min-h-10 items-center gap-2 px-4 text-sm disabled:opacity-50" disabled={busy} onClick={() => void saveDesign(false)}><Save size={16} />{zh ? "保存草稿" : "Save draft"}</button>
          <button type="button" className="glass-button inline-flex min-h-10 items-center gap-2 px-4 text-sm disabled:opacity-50" disabled={busy || !Object.values(design.identity).some((value) => typeof value === "string" && value.trim())} onClick={() => void saveDesign(true)}><Check size={16} />{zh ? "确认设计" : "Confirm design"}</button>
          {selected.review_status === "confirmed" && !!selected.character_design.design_revisions.length && <button type="button" className="glass-button min-h-10 px-4 text-sm disabled:opacity-50" disabled={libraryBusy} onClick={() => void writeToLibrary()}>{libraryBusy ? (zh ? "写入中…" : "Writing…") : (zh ? "新增人物素材" : "Add character material")}</button>}
        </> : <button type="button" className="glass-button inline-flex min-h-10 items-center gap-2 px-4 text-sm disabled:opacity-50" disabled={busy || !name.trim()} onClick={() => void createCharacter()}><Plus size={16} />{zh ? "创建人物" : "Create character"}</button>}</div>
      </section>
    </div>
  </main>;
}
