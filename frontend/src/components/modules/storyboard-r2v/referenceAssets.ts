export interface ReferenceVariant {
    id: string;
    url: string;
    reference_view_role?: string;
    reference_distance?: string;
}

export interface ReferenceAsset {
    id: string;
    name: string;
    kind: "character" | "scene" | "prop";
    variants: ReferenceVariant[];
    selectedId?: string | null;
}

export interface ResolvedReferenceGroup {
    slot: number;
    assetId: string;
    name: string;
    kind: ReferenceAsset["kind"];
    variants: ReferenceVariant[];
    pictureNumbers: number[];
}

export interface ReferenceSubmission {
    urls: string[];
    groups: ResolvedReferenceGroup[];
    invalidVariantIds: string[];
}

export const H3_MAX_REFERENCE_IMAGES = 9;

function primaryVariant(asset: ReferenceAsset): ReferenceVariant | undefined {
    return asset.variants.find((variant) => variant.id === asset.selectedId) ?? asset.variants[0];
}

/** Resolve editor slots to an ordered request payload. Explicit per-shot
 * selections win; legacy shots fall back to one primary image per asset. */
export function resolveReferenceSubmission(
    prompt: string,
    assets: ReferenceAsset[],
    selections: Record<string, string[]> = {},
): ReferenceSubmission {
    const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
    const slots = new Map<number, string>();
    const genericNames: string[] = [];
    const tagPattern = /\[(character(\d+)|character|scene|prop):([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(prompt)) !== null) {
        const explicitSlot = match[2] ? Number(match[2]) : undefined;
        const name = match[3];
        if (explicitSlot !== undefined) {
            if (!slots.has(explicitSlot)) slots.set(explicitSlot, name);
        } else if (!genericNames.includes(name)) {
            genericNames.push(name);
        }
    }
    for (const name of genericNames) {
        if (Array.from(slots.values()).includes(name)) continue;
        let slot = 1;
        while (slots.has(slot)) slot += 1;
        slots.set(slot, name);
    }

    const urls: string[] = [];
    const groups: ResolvedReferenceGroup[] = [];
    const invalidVariantIds: string[] = [];
    for (const [slot, name] of Array.from(slots.entries()).sort((a, b) => a[0] - b[0])) {
        const asset = assetByName.get(name);
        if (!asset) continue;
        const explicitIds = selections[asset.id];
        let variants: ReferenceVariant[];
        if (explicitIds?.length) {
            const byId = new Map(asset.variants.map((variant) => [variant.id, variant]));
            variants = [];
            for (const id of explicitIds) {
                const variant = byId.get(id);
                if (variant) variants.push(variant);
                else invalidVariantIds.push(id);
            }
        } else {
            const primary = primaryVariant(asset);
            variants = primary ? [primary] : [];
        }
        if (!variants.length) continue;
        const firstPicture = urls.length + 1;
        urls.push(...variants.map((variant) => variant.url));
        groups.push({
            slot,
            assetId: asset.id,
            name,
            kind: asset.kind,
            variants,
            pictureNumbers: variants.map((_, index) => firstPicture + index),
        });
    }
    return { urls, groups, invalidVariantIds };
}

function pictureList(group: ResolvedReferenceGroup): string {
    return group.pictureNumbers.map((number, index) => {
        const variant = group.variants[index];
        const meta = [variant.reference_view_role, variant.reference_distance].filter(Boolean).join(", ");
        return `<Picture ${number}>${meta ? ` (${meta})` : ""}`;
    }).join(", ");
}

/** Convert editor slot references into H3's picture syntax and explicitly bind
 * multiple product views to one subject. The input prompt is not mutated. */
export function bindH3MultiReferencePrompt(
    prompt: string,
    groups: ResolvedReferenceGroup[],
): string {
    if (!groups.length) return prompt;
    const bySlot = new Map(groups.map((group) => [group.slot, group]));
    const byName = new Map(groups.map((group) => [group.name, group]));
    const byOrdinal = new Map(groups.map((group, index) => [index + 1, group.pictureNumbers[0]]));

    let bound = prompt.replace(/<Picture (\d+)>/g, (token, ordinalText) => {
        const mapped = byOrdinal.get(Number(ordinalText));
        return mapped ? `__IFRAME_PICTURE_${mapped}__` : token;
    });
    bound = bound.replace(/__IFRAME_PICTURE_(\d+)__/g, "<Picture $1>");
    bound = bound.replace(/\[character(\d+):([^\]]+)\]/g, (token, slotText, name) => {
        const group = bySlot.get(Number(slotText));
        return group ? `<Subject ${group.slot}> ${name}` : token;
    });
    bound = bound.replace(/\[(character|scene|prop):([^\]]+)\]/g, (token, _kind, name) => {
        const group = byName.get(name);
        return group ? `<Subject ${group.slot}> ${name}` : token;
    });

    const bindings = groups.map((group) =>
        `<Subject ${group.slot}> is ${group.name}, the same physical ${group.kind} shown in ${pictureList(group)}.`,
    );
    const productRules = groups
        .filter((group) => group.kind === "prop")
        .map((group) =>
            `For <Subject ${group.slot}>, preserve exact package geometry, logo placement, typography layout and colors across views; do not invent, reflow or replace printed text.`,
        );
    const mapping = [...bindings, ...productRules].join("\n");
    if (/subject_definitions\s*:/i.test(bound)) {
        return bound.replace(/subject_definitions\s*:/i, (heading) => `${heading}\n${mapping}`);
    }
    return `subject_definitions:\n${mapping}\n${bound}`;
}
