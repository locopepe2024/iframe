# Interactive Storyboard Analysis V1

Status: implemented and locally verified on 2026-09-18.

## Observed

- `POST /projects/{id}/storyboard/analyze` performs a blocking model call and
  immediately replaces the project's persisted frames.
- The frontend clears the visible shot list before that request completes.
- The generation dialog only supports generate or cancel. It has no draft,
  review, follow-up correction, or explicit apply boundary.
- The entity-analysis flow now supports durable, owner-scoped revision jobs and
  explicit application of the reviewed draft.

## Direct Implication

The current storyboard flow cannot support sustained direction. A transport
failure can leave the user without useful feedback, and every correction starts
from a new model call rather than the last reviewed storyboard.

## Contract

- Initial storyboard analysis and every refinement run as durable owner/project
  scoped jobs.
- A refinement sends the original script, resolved character/scene/prop data,
  current storyboard draft, and all accepted user instructions.
- Analysis and refinement never mutate persisted frames.
- Existing frames remain visible until the user explicitly applies a draft.
- Apply submits the reviewed structured draft and persists that exact draft. It
  does not rely on an in-memory cache or rerun analysis.
- After apply, the existing per-frame rich-detail refinement may run.
- A failed refinement preserves the prior draft and the user's input.
- At most 12 instructions of 2000 characters each are accepted per draft.

## Success Criteria

- A user can iteratively request shot merging/splitting, order, pacing, dialogue,
  staging, and coverage changes before replacing the storyboard.
- Browser retry with the same analysis fingerprint reuses the durable task.
- Cross-owner job reads are rejected.
- Applying after an arbitrary review delay persists the visible draft without an
  additional storyboard-analysis model call.
- Existing one-shot API behavior remains available for compatibility.

## Evidence Limit

Request-capture and state tests can prove context forwarding and mutation
boundaries. They cannot prove that the selected model follows every directing
instruction; that needs evaluation against representative scripts.

## Verification

- `python -m pytest tests/test_storyboard_analysis_jobs.py tests/test_extraction_jobs.py tests/test_reparse_ownership.py tests/test_pipeline.py -q`
  - 19 passed
- `npm run test -- src/__tests__/storyboardAnalysis.test.ts src/__tests__/scriptExtraction.test.ts`
  - 6 passed
- Storyboard UI regression selection
  - 23 passed
- `npm run typecheck`
  - passed
- `DOCKER_BUILD=true NEXT_PUBLIC_API_URL=https://garage.uniart.fun npm run build`
  - passed
