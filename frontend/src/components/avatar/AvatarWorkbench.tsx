"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Check, ChevronDown, FlaskConical, History, Plus, Save, ScanFace } from "lucide-react";

import {
  AvatarRevisionConflictError,
  createInMemoryAvatarCharacterAssetClient,
  type AvatarCharacterAssetClient,
  type DigitalAvatarCharacter,
  type IdentityDesign,
} from "@/lib/avatarCharacterAsset";

const fields: { key: keyof Omit<IdentityDesign, "identity_anchors">; zh: string; en: string }[] = [
  { key: "face", zh: "脸部结构", en: "Face structure" },
  { key: "facial_features", zh: "五官特征", en: "Facial features" },
  { key: "skin", zh: "肤色与皮肤", en: "Skin" },
  { key: "body", zh: "身材与体态", en: "Body and posture" },
  { key: "age_appearance", zh: "年龄外观", en: "Age appearance" },
  { key: "gender_expression", zh: "性别表达", en: "Gender expression" },
  { key: "base_hair", zh: "基础发型", en: "Base hair" },
];

export default function AvatarWorkbench() {
  const zh = useLocale().startsWith("zh");
  const [client, setClient] = useState<AvatarCharacterAssetClient | null>(null);
  const [current, setCurrent] = useState<DigitalAvatarCharacter | null>(null);
  const [viewed, setViewed] = useState<DigitalAvatarCharacter | null>(null);
  const [draft, setDraft] = useState<IdentityDesign>({});
  const [revisionCount, setRevisionCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function startLocalSession() {
    const character: DigitalAvatarCharacter = {
      character_id: `test_${crypto.randomUUID()}`,
      identity_revision: 1,
      identity: {},
      reference_assets: [],
      review_status: "draft",
    };
    setClient(createInMemoryAvatarCharacterAssetClient([character]));
    setCurrent(character);
    setViewed(character);
    setDraft({});
    setRevisionCount(1);
    setMessage("");
  }

  async function selectRevision(revision: number) {
    if (!client || !current) return;
    try {
      setViewed(await client.getCharacter(current.character_id, revision));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveIdentity() {
    if (!client || !current || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await client.updateIdentity(current.character_id, {
        expected_revision: current.identity_revision,
        identity: draft,
        source: "user",
      });
      setCurrent(next);
      setViewed(next);
      setDraft(next.identity);
      setRevisionCount(next.identity_revision);
      setMessage(zh ? `已保存修订 v${next.identity_revision}` : `Saved revision v${next.identity_revision}`);
    } catch (error) {
      setMessage(error instanceof AvatarRevisionConflictError
        ? (zh ? "身份版本已变化，请刷新后重试。" : "Identity revision changed. Refresh and retry.")
        : error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const olderRevision = Boolean(current && viewed && current.identity_revision !== viewed.identity_revision);
  const dirty = current && JSON.stringify(draft) !== JSON.stringify(current.identity);

  return (
    <main className="min-h-full bg-background text-foreground">
      <header className="border-b border-glass-border px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ScanFace size={24} className="shrink-0 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">{zh ? "数字分身" : "Digital Avatar"}</h1>
          </div>
          <span className="flex items-center gap-2 text-xs text-text-muted"><FlaskConical size={15} />{zh ? "本地调试" : "Local test"}</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <div className="mb-6 border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-sm leading-6 text-text-secondary" role="note">
          {zh
            ? "尚未连接 Avatar 服务。这里的测试身份仅在当前页面会话中存在，刷新后消失；不能用于项目角色绑定。"
            : "Avatar service is not connected. Test identities exist only in this page session and disappear on refresh; they cannot be adopted by a project."}
        </div>

        {!current ? (
          <div className="flex min-h-72 flex-col items-start justify-center gap-5 border-y border-glass-border py-8">
            <h2 className="text-lg font-medium">{zh ? "身份设计" : "Identity design"}</h2>
            <button type="button" onClick={startLocalSession} className="glass-button flex min-h-11 items-center gap-2 px-4 text-sm font-medium">
              <Plus size={17} />{zh ? "创建测试身份" : "Create test identity"}
            </button>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_230px]">
            <section className="min-w-0">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{zh ? "稳定身份特征" : "Stable identity features"}</h2>
                  <p className="mt-1 break-all font-mono text-xs text-text-muted">{current.character_id}</p>
                </div>
                <span className="text-xs text-text-secondary">{zh ? "当前版本" : "Current revision"} v{current.identity_revision}</span>
              </div>

              {olderRevision && <div className="mb-4 border-l-2 border-primary bg-primary/5 px-3 py-2 text-sm text-text-secondary">
                {zh ? `正在查看历史版本 v${viewed?.identity_revision}；编辑区保持当前版本。` : `Viewing revision v${viewed?.identity_revision}; editor remains on the current revision.`}
              </div>}

              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                {fields.map(({ key, zh: zhLabel, en }) => (
                  <label key={key} className="grid min-w-0 gap-1.5 text-sm text-text-secondary">
                    <span>{zh ? zhLabel : en}</span>
                    <input
                      value={draft[key] ?? ""}
                      onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
                      className="glass-input min-h-11 w-full"
                      placeholder={zh ? "未指定" : "Unspecified"}
                    />
                  </label>
                ))}
                <label className="grid min-w-0 gap-1.5 text-sm text-text-secondary sm:col-span-2">
                  <span>{zh ? "身份识别锚点（每行一个）" : "Identity anchors (one per line)"}</span>
                  <textarea
                    value={(draft.identity_anchors ?? []).join("\n")}
                    onChange={(event) => setDraft((value) => ({ ...value, identity_anchors: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) }))}
                    className="glass-input min-h-24 w-full resize-y"
                    placeholder={zh ? "未指定" : "Unspecified"}
                  />
                </label>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-glass-border pt-4">
                <button type="button" onClick={saveIdentity} disabled={!dirty || busy} className="glass-button flex min-h-11 items-center gap-2 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
                  <Save size={17} />{busy ? (zh ? "保存中" : "Saving") : (zh ? "保存新版本" : "Save new revision")}
                </button>
                {message && <span role="status" className="text-sm text-text-secondary">{message}</span>}
              </div>
            </section>

            <aside className="border-t border-glass-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0" aria-label={zh ? "版本历史" : "Revision history"}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><History size={16} />{zh ? "版本历史" : "Revision history"}</h2>
              <div className="space-y-1">
                {Array.from({ length: revisionCount }, (_, index) => revisionCount - index).map((revision) => (
                  <button key={revision} type="button" onClick={() => void selectRevision(revision)} aria-current={viewed?.identity_revision === revision ? "true" : undefined}
                    className={`flex min-h-11 w-full items-center justify-between rounded-md px-3 text-left text-sm ${viewed?.identity_revision === revision ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-hover-bg"}`}>
                    <span>v{revision}</span>
                    {viewed?.identity_revision === revision ? <Check size={16} /> : <ChevronDown size={16} className="-rotate-90" />}
                  </button>
                ))}
              </div>
              {viewed && <dl className="mt-5 space-y-2 border-t border-glass-border pt-4 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-text-muted">{zh ? "审核状态" : "Review status"}</dt><dd>{viewed.review_status}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-text-muted">{zh ? "参考素材" : "References"}</dt><dd>{viewed.reference_assets.length}</dd></div>
                {olderRevision && fields.map(({ key, zh: labelZh, en }) => viewed.identity[key] && <div key={key} className="grid gap-1 border-t border-glass-border pt-2"><dt className="text-text-muted">{zh ? labelZh : en}</dt><dd className="break-words">{viewed.identity[key]}</dd></div>)}
              </dl>}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
