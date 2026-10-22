import type { ReferenceCandidate } from '@/components/modules/playground/ReferencePromptEditor';
import type { AssetLibraryReference } from '@/lib/api';

export function selectedReferenceCandidates(candidates: ReferenceCandidate[], selected: AssetLibraryReference[]): ReferenceCandidate[] {
  const keys = new Set(selected.map((reference) => `${reference.asset_type}:${reference.asset_id}:${reference.variant_id}`));
  return candidates.filter((candidate) => candidate.reference && keys.has(
    `${candidate.reference.asset_type}:${candidate.reference.asset_id}:${candidate.reference.variant_id}`,
  ));
}

/** Both @ menus search the same visible asset metadata; selection remains ID based. */
export function searchReferenceCandidates(candidates: ReferenceCandidate[], query: string): ReferenceCandidate[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return candidates;
  return candidates.filter((candidate) => [
    candidate.label, candidate.description, candidate.sourceLabel, candidate.variantLabel,
  ].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
}
