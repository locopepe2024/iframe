# Director Profile v1

## Problem

Step 2 currently stores a visual style only. Storyboard analysis receives the
script, extracted entities, and a storyboard prompt, but no structured account
of setting, chronology, relationship changes, narrative weight, pacing, sound,
or continuity. A selected style therefore cannot establish that later model
calls understand the story.

## Evidence and assumptions

- Code fact: `ArtDirection` stores `style_config`, custom styles, and style
  recommendations.
- Code fact: storyboard analysis currently passes text, entities, and the
  effective storyboard extraction prompt.
- Direct implication: narrative direction confirmed in Step 2 cannot currently
  be carried as a versioned contract into storyboard generation.
- Not yet proven: adding this context will improve generated images or videos.
  Request-capture tests prove delivery only; output quality needs evaluation.
- Assumption: a Japanese live-action style for a Chinese story describes film
  language. It does not relocate the story or authorize Japanese cultural
  symbols.

## Scope

Add a versioned `director_profile` beside the existing visual style. The profile
contains:

- setting: era, geography, season, and cultural context;
- timeline and time jumps;
- character relationships and their changes;
- key events, narrative functions, foreshadowing, and weights;
- emotional arc and pacing;
- visual, performance, dialogue, and sound direction;
- continuity constraints and explicit prohibitions;
- unresolved questions that must remain unknown rather than inferred.

The profile is generated as an owner-scoped durable asynchronous draft. The
user can revise the visible draft for up to 12 turns. Only explicit apply saves
it. Apply increments its revision and content hash.

## Boundaries

- Existing visual style selection remains available in Step 2.
- Applying a director profile never overwrites confirmed assets or frames.
- Existing frames/assets are marked for review when the confirmed profile hash
  changes.
- Initial storyboard analysis and storyboard refinement receive the effective
  confirmed profile and its revision.
- Asset prompt generation receives the effective confirmed profile.
- Series inheritance is supported through the existing series/project
  Art Direction resolution rule. Project profile wins when present.
- H3/Seedance shot polishing is a later consumer of the same confirmed profile;
  this slice does not alter paid video submission.

## Golden evaluation: `隔岸不观火`

The director draft must preserve the Chinese university/Beijing setting and
mark the exact historical period unknown. It must distinguish Shen Xia/Zhou
Han's eroding long-distance relationship from Zhao Rong/You Xue's contrasting
relationship. It should identify the causal arc `distance -> pressure -> failed
communication -> erosion`, and the functions of scenes 21, 30, 36, and 44.
When the visual style is Japanese live-action romance, prohibitions must exclude
invented Japanese signage, uniforms, shrines, cherry blossoms, and social
customs unless the script explicitly requests them.

The first sample-film recommendation is approximately 60 seconds: departure,
rainy Beijing commute, workplace humiliation, missed calls, lonely return, then
the reunion line `只要你在，什么都好`. Infidelity is not foregrounded in this
sample; the sample establishes how daily life erodes the relationship.

## Success criteria

1. Director draft jobs are durable, owner scoped, resumable, and non-mutating.
2. Refinement includes source, entities, style, current draft, and accumulated
   instructions.
3. Apply saves the exact visible draft, revision, and deterministic hash.
4. Storyboard initial/refinement requests contain the confirmed profile and
   profile revision.
5. Asset prompt assembly includes the confirmed profile.
6. Changing a profile marks existing assets/frames for review without deleting
   or regenerating them.
7. Backend behavior tests, frontend interaction tests, typecheck, and production
   build pass.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/llm.py`
- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/api.py`
- `frontend/src/lib/api.ts`
- `frontend/src/components/modules/ArtDirection.tsx`
- `frontend/messages/{zh,en}.json`
- focused backend and frontend tests

## Verification commands

```bash
python -m pytest tests/test_director_profile.py tests/test_storyboard_analysis_jobs.py -q
cd frontend && npm run test:ui -- src/components/modules/DirectorProfilePanel.test.tsx
cd frontend && npm run typecheck
cd frontend && npm run build
```
