type StoryboardStyleConfig = {
    positive_prompt?: string | null;
    negative_prompt?: string | null;
};

type StoryboardArtDirection = {
    style_config?: StoryboardStyleConfig | null;
} | null;

type StoryboardStyleProject = {
    art_direction?: StoryboardArtDirection;
    series_id?: string | null;
    style_prompt?: string | null;
    style_preset?: string | null;
};

type StoryboardStyleSeries = {
    id: string;
    art_direction?: StoryboardArtDirection;
} | null;

/** Resolve the same project → series → legacy style layers used by the backend. */
export function resolveStoryboardStyle(
    project: StoryboardStyleProject,
    series?: StoryboardStyleSeries,
) {
    const artDirection = project.art_direction
        ?? (project.series_id && series?.id === project.series_id ? series.art_direction : undefined);
    if (artDirection?.style_config) {
        return {
            positivePrompt: artDirection.style_config.positive_prompt?.trim() || "",
            negativePrompt: artDirection.style_config.negative_prompt?.trim() || "",
        };
    }

    const stylePrompt = project.style_prompt?.trim();
    const stylePreset = project.style_preset?.trim();
    return {
        positivePrompt: [stylePreset ? `${stylePreset} style` : "", stylePrompt]
            .filter(Boolean)
            .join(", "),
        negativePrompt: "",
    };
}

export async function resolveStoryboardStyleForRender(
    project: StoryboardStyleProject,
    series: StoryboardStyleSeries,
    loadSeries: (id: string) => Promise<StoryboardStyleSeries>,
) {
    let resolvedSeries = series;
    if (!project.art_direction && project.series_id && resolvedSeries?.id !== project.series_id) {
        resolvedSeries = await loadSeries(project.series_id);
    }
    return resolveStoryboardStyle(project, resolvedSeries);
}
