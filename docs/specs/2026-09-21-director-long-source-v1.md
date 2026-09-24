# Director long-source analysis v1

## Observed

- Code fact: a Director analysis currently places `Script.original_text` in one
  prompt. This is bounded only by the provider's context window, not by the
  application's contract.
- Runtime observation: the supplied `笑傲江湖.txt` contains about one million
  Unicode characters. The current direct path would send the complete source in
  one request.
- Code fact: the existing `execution_summary`, `scene_summaries`, and
  source-linked `canon_state` bound the output used by downstream storyboard and
  asset calls, but they do not bound the Director input.
- Runtime observation: the existing `split_into_episodes` map path uses fixed
  character offsets and loses source ranges in its chunk notes. Most measured
  boundaries therefore fall inside a sentence and the notes cannot be used as
  auditable canon facts.

## Direct implication

- A long source must not be sent to the Director as one raw prompt.
- The Director needs a bounded source representation that preserves coverage,
  beginning/end anchors, and stable source ranges. Later refinement calls must
  reuse that representation instead of re-summarizing the source on every turn.
- A source digest is an input projection, not a replacement source of truth.
  Claims remain hypotheses until supported by the source chunk or an explicit
  user constraint.

## Not yet proven

- A map/reduce digest will reduce semantic drift for every genre or provider;
  this slice makes the boundary auditable but does not prove model quality.
- A chunk boundary is a scene boundary. Source ranges are provenance markers,
  not semantic scene labels.
- A `Bookend Narrative Technique` constraint is appropriate for the whole
  source. It remains scoped to an explicitly requested sample or segment.

## Assumptions

- Sources at or below 16,000 characters remain on the existing single-call
  path. This avoids adding a map phase where the raw source is still a reliable
  prompt input.
- Larger sources use natural paragraph/sentence boundaries where available;
  the hard limit is only used when a single unit exceeds the chunk budget.
- Each long-source map request returns a compact JSON note with a stable chunk
  reference, continuity in/out, events, and unresolved threads. The final
  Director call receives only those notes plus bounded beginning/end anchors.
- The digest cache is process-local and keyed by source content and model
  identity. It is an optimization, not durable project state; a cache miss is
  correct behavior.

## Scope / boundaries

In scope:

1. Add a deterministic natural-boundary splitter with character ranges.
2. Add a cached map/reduce source digest for Director analysis and refinement.
3. Keep `execution_summary` at its existing configurable 7,000-character
   default and keep the existing bounded downstream payload.
4. Add tests for ranges, prompt bounds, cache reuse, and the short-source path.
5. Validate against `/Users/owen/Desktop/资料库/笑傲江湖.txt` offline with a
   mock LLM; no external model call is part of verification.

Out of scope:

- No GraphRAG, vector store, RAPTOR, or new retrieval service.
- No automatic memoir or bookend style inference.
- No persistence migration for source digests in this slice.
- No change to storyboard/asset contracts beyond consuming the already bounded
  Director execution payload.

## Success criteria

- A source of 16,000 characters or fewer causes exactly one Director LLM call
  and includes the raw source.
- A source over 16,000 characters never appears in the final Director prompt
  as the complete raw source; it is represented by chunk notes and head/tail
  anchors.
- Every long-source chunk has a stable `source_ref`, inclusive/exclusive
  character range, and ranges concatenate to the exact original source.
- Natural boundaries are preferred; a hard split is permitted only when no
  boundary can fit within the configured chunk limit.
- Reusing the same long source for refinement produces no additional map calls
  in the same process/model cache scope.
- The real `笑傲江湖.txt` measurement completes offline without constructing a
  one-million-character Director prompt.
- Existing backend and frontend verification suites remain green.

## Affected paths

- `src/apps/comic_gen/llm.py`
- `tests/test_director_profile.py`
- `docs/specs/2026-09-21-director-long-source-v1.md`

## Verification commands

```bash
pytest -q tests/test_director_profile.py
pytest -q
cd frontend && npm run typecheck && npm run test
```

Offline real-source measurement must use a mock LLM and report source length,
chunk count, digest length, and the maximum prompt length; it must not call a
provider or persist the novel.
