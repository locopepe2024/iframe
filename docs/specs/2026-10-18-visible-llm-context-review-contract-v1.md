# LLM 优化与生成上下文可见性契约 V1

Date: 2026-10-18. Status: required contract and staged migration. This document describes desired behavior; it does not claim every existing entry point conforms.

## Observed

- Storyboard image polish previously assembled the Director profile, confirmed scene/character design, style/light and shot context in the backend. PR #193 now exposes the assembled model message for editing and requires explicit confirmation before the call. PR #194 separates returned candidates from adoption. Both are pending review and deployment.
- The legacy storyboard image-polish template calls selected asset descriptions `Image X` and says reference images are attached, while this path passes description dictionaries and no image bytes. The new preview exposes this text but does not yet correct that inaccurate template; it needs a separate asset-binding change.
- Video polish currently sends `optimizationDraft`, shot overrides, selected image URLs and model settings from `PolishPanel`. The backend also adds `_get_director_prompt_context` and a model-specific prompt contract before calling the LLM. `PolishPanel` does not yet present that complete compiled input for confirmation. The result remains local until the user applies it through the frame edit queue.
- Generation paths have separate prompt and media submission contracts. An optimizer preview cannot prove that the subsequent image/video generation uses the same references or text without a generation submission review.

## Non-negotiable rule

No structural, continuity, Director, style, lighting, camera, asset or model-format instruction may enter an LLM optimization or generation request without a user-visible review surface. The creator can edit or remove creative constraints and must confirm the resulting input **before** the model call. A returned result must not receive hidden creative instructions after the model call.

Provider protocol requirements and safety validation can remain server enforced, but their effect on allowed format or content must be named in the review. If a user edit conflicts with a required provider format, reject it before charging for a model call and show the exact conflict. Do not silently restore the deleted text.

## Review contract

1. Compile a bounded, source-tagged context projection for the selected task and scope. Show the exact text messages and the selected media identities in a review panel. The panel distinguishes editable creative instructions from required provider-format rules.
2. The user may edit all creative text, including inherited scene baselines, Director suggestions, style, light, shot and asset descriptions. References are chosen and removable independently; a textual `@` mention alone does not bind media.
3. The review response contains a context token bound to source revisions, current shot fields, selected media IDs and the unedited compiler output. An edited reviewed message is sent separately. The server recomputes the token before execution; a mismatch requires a new review.
4. The LLM receives the **reviewed** creative text exactly once. Any model adapter wrapper that adds task or image instructions must either appear in the review or be classified as a declared provider-format rule. The server must never append a second creative constraint after user confirmation.
5. Candidate results remain unapplied until the creator explicitly applies them. Adoption records prompt hash, source revision IDs, selected media IDs and review token. Upstream changes prompt a review warning; they do not mutate accepted text.
6. Generation has its own review of actual prompt, negative prompt, mode, model, parameters and media bindings. Its token guards preview to submission. This guard is distinct from the optimizer-source snapshot.

## Context scopes

| Task | Candidate context | Editable boundary |
| --- | --- | --- |
| Script/episode Director interpretation | Source revision, explicit facts and uncertainties, user style direction | User approves source selection and interpretation instructions before analysis; generated profile is a draft until confirmed |
| Character, scene and prop design | Current asset identity, relevant confirmed Director direction, current episode/time/place, selected references | Asset workbench shows design fields, inherited baseline and compiled prompt; user edits before polish and before image generation |
| Storyboard first frame | Current shot action/composition, confirmed scene/role design, local style/light/camera, selected image references | Shot-specific image polish and render review; no automatic asset image attachment |
| I2V / first-last / R2V / T2V polish | Current shot, generation mode, first/last/reference media identities, dialogue, model contract | Show full compiled optimizer input and media; user edits before the polish job; adopted result becomes the visible shot body |
| Video generation | Adopted or manually edited body, selected mode/model/media and shot parameters | Final generation review must match the actual provider request projection |

## Migration and tests

1. Keep PR #193 image-polish preview and PR #194 explicit candidate adoption as the initial implementation. Test that a deleted constraint is absent from the LLM message, previewed source changes reject execution, and a returned candidate does not alter the frame before adoption.
2. Add a video-polish preflight for all four modes and all optimizer providers, including MiniMax Context IR. Show both system/task text and user text, image order/IDs, audio/dialogue rules and model-format requirements. Reuse the same compiler at preflight and execution. Do not add confirmed design text to the current hidden video path before this review exists.
3. Persist the adopted video's source snapshot through an ordered frame write or explicit adoption API. Show stale sources in generation review. Test concurrent shot edits and candidate replacement.
4. Audit Director interpretation and character/scene/prop prompt optimization entry points against this contract. For each, record the compiler owner, frontend review surface, apply owner, token boundary and generation payload equivalence. Migrate any path that fails the test before adding further automatic context.
5. Replace the legacy image-polish `Image X` assumption with truthful text-only asset labels (PR #196). Test that an unselected image is neither claimed in the model text nor attached to the request. Explicit image binding remains a separate future capability.

## Evidence and limits

- **Code fact:** The current image-polish preflight and candidate split exist only on the pending PR stack. Video polish still compiles additional backend context.
- **Direct implication:** The present video-polish UI cannot let the creator remove every backend-added creative instruction before the LLM call.
- **Not yet proven:** This audit does not show that every video result drifts or that a particular hidden instruction dominates the model output. Inspect request diagnostics and compare generated inputs to establish that empirically.
