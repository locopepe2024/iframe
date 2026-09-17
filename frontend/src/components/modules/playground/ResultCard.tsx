'use client';

import { useState, useCallback } from 'react';
import { Expand, Download, Video, Copy, Check, Replace, Crown, Bookmark, PencilLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { playgroundApi } from '@/lib/api';
import { getAssetUrl } from '@/lib/utils';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';

import OverflowActions from './OverflowActions';
import { usePlaygroundImageEditor } from './PlaygroundImageEditor';
import { useLightbox } from '@/components/shared/preview/LightboxProvider';
import { downloadOutput } from './downloadOutput';

interface ResultCardProps {
  generation: PlaygroundGeneration;
  outputIndex?: number;
  onGenerateVideo?: (imagePath: string) => void;
  onRetry?: (generation: PlaygroundGeneration) => void;
  onOpenDetail?: (generation: PlaygroundGeneration, outputId?: string) => void;
  onDelete?: (generation: PlaygroundGeneration) => void;
}

const MODE_LABELS: Record<string, string> = {
  t2v: 'T2V',
  i2v: 'I2V',
  r2v: 'R2V',
  f2v: 'F2V',
  v2v: 'V2V',
  t2i: 'T2I',
  i2i: 'I2I',
};

function getMediaUrl(path: string): string {
  return getAssetUrl(path);
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getElapsedProgress(createdAt: string): number {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  // Estimate ~60s for generation, cap at 90%
  const progress = Math.min(elapsed / 60000, 0.9);
  return progress * 100;
}

function CardTimeActions({ generation, onDelete }: Pick<ResultCardProps, 'generation' | 'onDelete'>) {
  const t = useTranslations('playground');
  return <div className="ml-auto flex shrink-0 items-center gap-1" data-card-time-actions>
    <time dateTime={generation.created_at} className="font-mono text-[0.5625rem] text-text-muted">{formatTime(generation.created_at)}</time>
    {onDelete && <OverflowActions label={t('card.more')} actions={[{
      label: t('card.delete'), danger: true, onClick: () => onDelete(generation),
    }]} />}
  </div>;
}

function FailedCard({ generation, onRetry, onDelete }: { generation: PlaygroundGeneration; onRetry?: (g: PlaygroundGeneration) => void; onDelete?: (g: PlaygroundGeneration) => void }) {
  const { prompt, model_id, mode, created_at, error } = generation;
  const t = useTranslations('playground');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!error) return;
    navigator.clipboard.writeText(error).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-[20px] border border-status-failed-border bg-glass overflow-hidden">
      <div
        className="relative overflow-hidden bg-elevated flex flex-col items-center justify-center cursor-pointer"
        style={{ aspectRatio: expanded ? undefined : '16/9', minHeight: expanded ? 120 : undefined }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="absolute inset-0 bg-status-failed-bg" />
        <div className="relative text-center px-4 py-3 w-full">
          <p className="font-mono text-[0.625rem] text-status-failed-fg uppercase mb-2">{t('card.failed')}</p>
          {error && (
            <p className={`text-[0.625rem] text-text-muted leading-relaxed break-all ${expanded ? '' : 'line-clamp-2'}`}>
              {error}
            </p>
          )}
        </div>

        {/* Action bar */}
        <div className="relative flex items-center gap-2 pb-2">
          {onRetry && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(generation); }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[0.625rem] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              ↻ {t('card.retry')}
            </button>
          )}
          {error && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[0.625rem] font-medium text-text-muted hover:text-foreground hover:bg-hover-bg transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
              {copied ? t('card.copied') : t('card.copyError')}
            </button>
          )}
          <span className="text-[0.5625rem] text-text-muted ml-auto">
            {expanded ? t('card.collapse') : t('card.expand')}
          </span>
        </div>
      </div>

      <div className="px-3 py-[10px]">
        <p className="text-[0.6875rem] text-text-secondary line-clamp-2 mb-1.5">{prompt}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.5625rem] bg-glass text-text-muted rounded px-[6px] py-[2px]">
            {model_id || mode}
          </span>
          <CardTimeActions generation={generation} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

