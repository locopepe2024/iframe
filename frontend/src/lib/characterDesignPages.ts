import type { AssetLibraryReference, AssetReferenceIndexEntry, PlatformReferenceContext } from './api';

export interface CharacterDesignPage {
    id: string;
    name: string;
    prompt: string;
    negative_prompt: string;
    mode: 'text' | 'reference';
    references: AssetLibraryReference[];
    prompt_source: string;
    reference_prompts: Record<string, string>;
    selected_variant_id?: string | null;
}

export const designReferenceKey = (ref: AssetLibraryReference) =>
    [ref.asset_type, ref.asset_id, ref.variant_id, ref.source_scope || '', ref.source_container_id || ''].join(':');

/** Use only explicitly matched, current episode evidence; never infer a person by fuzzy name. */
export function characterDesignPageSeed(project: any, asset: { id: string; name: string; description?: string }) {
    const profile = project?.art_direction?.director_profile || project?.director_profile_revisions?.at(-1)?.profile;
    const people = (profile?.story_map?.people || []).filter((person: any) => person.variant_character_ids?.includes(asset.id));
    const identities = new Set([asset.id, asset.name, ...people.flatMap((person: any) => [person.person_id, person.display_name])]);
    const facts = (profile?.canon_state?.characters || []).filter((fact: any) =>
        identities.has(fact.subject) && (!fact.status || fact.status === 'active') && typeof fact.value === 'string' && fact.value.trim());
    if (facts.length) return { prompt: Array.from(new Set(facts.map((fact: any) => fact.value.trim()))).join('\n'), source: '当集导演理解 · 角色描述' };
    return { prompt: asset.description || '', source: asset.description ? '角色资产描述（当集暂无匹配的导演角色描述）' : '自由设计' };
}

/** Import recorded evidence into visible text; it stays editable and never locks identity or clothing. */
export function referenceDesignPrompt(reference: AssetLibraryReference, index: AssetReferenceIndexEntry[], context?: PlatformReferenceContext | null) {
    const entry = index.find(item => item.asset_type === reference.asset_type && item.asset_id === reference.asset_id
        && (!reference.source_container_id || item.source_container_id === reference.source_container_id));
    const variant = entry?.variants.find(item => item.id === reference.variant_id);
    const design = variant?.submission_snapshot?.visual_design;
    const parts = [design && Object.keys(design).length ? JSON.stringify(design, null, 2) : '',
        variant?.submission_snapshot?.positive_prompt?.trim() || variant?.prompt_used?.trim() || entry?.description?.trim(), context?.summary?.trim(),
        context?.semantics && Object.keys(context.semantics).length ? JSON.stringify(context.semantics, null, 2) : ''].filter(Boolean);
    const text = Array.from(new Set(parts)).join('\n');
    return text ? `参考图「${context?.title || entry?.name || '所选素材'}」：\n${text}` : '';
}

export function updateDesignPageReferences(page: CharacterDesignPage, references: AssetLibraryReference[], imported: Record<string, string>) {
    let prompt = page.prompt;
    const selected = new Set(references.map(designReferenceKey));
    const previous = page.reference_prompts || {};
    for (const [key, text] of Object.entries(previous)) {
        // Remove only the untouched imported block. User edits remain authored text.
        if (!selected.has(key)) prompt = prompt.replace(text, '').trim();
    }
    for (const [key, text] of Object.entries(imported)) {
        if (!previous[key] && text) prompt = [prompt.trim(), text].filter(Boolean).join('\n\n');
    }
    return { ...page, prompt, references, mode: references.length ? 'reference' as const : page.mode,
        reference_prompts: Object.fromEntries(Object.entries({ ...previous, ...imported }).filter(([key]) => selected.has(key))) };
}
