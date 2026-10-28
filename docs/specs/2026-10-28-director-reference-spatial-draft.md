# Reference-image spatial draft

## Scope and evidence

Code fact: the director already sends one reference image to its language model and compiles street_layout/add_box into editable proxies. The general design prompt rejects an entire request when an essential action is unsupported. This makes a mixed scene/action description unsuitable for establishing the space first.

Add an explicit `spatial_draft` request mode. It requires a reference image and user description, extracts static space and canonical actor markers, and reports image observations, design assumptions, and deferred actions separately. The default `edit` mode keeps its existing all-or-clarify behavior. The draft mode is explicitly selected by the user; it is not an automatic partial execution of a general design request.

## Contract

- The draft model response uses separate observations, assumptions and deferredActions lists. They are bounded and converted into labeled proposal assumptions, so existing apply/export/library provenance persists them without a second storage protocol.
- Draft operations are limited to static layout, props, poses, actor markers and camera composition. Reject animation/cuts at the server boundary, rather than trusting prompt compliance.
- `add_actor` creates a canonical, unbound white-model marker with an explicit label and ground position. It does not create or bind a real character asset. IDs are unique and the total visible cast remains at most 40. It creates no tracks.
- Existing actors and authored objects remain unless the user edits them through existing operations. New static actors participate in the existing spacing/box overlap checks. New actors can be camera targets in the same proposal.
- Preview is pure; apply is one undoable transaction. Invalid or stale candidates cannot apply. Frame-1 and existing root-transform restrictions remain.
- Hidden geometry, metric scale and depth inferred from the image remain editable assumptions. No reconstruction, contact or motion guarantee is made.

## Reference and reuse boundary

Reviewed CozyClay commit `0ed8ffb853b483b0616d8eb6ba6b495aca606b9a`, notably docs/agent-prompt-to-scene.md, docs/sculpt-from-image.md, src/sculpt-run.js and src/sculpt-geometry.js. Its parts-recipe/measure/draft/compare loop informs a future geometry slice. This slice uses iFrame's existing compiler and independently authored schema/prompt; no CozyClay source or prompt text is copied. CozyClay is AGPL-3.0-or-later; actual source imports must carry their license, attribution and corresponding-source delivery plan.

## Acceptance

1. Missing-image draft fails 422 before provider call; edit requests remain compatible.
2. Draft model response cannot install animated operations; observations and deferred actions survive proposal -> apply -> design bundle.
3. Static actor markers preview without mutation, preserve camera/timeline, apply/undo correctly, and reject duplicate IDs, overcrowding and overlaps.
4. UI selects scope explicitly, explains static output, and supports preview/apply/save through existing controls.
5. Focused backend/frontend tests, typecheck and build pass. Real-model image interpretation and media-host video rendering are separate live acceptance; mock tests do not establish their quality.

Affected paths: src/apps/director_design.py; frontend/src/lib/directorDesign.ts; frontend/src/components/director3d/design/{design-proposal,DesignAssistantPanel} and tests.

Commands: `python3 -m pytest tests/test_director_design.py`; frontend `npm run test:ui -- --run <focused files>`; `npm run typecheck`; `npm run build`.