function CompletedCard({ generation, outputIndex, onGenerateVideo, onOpenDetail, onDelete }: { generation: PlaygroundGeneration; outputIndex: number; onGenerateVideo?: (path: string) => void; onOpenDetail?: (generation: PlaygroundGeneration, outputId?: string) => void; onDelete?: (generation: PlaygroundGeneration) => void }) {
  const { prompt, model_id, mode, outputs, created_at } = generation;
  const t = useTranslations('playground');
  const output = outputs[outputIndex];
  const openImageEditor = usePlaygroundImageEditor();
  const editLabel = useTranslations('imageEditor');
  const lightbox = useLightbox();
  const isVideo = output?.media_type === 'video' || ['t2v', 'i2v', 'r2v', 'f2v', 'v2v'].includes(mode);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState('');

  const saved = output?.saved_to_library ?? false;
  const mediaUrl = output?.media_path ? getMediaUrl(output.media_path) : null;
  const updateGeneration = usePlaygroundStore((s) => s.updateGeneration);
  const restoreGeneration = usePlaygroundStore((s) => s.restoreGeneration);
  const featuredByGen = usePlaygroundStore((s) => s.featuredByGen);
  const toggleFeatured = usePlaygroundStore((s) => s.toggleFeatured);
  const featured = output ? featuredByGen[generation.id] === output.id : false;

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!output || downloading) return;
    setDownloading(true); setActionError('');
    try {
      await downloadOutput(generation.id, output.id, output.media_type);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '下载失败，请重试');
    } finally {
      setDownloading(false);
    }
  }, [generation.id, output, downloading]);

  const handleSaveToLibrary = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!output || saving) return;
    setSaving(true);
    setActionError('');
    try {
      const newSaved = !saved;
      if (newSaved) {
        await playgroundApi.saveToLibrary(generation.id, output.id);
      }
      const updatedOutputs = generation.outputs.map((o) =>
        o.id === output.id ? { ...o, saved_to_library: newSaved } : o
      );
      updateGeneration({ ...generation, outputs: updatedOutputs });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存到资产库失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [generation, output, saved, saving, updateGeneration]);

  const handleUseAsReference = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!output?.media_path) return;
    const { inputMedia, setInputMedia } = usePlaygroundStore.getState();
    if (!inputMedia.includes(output.media_path)) {
      setInputMedia([...inputMedia, output.media_path]);
    }
  }, [output]);

  return (
    <div
      className={`group rounded-[20px] border bg-glass atelier-asset-card overflow-hidden transition cursor-pointer ${saved ? 'border-primary/40 ring-1 ring-primary/30' : 'border-glass-border hover:border-foreground/30'}`}
      onClick={() => { if (mediaUrl) lightbox.open({ src: mediaUrl, alt: prompt, kind: isVideo ? "video" : "image" }); }}
    >
      {/* Media area */}
      <div className="relative overflow-hidden bg-elevated" style={{ aspectRatio: '16/9' }}>
        {mediaUrl ? (
          isVideo ? (
            <video src={mediaUrl} preload="metadata" muted playsInline className="w-full h-full object-contain" />
          ) : imgError ? (
            <div className="w-full h-full bg-gradient-to-br from-elevated to-surface flex flex-col items-center justify-center gap-1.5">
              <svg className="w-8 h-8 text-text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
              <span className="font-mono text-[0.5625rem] text-text-muted/50">{t('card.imageUnavailable') || 'Unavailable'}</span>
            </div>
          ) : (
            <img src={mediaUrl} alt={prompt} className="w-full h-full object-cover" onError={() => setImgError(true)} />
          )
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-elevated to-surface" />
        )}

        {/* Amber halation overlay — only when saved to library */}
        {saved && (
          <div className="atelier-proj-halation pointer-events-none absolute inset-0 z-[1]" />
        )}

        {/* Top-left badges: featured (best-of-batch) + video mode */}
        {(featured || isVideo) && (
          <div className="absolute top-2 left-2 z-[3] flex items-center gap-1.5">
            {featured && (
              <span
                className="inline-flex items-center gap-1 font-mono text-[0.5625rem] uppercase tracking-[0.08em] bg-status-starred-bg text-status-starred-fg border border-status-starred-border rounded px-[6px] py-[2px] backdrop-blur-sm"
                title={t('card.featured')}
              >
                <Crown className="w-2.5 h-2.5 fill-status-starred-solid" />
                {t('card.featured')}
              </span>
            )}
            {isVideo && (
              <span className="font-mono text-[0.5625rem] bg-black/60 text-foreground/80 backdrop-blur-sm rounded px-[6px] py-[2px] uppercase">
                {MODE_LABELS[mode] || mode}
              </span>
            )}
          </div>
        )}

        {/* Saved pill top-right */}
        {saved && (
          <span className="absolute top-2 right-2 z-[2] atelier-badge font-mono text-[0.5625rem] bg-primary/15 text-primary border border-primary/30 rounded px-[6px] py-[2px] uppercase">
            {t('card.saved')}
          </span>
        )}

        {!isVideo && output && openImageEditor && <button type="button"
          onClick={event => { event.stopPropagation(); openImageEditor(output.media_path, 'image'); }}
          className="absolute right-2 top-10 z-[3] inline-flex min-h-11 items-center gap-1 rounded-lg bg-elevated px-3 text-sm shadow-sm hover:bg-hover-bg"
          aria-label={editLabel('edit')}><PencilLine size={16} />{editLabel('edit')}</button>}

        {/* Bottom gradient toolbar — appears on hover */}
        <div className="absolute bottom-0 left-0 right-0 z-[2] h-12 bg-gradient-to-t from-black/70 to-transparent flex items-end justify-end gap-1.5 px-3 pb-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {mediaUrl && <button
            type="button"
            aria-label={isVideo ? '放大视频' : '放大图片'}
            onClick={(event) => { event.stopPropagation(); lightbox.open({ src: mediaUrl, alt: prompt, kind: isVideo ? 'video' : 'image' }); }}
            className="w-7 h-7 rounded-full bg-elevated backdrop-blur-sm flex items-center justify-center hover:bg-hover-bg transition"
            title="放大预览"
          >
            <Expand className="w-3.5 h-3.5 text-foreground" />
          </button>}
          <button
            type="button"
            disabled={downloading}
            aria-busy={downloading}
            aria-label={downloading ? '正在下载' : t('card.download')}
            onClick={(event) => { event.stopPropagation(); void handleDownload(event); }}
            className="w-7 h-7 rounded-full bg-elevated backdrop-blur-sm flex items-center justify-center hover:bg-hover-bg transition"
            title={t('card.download')}
          >
            <Download className="w-3.5 h-3.5 text-foreground" />
          </button>
          <button
            onClick={handleUseAsReference}
            className="w-7 h-7 rounded-full bg-elevated backdrop-blur-sm flex items-center justify-center hover:bg-hover-bg transition"
            title={t('card.useAsReference')}
          >
            <Replace className="w-3.5 h-3.5 text-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); restoreGeneration(generation); }}
            className="w-7 h-7 rounded-full bg-elevated backdrop-blur-sm flex items-center justify-center hover:bg-hover-bg transition"
            title={t('card.reedit')}
            aria-label={t('card.reedit')}
          >
            <PencilLine className="w-3.5 h-3.5 text-foreground" />
          </button>
          {output?.media_type === 'image' && onGenerateVideo && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateVideo(output.media_path); }}
              className="w-7 h-7 rounded-full bg-elevated backdrop-blur-sm flex items-center justify-center hover:bg-hover-bg transition"
              title={t('card.generateVideo')}
            >
              <Video className="w-3.5 h-3.5 text-foreground" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); if (output) toggleFeatured(generation.id, output.id); }}
            className={`w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition ${featured ? 'bg-status-starred-bg' : 'bg-elevated hover:bg-hover-bg'}`}
            title={t('card.featured')}
            aria-label={t('card.featured')}
            aria-pressed={featured}
          >
            <Crown className={`w-3.5 h-3.5 ${featured ? 'text-status-starred-solid fill-status-starred-solid' : 'text-foreground'}`} />
          </button>
          <button
            onClick={handleSaveToLibrary}
            disabled={saving}
            aria-busy={saving}
            aria-label={saved ? t('card.saved') : t('card.saveToLibrary')}
            className={`w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition ${saved ? 'bg-primary/15' : 'bg-elevated hover:bg-hover-bg'}`}
            title={saved ? t('card.saved') : t('card.saveToLibrary')}
          >
            <Bookmark className={`w-3.5 h-3.5 ${saved ? 'text-primary fill-current' : 'text-foreground'}`} />
          </button>
        </div>
      </div>

      {/* Info area */}
      <div className="px-3 py-[10px]">
        {downloading && <p role="status" className="mb-1 text-xs text-text-muted">正在准备下载…</p>}
        {saving && <p role="status" className="mb-1 text-xs text-text-muted">正在保存到资产库…</p>}
        {actionError && <p role="alert" className="mb-1 text-xs text-status-failed-fg">{actionError}</p>}
        <p className="text-[0.6875rem] text-text-secondary line-clamp-2 mb-1.5">{prompt}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[0.5625rem] bg-glass text-text-muted rounded px-[6px] py-[2px]">
            {model_id || mode}
          </span>
          {/* Size or resolution tag */}
          {generation.parameters.size && (
            <span className="font-mono text-[0.5625rem] bg-glass text-text-muted rounded px-[6px] py-[2px]">
              {(generation.parameters.size as string).replace(/[*x]/g, '×')}
            </span>
          )}
          {generation.parameters.resolution && !generation.parameters.size && (
            <span className="font-mono text-[0.5625rem] bg-glass text-text-muted rounded px-[6px] py-[2px]">
              {generation.parameters.resolution as string}
            </span>
          )}
          {/* Mode badge */}
          <span className="font-mono text-[0.5625rem] bg-primary/10 text-primary/70 rounded px-[6px] py-[2px] uppercase">
            {MODE_LABELS[mode] || mode}
          </span>
          <CardTimeActions generation={generation} onDelete={onDelete} />
          {saved && (
            <span className="flex items-center gap-0.5 text-[0.5625rem] text-primary">
              <Bookmark className="w-2.5 h-2.5 fill-current" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCardBody({ generation, outputIndex = 0, onGenerateVideo, onRetry, onOpenDetail, onDelete }: ResultCardProps) {
  const { status, prompt, model_id, mode, created_at } = generation;
  const t = useTranslations('playground');

  // ─── PROCESSING STATE ───────────────────────────────────────────────────────
  if (status === 'pending' || status === 'processing') {
    return (
      <div className="rounded-[20px] border border-glass-border bg-glass atelier-asset-card overflow-hidden">
        {/* Media area */}
        <div className="relative overflow-hidden bg-elevated" style={{ aspectRatio: '16/9' }}>
          {/* Skeleton shimmer */}
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0 animate-shimmer"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
                backgroundSize: '200% 100%',
              }}
            />
          </div>

          {/* Centered spinner + text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-glass-border border-t-primary rounded-full animate-spin" />
            <span className="font-mono text-[0.625rem] text-text-muted uppercase">
              {status === 'pending' ? t('card.queued') : t('card.processing')}
            </span>
          </div>

          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-glass">
            <div
              className="h-full bg-primary transition-all duration-1000 ease-out"
              style={{ width: `${getElapsedProgress(created_at)}%` }}
            />
          </div>
        </div>

        {/* Info area */}
        <div className="px-3 py-[10px]">
          <p className="text-[0.6875rem] text-text-secondary line-clamp-2 mb-1.5">{prompt}</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.5625rem] bg-glass text-text-muted rounded px-[6px] py-[2px]">
              {model_id || mode}
            </span>
            <CardTimeActions generation={generation} onDelete={onDelete} />
          </div>
        </div>
      </div>
    );
  }

  // ─── FAILED STATE ───────────────────────────────────────────────────────────
  if (status === 'failed') {
    return <FailedCard generation={generation} onRetry={onRetry} onDelete={onDelete} />;
  }

  // ─── COMPLETED STATE ────────────────────────────────────────────────────────
  return <CompletedCard generation={generation} outputIndex={outputIndex} onGenerateVideo={onGenerateVideo} onOpenDetail={onOpenDetail} onDelete={onDelete} />;
}

export default function ResultCard(props: ResultCardProps) {
  return <ResultCardBody {...props} />;
}
