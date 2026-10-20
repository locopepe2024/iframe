# Scene design workspace: first slice

## Observed

The scene editor stacks description, structured controls, prompt refinement and the editable prompt. Adopting an AI suggestion replaces the authored prompt. Generation submits the authored editor, so a visible AI suggestion is not itself the generation source. Scene designs already persist as `asset_design.design_draft`; confirmed revisions feed existing downstream consumers.

## Decision and boundaries

- Scene-only `场景设计` / `AI 优化` tabs select independent editable prompts. The active tab is the generation source and is named beside the editor. Generation review receives exactly that prompt, negative prompt and that source's explicit references.
- The original scene description remains a read-only design basis. Structured controls are a collapsible configuration editor. Applying settings updates only the authored prompt, with no inferred aesthetic or extra constraints.
- Keep one save action. Save structured design and both prompt sources together, retaining existing confirmed-revision semantics for downstream consumers. Store source-specific mode and explicit reference identities with each prompt. No additional model calls on save.
- AI refinement retains its existing input preview and paid-call confirmation. A returned result opens the AI tab without overwriting authored text. Later authored changes preserve the AI result for comparison; regeneration is explicit.
- Keep image/video navigation, reference selection, lighting/camera tools and submission review. Props are outside this slice. No new image assets, dictionary catalog, temporal expressions or storyboard cutover.
- Persist optional `prompt_workspace` inside scene design only. Validate a bounded object and explicit asset references; legacy records remain valid. No automatic generation reads from this metadata: the reviewed visible prompt remains authoritative.

## Success criteria and verification

1. Switching tabs preserves both prompts and their references; generation review names and submits the active source.
2. Empty AI output cannot silently generate from authored text. Authored edits do not discard an existing AI result.
3. Save/reopen restores both prompt sources, explicit references and generation modes; failures remain visible.
4. Fields and optional workspace round-trip through pipeline storage; malformed workspace is rejected before mutation.
5. Existing light/camera tool behavior and prop refinement remain covered.

Affected paths: `ConsistencyVault.tsx`, its UI tests, scene design persistence validation in `pipeline.py`, scene/prop design tests. Commands: targeted UI and backend tests, frontend typecheck and production build, `git diff --check`. Browser validation is not included without explicit browser scope authorization.

## Limits

Structured settings compile to labeled readable text in this slice; this is not a new provider JSON protocol. Model adherence to light/skin/material constraints requires image-level evaluation and is not proven by field persistence or compilation tests.

## Verification

- UI: 49 checks passed across ConsistencyVault, reference editor restoration, scene image tools and submission review.
- Backend: 31 checks passed across scene/prop design persistence and submission snapshots.
- Frontend typecheck and production export passed. Browser/layout and paid image generation were not exercised.
- Explicit-reference restoration was reproduced with a failing test against the previous editor, then verified after the fix.
- Editor workspace metadata is stored in the draft but excluded from confirmed visual-design revisions consumed downstream.
