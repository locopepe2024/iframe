"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { ImageOff, RefreshCw, ScanFace, Search } from "lucide-react";

import { api } from "@/lib/api";
import { characterImageUrl, characterVariants } from "@/lib/characterImage";
import { getAssetUrl } from "@/lib/utils";
import type { Character } from "@/store/projectStore";

export default function AvatarWorkbench() {
  const zh = useLocale().startsWith("zh");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadCharacters() {
    setLoading(true);
    setError("");
    try {
      const result = await api.listLibraryAssets() as { characters?: Character[] };
      const next = Array.isArray(result.characters) ? result.characters : [];
      setCharacters(next);
      setSelectedId((id) => id && next.some((character) => character.id === id) ? id : next[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadCharacters(); }, []);

  const selected = characters.find((character) => character.id === selectedId);
  const visible = useMemo(() => characters.filter((character) =>
    `${character.name} ${character.description || ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ), [characters, search]);
  const variants = selected ? characterVariants(selected) : [];
  const cover = selected && characterImageUrl(selected);

  return (
    <main className="min-h-full bg-background text-foreground">
      <header className="border-b border-glass-border px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ScanFace size={24} className="shrink-0 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">{zh ? "数字分身" : "Digital Avatar"}</h1>
          </div>
          <button type="button" onClick={() => void loadCharacters()} disabled={loading} title={zh ? "刷新人物素材" : "Refresh characters"} aria-label={zh ? "刷新人物素材" : "Refresh characters"}
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-hover-bg disabled:opacity-50">
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <div className="mb-5 border-l-2 border-amber-400 bg-amber-400/5 px-4 py-3 text-sm leading-6 text-text-secondary" role="note">
          {zh
            ? "当前读取 iFrame 全局人物素材库。Avatar 身份设计与版本服务尚未连接；现有素材不会自动成为已确认的数字分身身份。"
            : "Showing characters from the iFrame shared asset library. Avatar identity design and revision service is not connected; these assets are not confirmed digital identities."}
        </div>

        {error && <div role="alert" className="mb-5 border-l-2 border-red-400 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {zh ? "人物素材加载失败：" : "Failed to load characters: "}{error}
        </div>}

        <div className="grid min-h-[460px] gap-6 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          <section className="min-w-0 border-r-0 border-glass-border md:border-r md:pr-5" aria-label={zh ? "人物素材" : "Character assets"}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{zh ? "人物素材" : "Character assets"}</h2>
              <span className="text-xs text-text-muted">{characters.length}</span>
            </div>
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <span className="sr-only">{zh ? "搜索人物" : "Search characters"}</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={zh ? "搜索人物" : "Search characters"} className="glass-input min-h-11 w-full pl-9" />
            </label>
            <div className="mt-3 space-y-1">
              {loading && <p role="status" className="py-8 text-center text-sm text-text-muted">{zh ? "加载中…" : "Loading…"}</p>}
              {!loading && visible.length === 0 && <p className="py-8 text-center text-sm text-text-muted">{zh ? "暂无人物素材" : "No characters found"}</p>}
              {!loading && visible.map((character) => {
                const image = characterImageUrl(character);
                return <button key={character.id} type="button" onClick={() => setSelectedId(character.id)} aria-current={selectedId === character.id ? "true" : undefined}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-md border p-2 text-left ${selectedId === character.id ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-hover-bg"}`}>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-inset">
                    {image ? <img src={getAssetUrl(image)} alt="" className="h-full w-full object-cover" /> : <ImageOff size={18} className="text-text-muted" />}
                  </span>
                  <span className="min-w-0"><strong className="block truncate text-sm font-medium">{character.name}</strong><small className="block truncate text-xs text-text-muted">{character.id}</small></span>
                </button>;
              })}
            </div>
          </section>

          <section className="min-w-0" aria-label={zh ? "人物详情" : "Character detail"}>
            {selected ? <>
              <div className="mb-5 border-b border-glass-border pb-4">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="mt-1 break-all font-mono text-xs text-text-muted">{selected.id}</p>
                {selected.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{selected.description}</p>}
              </div>
              <h3 className="mb-3 text-sm font-medium">{zh ? "参考图片" : "Reference images"} · {variants.length}</h3>
              {variants.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {variants.map((variant) => <figure key={variant.id} className="min-w-0 overflow-hidden rounded-md border border-glass-border bg-surface-inset">
                  <div className="aspect-[3/4] bg-surface">{variant.url && <img src={getAssetUrl(variant.url)} alt={variant.reference_view_role || selected.name} className="h-full w-full object-contain" />}</div>
                  <figcaption className="truncate px-2 py-2 text-xs text-text-secondary" title={variant.reference_view_role || variant.id}>{variant.reference_view_role || variant.reference_distance || variant.id}</figcaption>
                </figure>)}
              </div> : cover ? <div className="max-w-60 overflow-hidden rounded-md border border-glass-border bg-surface-inset"><img src={getAssetUrl(cover)} alt={selected.name} className="aspect-[3/4] w-full object-contain" /></div>
                : <p className="py-8 text-sm text-text-muted">{zh ? "暂无参考图片" : "No reference images"}</p>}
            </> : !loading && <div className="grid min-h-64 place-items-center text-sm text-text-muted">{zh ? "选择人物查看素材" : "Select a character to inspect its assets"}</div>}
          </section>
        </div>
      </div>
    </main>
  );
}
