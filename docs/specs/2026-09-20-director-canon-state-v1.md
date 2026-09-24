# Director Canon State v1

## Problem

Director output can be much longer than the bounded execution context. A single
natural-language summary is useful for downstream execution, but it is not a
durable cross-scene memory: repeated refinements can echo it, and later scenes
can drift when a fact, state transition, or unresolved question is not
traceable to its source.

## Evidence and assumptions

- Code fact: the Director profile already stores bounded `execution_summary` and
  `scene_summaries`, while the editable profile remains larger.
- Code fact: refinement returns a delta patch that the server merges before the
  visible draft is returned.
- Direct implication: a structured fact ledger can be updated independently of
  the prose summary and can carry source/revision metadata without making the
  downstream prompt larger.
- Hypothesis: source-linked canon state will reduce cross-scene drift. This
  requires evaluation on representative scripts; schema and merge tests do not
  prove output quality.
- Assumption: the first implementation keeps canon entries as JSON objects and
  does not require a graph database, embeddings, or a new retrieval service.

## Scope

Add an optional `canon_state` object to the Director draft and confirmed profile.
It contains bounded lists of source-linked facts for characters, relationships,
world rules, timeline/events, open threads, and conflicts. Each item may carry a
`fact_id`, `kind`, `subject`, `value`, `source_refs`, `source_revision`,
`status`, and `supersedes_fact_id`. `active`, `contradicted`, `superseded`, and
`uncertain` are the supported statuses. The server-generated fallback ID does
not depend on array position, so a reorder does not by itself create a new
fact.

Initial Director analysis may produce `canon_state`. A refinement patch may
replace or append the lists, but the server must normalize and bound them. The
server does not infer semantic merges or resolve conflicts; it preserves the
model's explicit status and source references. Unchanged canon state must not
be echoed into a delta patch.

Downstream consumers continue to receive only the bounded execution payload.
The editable ledger is capped at 32 facts / 12,000 compact-JSON characters;
the downstream projection is capped at 16 facts / 3,600 compact-JSON
characters. The first projection adds a compact `canon_state` slice only when
it fits the existing refinement/downstream budgets; it never forwards the full
editable profile.

## Boundaries

- No vector index, graph database, or background re-indexing in this slice.
- No automatic deletion or silent overwrite of existing facts.
- No claim that canon state proves story correctness; it is an evidence-linked
  memory contract.
- Existing `execution_summary`, `scene_summaries`, delta patch, and Director
  latest-wins queue behavior remain compatible.
- Existing clients that omit `canon_state` continue to work.

## Success criteria

1. Existing Director profiles deserialize when `canon_state` is absent.
2. Initial drafts accept a bounded `canon_state` without allowing unbounded
   output to reach downstream prompts.
3. Refinement patches can update canon state without synthesizing omitted fields.
4. Unchanged canon fields are discarded from echoed full-profile responses.
5. Source refs, revision, and explicit conflict status survive normalization.
6. Focused Director and extraction-job tests pass; the full backend suite remains
   green.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/llm.py`
- `src/apps/comic_gen/pipeline.py`
- `frontend/src/store/projectStore.ts`
- `tests/test_director_profile.py`
- `docs/specs/2026-09-20-director-canon-state-v1.md`

## Verification commands

```bash
pytest -q tests/test_director_profile.py tests/test_extraction_jobs.py
pytest -q
```
