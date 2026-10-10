'use client';

import { useState, useEffect, useMemo, useCallback, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Image, Film, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, playgroundApi } from '@/lib/api';
import { getAssetUrl } from '@/lib/utils';
import { referenceKey, referenceName } from './referenceMedia';
import { usePlaygroundStore } from './usePlaygroundStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssetPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  accept: 'image' | 'video' | 'all';
  triggerRef?: RefObject<HTMLElement>;
}

interface AssetItem {
  id: string;
  path: string;
  type: 'image' | 'video' | 'audio' | 'text';
  thumbnail?: string;
  label: string;
  source: 'workspace' | 'playground' | 'session';
}

type FilterTab = 'all' | 'image' | 'video';
const PAGE_SIZE = 36;
const ASSET_SOURCE_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|webm|avi|mkv)$/i.test(path);
}

/** Convert a media_path (e.g. "output/storyboard/foo.png") to a /files/ URL */
function toFileUrl(mediaPath: string): string {
  return getAssetUrl(mediaPath);
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

const springModal = { type: 'spring' as const, stiffness: 400, damping: 30 };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AssetPickerModal({
  isOpen,
  onClose,
  onSelect,
  accept,
  triggerRef,
}: AssetPickerModalProps) {
  const t = useTranslations('playground');
  const translate = useRef(t);
  translate.current = t;
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [bottomOffset, setBottomOffset] = useState(12);
  const [activeTab, setActiveTab] = useState<FilterTab>(
    accept === 'all' ? 'all' : accept
  );
  const loadGeneration = useRef(0);

  // -------------------------------------------------------------------------
  // Merge owner-scoped workspace assets, Playground history, and current inputs.
  // -------------------------------------------------------------------------

  const fetchAssets = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    const withTimeout = <T,>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('asset source timeout')), ASSET_SOURCE_TIMEOUT_MS);
      promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
    });
    try {
      const [historyResult, libraryResult] = await Promise.allSettled([
        withTimeout(playgroundApi.getHistory(100, 0)),
        withTimeout(api.getAssetLibraryIndex()),
      ]);
      if (generation !== loadGeneration.current) return;
      if (historyResult.status === 'rejected' && libraryResult.status === 'rejected') {
        throw historyResult.reason;
      }
      const history = historyResult.status === 'fulfilled' ? historyResult.value : [];
      const items: AssetItem[] = [];
      const seen = new Set<string>();

      const add = (item: AssetItem) => {
        const key = referenceKey(item.path);
        if (!item.path || seen.has(key)) return;
        seen.add(key);
        items.push(item);
      };

      if (libraryResult.status === 'fulfilled') {
        for (const entry of libraryResult.value.assets) {
          for (const variant of entry.variants || []) {
            add({
              id: `${entry.source_scope}-${entry.source_container_id || 'global'}-${entry.asset_type}-${entry.asset_id}-${variant.id}`,
              path: variant.url,
              type: 'image',
              label: entry.name,
              source: 'workspace',
            });
          }
        }
      }

      const current = usePlaygroundStore.getState();
      for (const path of current.inputMedia) {
        add({
          id: `current-${referenceKey(path)}`,
          path,
          type: isVideoPath(path) ? 'video' : /\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff|aif|wma)(?:[?#].*)?$/i.test(path) ? 'audio' : /\.(txt|md|csv|json|srt|vtt)(?:[?#].*)?$/i.test(path) ? 'text' : 'image',
          label: referenceName(path, current.mediaNames, history),
          source: 'session',
        });
      }

      for (const gen of history) {
        if (gen.status !== 'completed') continue;
        for (const output of gen.outputs) {
          const isVideo = output.media_type === 'video';
          add({
            id: output.id,
            path: output.media_path,
            type: isVideo ? 'video' : 'image',
            thumbnail: output.thumbnail_path || undefined,
            label: referenceName(output.media_path, {}, history),
            source: 'playground',
          });
        }

        // Also include input media from history entries
        if (gen.input_media) {
          for (const inputPath of gen.input_media) {
            const isVideo = isVideoPath(inputPath);
            add({
              id: 'input-' + inputPath,
              path: inputPath,
              type: isVideo ? 'video' : /\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff|aif|wma)(?:[?#].*)?$/i.test(inputPath) ? 'audio' : /\.(txt|md|csv|json|srt|vtt)(?:[?#].*)?$/i.test(inputPath) ? 'text' : 'image',
              label: referenceName(inputPath, gen.media_names || {}, history),
              source: 'playground',
            });
          }
        }
      }

      setAssets(items);
    } catch (err) {
      console.error('[AssetPickerModal] fetch failed:', err);
      if (generation === loadGeneration.current) setError(translate.current('assetPicker.loadFailed'));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSelected(null);
      setSearch('');
      setPage(0);
      fetchAssets();
    } else {
      // Invalidate an in-flight load so closing and reopening cannot let an
      // older request overwrite the state of the new modal instance.
      loadGeneration.current += 1;
      setLoading(false);
    }
  }, [isOpen, fetchAssets]);

  // Reset active tab when accept changes
  useEffect(() => {
    setActiveTab(accept === 'all' ? 'all' : accept);
  }, [accept]);

  useEffect(() => {
    if (!isOpen) return;
    const position = () => {
      const composer = triggerRef?.current?.closest('[data-agent-composer]');
      const desired = composer ? window.innerHeight - composer.getBoundingClientRect().top + 10 : 12;
      setBottomOffset(Math.min(Math.max(12, desired), Math.max(12, window.innerHeight - 240)));
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [isOpen, triggerRef]);

  // -------------------------------------------------------------------------
  // Filter
  // -------------------------------------------------------------------------

  const filteredAssets = useMemo(() => {
    // First filter by what the caller accepts
    let pool = assets;
    if (accept !== 'all') {
      pool = pool.filter((a) => a.type === accept);
    }
    // Then by active tab
    if (activeTab !== 'all') {
      pool = pool.filter((a) => a.type === activeTab);
    }
    const query = search.trim().toLocaleLowerCase();
    if (query) pool = pool.filter((a) => a.label.toLocaleLowerCase().includes(query));
    return pool;
  }, [assets, accept, activeTab, search]);

  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / PAGE_SIZE));
  const pageAssets = filteredAssets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSelect = () => {
    if (selected) {
      const asset = assets.find((item) => item.path === selected);
      if (asset) usePlaygroundStore.getState().rememberMediaName(selected, asset.label);
      onSelect(selected);
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // -------------------------------------------------------------------------
  // Tab config
  // -------------------------------------------------------------------------

  const tabs: { key: FilterTab; label: string; icon: React.ReactNode; show: boolean }[] = [
    {
      key: 'all',
      label: t('assetPicker.tabAll'),
      icon: null,
      show: accept === 'all',
    },
    {
      key: 'image',
      label: t('assetPicker.tabImage'),
      icon: <Image className="w-3.5 h-3.5" />,
      show: accept === 'all' || accept === 'image',
    },
    {
      key: 'video',
      label: t('assetPicker.tabVideo'),
      icon: <Film className="w-3.5 h-3.5" />,
      show: accept === 'all' || accept === 'video',
    },
  ];

  const visibleTabs = tabs.filter((t) => t.show);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          data-agent-asset-picker
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 px-3 pt-3 backdrop-blur-sm"
          style={{ paddingBottom: bottomOffset }}
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            className="
              w-full max-w-[960px]
              bg-elevated border border-glass-border
              rounded-lg shadow-2xl
              flex flex-col overflow-hidden
            "
            style={{ height: `min(700px, calc(100dvh - ${bottomOffset + 12}px))` }}
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={springModal}
            onClick={(e) => e.stopPropagation()}
          >
            {/* -------------------------------------------------------------- */}
            {/* Header                                                          */}
            {/* -------------------------------------------------------------- */}
            <div className="px-4 py-3 border-b border-glass-border flex items-center justify-between shrink-0 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                  <Image size={16} className="text-primary" />
                </div>
                <h2 className="text-[0.9375rem] font-semibold text-foreground">{t('assetPicker.title')}</h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label={t('assetPicker.cancel')}
                className="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-hover-bg hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-b border-glass-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              {visibleTabs.length > 1 && (
              <div className="flex items-center gap-1.5">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setActiveTab(tab.key); setPage(0); setSelected(null); }}
                    className={[
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[0.6875rem] font-medium transition-all border",
                      activeTab === tab.key
                        ? "text-primary bg-primary/15 border-primary/30"
                        : "text-text-muted hover:text-foreground hover:bg-hover-bg border-transparent",
                    ].join(" ")}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
              )}
              <label className="relative block w-full sm:ml-auto sm:max-w-[280px]">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="search"
                  aria-label={t('assetPicker.search')}
                  placeholder={t('assetPicker.search')}
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(0); setSelected(null); }}
                  className="h-10 w-full rounded-md border border-glass-border bg-input-bg pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Grid                                                            */}
            {/* -------------------------------------------------------------- */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
                  <span className="text-xs text-text-muted">{t('assetPicker.loading')}</span>
                </div>
              )}

              {error && !loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <span className="text-xs text-status-failed-fg">{error}</span>
                  <button
                    type="button"
                    onClick={fetchAssets}
                    className="text-xs text-primary hover:underline"
                  >
                    {t('assetPicker.retry')}
                  </button>
                </div>
              )}

              {!loading && !error && filteredAssets.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <Image className="w-8 h-8 text-text-muted" />
                  <span className="text-xs text-text-muted">
                    {t(assets.length ? 'assetPicker.emptyFilter' : 'assetPicker.empty')}
                  </span>
                  {assets.length === 0 && <span className="text-[0.6875rem] text-text-muted">
                    {t('assetPicker.emptyHint')}
                  </span>}
                </div>
              )}

              {!loading && !error && filteredAssets.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {pageAssets.map((asset) => {
                    const isSelected = selected === asset.path;
                    const thumbUrl = asset.thumbnail
                      ? toFileUrl(asset.thumbnail)
                      : toFileUrl(asset.path);

                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() =>
                          setSelected(isSelected ? null : asset.path)
                        }
                        aria-label={asset.label}
                        aria-pressed={isSelected}
                        className={`
                          relative aspect-square rounded-lg overflow-hidden
                          bg-glass cursor-pointer
                          transition-all duration-150
                          ${
                            isSelected
                              ? 'border-2 border-primary ring-2 ring-primary/30'
                              : 'border border-border-subtle hover:border-primary/50'
                          }
                        `}
                      >
                        {/* Thumbnail */}
                        {asset.type === 'audio' || asset.type === 'text' ? <span className="flex h-full items-center justify-center text-xs text-text-muted">{asset.type === 'audio' ? '音频' : '文本'}</span> : asset.type === 'video' && !asset.thumbnail ? (
                          <span className="flex h-full items-center justify-center"><Film className="h-7 w-7 text-text-muted" /></span>
                        ) : (
                          <img
                            src={thumbUrl}
                            alt={asset.label}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        )}

                        {/* Type badge */}
                        <div className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[0.625rem] text-foreground/80">
                          {t(`assetPicker.source.${asset.source}`)}
                        </div>
                        {asset.type === 'video' && (
                          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
                            <Film className="w-3 h-3 text-foreground/80" />
                          </div>
                        )}

                        {/* Selected checkmark */}
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-on-accent" />
                          </div>
                        )}

                        {/* File name */}
                        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent">
                          <span className="text-[0.625rem] text-foreground/80 truncate block">
                            {asset.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Footer                                                          */}
            {/* -------------------------------------------------------------- */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-glass-border px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <button type="button" aria-label={t('assetPicker.previousPage')} title={t('assetPicker.previousPage')} disabled={page === 0} onClick={() => setPage((current) => current - 1)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={16} /></button>
                <span>{t('assetPicker.page', { page: page + 1, total: pageCount })}</span>
                <button type="button" aria-label={t('assetPicker.nextPage')} title={t('assetPicker.nextPage')} disabled={page >= pageCount - 1} onClick={() => setPage((current) => current + 1)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={16} /></button>
              </div>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="
                  px-4 py-2 rounded-lg text-xs
                  text-text-secondary hover:text-foreground
                  hover:bg-hover-bg
                  transition-colors
                "
              >
                {t('assetPicker.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSelect}
                disabled={!selected}
                className={[
                  "inline-flex items-center gap-[7px] px-4 py-2 rounded-full text-xs font-medium transition-all",
                  selected
                    ? "bg-primary text-on-accent shadow-[var(--glow-primary)] hover:bg-primary-hover hover:-translate-y-px"
                    : "bg-elevated text-text-muted cursor-not-allowed",
                ].join(" ")}
              >
                <Check className="w-3.5 h-3.5" />
                {t('assetPicker.select')}
              </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  , document.body);
}
