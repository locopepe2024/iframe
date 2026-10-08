"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { ScanFace } from "lucide-react";

import type { IdentityDesign } from "@/lib/avatarCharacterAsset";

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
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState<IdentityDesign>({});

  return (
    <main className="min-h-full bg-background text-foreground">
      <header className="border-b border-glass-border px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <ScanFace size={24} className="shrink-0 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold">{zh ? "数字分身" : "Digital Avatar"}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8">
        <div className="mb-6 border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-sm leading-6 text-text-secondary" role="status">
          {zh
            ? "Avatar 人物创建服务尚未连接。你可以整理身份设计，但目前无法创建或保存人物；刷新页面会清除未保存内容。"
            : "Avatar character creation is not connected. You can prepare an identity design, but cannot create or save a character yet. Unsaved fields disappear on refresh."}
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section className="min-w-0" aria-label={zh ? "创建人物" : "Create character"}>
            <div className="mb-5 border-b border-glass-border pb-4">
              <h2 className="text-base font-semibold">{zh ? "创建人物" : "Create character"}</h2>
            </div>
            <label className="mb-6 grid gap-1.5 text-sm text-text-secondary">
              <span>{zh ? "人物名称" : "Character name"}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} className="glass-input min-h-11 w-full" placeholder={zh ? "输入名称" : "Enter a name"} />
            </label>

            <h3 className="mb-4 text-sm font-semibold">{zh ? "稳定身份特征" : "Stable identity features"}</h3>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              {fields.map(({ key, zh: zhLabel, en }) => (
                <label key={key} className="grid min-w-0 gap-1.5 text-sm text-text-secondary">
                  <span>{zh ? zhLabel : en}</span>
                  <input value={identity[key] ?? ""} onChange={(event) => setIdentity((value) => ({ ...value, [key]: event.target.value }))}
                    className="glass-input min-h-11 w-full" placeholder={zh ? "未指定" : "Unspecified"} />
                </label>
              ))}
              <label className="grid min-w-0 gap-1.5 text-sm text-text-secondary sm:col-span-2">
                <span>{zh ? "身份识别锚点（每行一个）" : "Identity anchors (one per line)"}</span>
                <textarea value={(identity.identity_anchors ?? []).join("\n")}
                  onChange={(event) => setIdentity((value) => ({ ...value, identity_anchors: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) }))}
                  className="glass-input min-h-24 w-full resize-y" placeholder={zh ? "未指定" : "Unspecified"} />
              </label>
            </div>
            <div className="mt-6 border-t border-glass-border pt-4">
              <button type="button" disabled title={zh ? "等待 Avatar 创建接口" : "Avatar creation API required"}
                className="glass-button min-h-11 px-4 text-sm font-medium opacity-50">
                {zh ? "创建人物" : "Create character"}
              </button>
            </div>
          </section>

          <aside className="border-t border-glass-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0" aria-label={zh ? "创建范围" : "Creation scope"}>
            <h2 className="mb-3 text-sm font-semibold">{zh ? "人物身份" : "Character identity"}</h2>
            <p className="text-sm leading-6 text-text-secondary">
              {zh ? "此处创建的是可跨项目使用的人物身份。服装、妆容、场景状态和镜头表演由后续设计层处理。" : "This identity can be used across projects. Costume, makeup, scene state, and shot performance belong to later design stages."}
            </p>
            <p className="mt-4 text-xs leading-5 text-text-muted">
              {zh ? "iFrame 资产库仅可在后续显式选择时提供参考图，不作为人物身份来源或存储。" : "The iFrame asset library may later supply explicitly selected references; it does not own or store Avatar identities."}
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
