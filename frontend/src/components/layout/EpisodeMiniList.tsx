"use client";

/**
 * AuthoringContextList — compact screenplay context rendered above the
 * pipeline steps. It keeps the independent outline project and its episode
 * projects reachable from either kind of production project.
 */
import { useEffect, useState } from "react";
import { BookOpen, Plus, Tv } from "lucide-react";
import clsx from "clsx";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { debugLog } from "@/lib/debugLog";

interface EpisodeListItem {
    id?: string;
    document_id?: string;
    title: string;
    episode_number?: number;
    project_id?: string | null;
    current?: boolean;
}

interface AuthoringContext {
    available: boolean;
    root?: {
        document_id: string;
        title: string;
        project_id?: string | null;
        preview?: string;
        current?: boolean;
    } | null;
    series?: { id: string; title: string } | null;
    episodes: EpisodeListItem[];
}

interface EpisodeMiniListProps {
    /** Legacy series association for projects without an authoring document. */
    seriesId?: string;
    currentProjectId: string;
    sourceScriptDocumentId?: string;
    activeStep: string;
}

function navigateToSeriesAddEpisode(seriesId: string): void {
    window.location.hash = `/series/${seriesId}`;
}

function navigateToProject(projectId: string, activeStep: string): void {
    const stepFragment = activeStep ? `#${activeStep}` : "";
    window.location.hash = `/project/${projectId}${stepFragment}`;
}

export default function EpisodeMiniList({
    seriesId,
    currentProjectId,
    sourceScriptDocumentId,
    activeStep,
}: EpisodeMiniListProps) {
    const t = useTranslations("episodeMiniList");
    const [context, setContext] = useState<AuthoringContext | null>(null);
    const [episodes, setEpisodes] = useState<EpisodeListItem[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        let authoringAvailable = false;
        setLoading(true);
        setContext(null);
        setEpisodes(null);

        // The authoring endpoint is canonical for root and episode projects.
        // A series-only fallback keeps older manually-created projects working
        // while they have no source document link.
        api.getProjectAuthoringContext(currentProjectId)
            .then((result: AuthoringContext) => {
                if (cancelled) return;
                if (result?.available) {
                    authoringAvailable = true;
                    setContext(result);
                    return;
                }
                if (!seriesId) setEpisodes([]);
            })
            .catch((err) => {
                debugLog.warn("Studio", "Authoring context fetch failed:", err);
                if (!cancelled && !seriesId) setEpisodes([]);
            })
            .finally(() => {
                if (cancelled) return;
                if (authoringAvailable) {
                    setLoading(false);
                    return;
                }
                if (seriesId) {
                    api.getSeriesEpisodes(seriesId)
                        .then((items: any[]) => {
                            if (cancelled) return;
                            const sorted = [...items].sort((a, b) =>
                                (typeof a.episode_number === "number" ? a.episode_number : 999) -
                                (typeof b.episode_number === "number" ? b.episode_number : 999));
                            setEpisodes(sorted.map((episode) => ({
                                id: episode.id,
                                project_id: episode.id,
                                title: episode.title || `Episode ${episode.episode_number ?? "?"}`,
                                episode_number: episode.episode_number,
                            })));
                        })
                        .catch((err) => {
                            debugLog.warn("Studio", "EpisodeMiniList fetch failed:", err);
                            if (!cancelled) setEpisodes([]);
                        })
                        .finally(() => { if (!cancelled) setLoading(false); });
                } else {
                    setLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [currentProjectId, seriesId, sourceScriptDocumentId]);

    useEffect(() => {
        if (context) setLoading(false);
    }, [context]);

    const contextEpisodes = context?.episodes || episodes || [];
    const root = context?.root || null;
    if (loading || (!root && contextEpisodes.length === 0)) return null;

    const handleSwitch = (projectId?: string | null) => {
        if (!projectId || projectId === currentProjectId) return;
        navigateToProject(projectId, activeStep);
    };

    return (
        <div className="border-b border-glass-border px-4 py-3">
            {root && (
                <>
                    <div className="mb-2 flex items-center gap-2 font-mono text-chrome-sm font-medium uppercase text-text-muted">
                        <BookOpen size={11} aria-hidden="true" />
                        {t("outline")}
                    </div>
                    <button
                        type="button"
                        onClick={() => handleSwitch(root.project_id)}
                        disabled={!root.project_id}
                        title={root.preview || root.title}
                        className={clsx(
                            "group mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-fast ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55",
                            root.current || root.project_id === currentProjectId
                                ? "bg-primary/15 text-primary"
                                : root.project_id
                                    ? "text-text-secondary hover:bg-hover-bg hover:text-foreground"
                                    : "text-text-muted",
                        )}
                    >
                        <span className="grid h-5 w-7 shrink-0 place-items-center rounded bg-black/30 font-mono text-chrome-sm text-text-muted">
                            {t("outlineMark")}
                        </span>
                        <span className="truncate font-sans text-body-sm">{root.title}</span>
                    </button>
                </>
            )}

            {contextEpisodes.length > 0 && (
                <>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-mono text-chrome-sm font-medium uppercase text-text-muted">
                            <Tv size={11} aria-hidden="true" />
                            {t("title", { count: contextEpisodes.length })}
                        </div>
                        {context?.series?.id && (
                            <button
                                type="button"
                                onClick={() => navigateToSeriesAddEpisode(context.series!.id)}
                                aria-label={t("addEpisode")}
                                title={t("addEpisode")}
                                className="btn-tip -m-1 grid h-6 w-6 place-items-center rounded text-text-muted transition-colors duration-fast ease-out-quart hover:bg-hover-bg hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
                            >
                                <Plus size={11} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                    <div className="max-h-[180px] space-y-1 overflow-y-auto pr-1">
                        {contextEpisodes.map((episode) => {
                            const projectId = episode.project_id || episode.id;
                            const isActive = episode.current || projectId === currentProjectId;
                            return (
                                <button
                                    key={episode.document_id || episode.id || `${episode.episode_number}-${episode.title}`}
                                    type="button"
                                    onClick={() => handleSwitch(projectId)}
                                    disabled={!projectId}
                                    title={episode.title}
                                    className={clsx(
                                        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-fast ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55",
                                        isActive
                                            ? "bg-primary/15 text-primary"
                                            : projectId
                                                ? "text-text-secondary hover:bg-hover-bg hover:text-foreground"
                                                : "text-text-muted",
                                    )}
                                >
                                    <span className={clsx(
                                        "grid h-5 w-7 shrink-0 place-items-center rounded font-mono text-chrome-sm font-medium tabular-nums",
                                        isActive ? "bg-primary/25 text-primary" : "bg-black/30 text-text-muted",
                                    )}>
                                        {episode.episode_number ?? "—"}
                                    </span>
                                    <span className="truncate font-sans text-body-sm">{episode.title}</span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
