import type { ReferenceCandidate } from '@/components/modules/playground/ReferencePromptEditor';

/** Both @ menus search the same visible asset metadata; selection remains ID based. */
export function searchReferenceCandidates(candidates: ReferenceCandidate[], query: string): ReferenceCandidate[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return candidates;
  return candidates.filter((candidate) => [
    candidate.label, candidate.description, candidate.sourceLabel, candidate.variantLabel,
  ].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
}
