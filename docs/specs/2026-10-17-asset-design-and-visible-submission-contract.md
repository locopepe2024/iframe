# Asset design and visible submission contract

## Scope and evidence

This contract covers character, scene, and prop image generation in Studio asset workbenches. Character, scene and prop designs now have reviewable confirmed revisions. Manual image routes require a complete visible prompt. Provider output adherence still requires runtime checks.

## Ownership

1. **Asset identity/design** is the reusable, editable source for stable appearance. A character owns identity and look; a scene owns spatial layout, architecture, fixed materials and landmarks; a prop owns silhouette, construction, material and recognizable details. Drafts and confirmed revisions are distinct. A script fact and a creative design choice must retain their provenance.
2. **Frame content** describes the image being generated now: actors, action, staging, framing, weather and local light. A shooting-plan entry such as "bandits surround the shop" is candidate frame content, not an invariant of the shop asset.
3. **Continuity references** name the exact preceding/related asset variant and the applicable place, story-time, lighting or object state. The user selects which references to use. The location/time baseline may be shown for review even when it conflicts with a selected image; it does not override that image automatically.
4. **Submission snapshot** contains the complete positive prompt, separate negative prompt, explicit reference identities, model, aspect ratio and the source design revision. Every content-affecting instruction must be visible and editable before submission. A renderer must not append hidden prose after submission. Reference image bytes and provider parameters may be transported separately, but their identity and values must be visible in the review UI.

## Projection and revision rules

- An AI design draft can suggest asset design; it cannot silently change the asset description or final prompt. The user confirms a design revision separately.
- Projecting design, frame content and continuity into a prompt creates an editable snapshot. Later edits to a source do not rewrite an already reviewed snapshot. The UI marks the snapshot stale and offers an explicit rebuild.
- The submitted text is the reviewed snapshot. A saved design, shooting plan, global style, negative preset or legacy template does not gain authority to append text during execution.
- Scene and prop draft confirmation must survive save/reload and create a revision only on confirmation. Unknown design fields must be rejected instead of returning apparent success.

## Implemented boundary

- Scene/prop design drafts and confirmed revisions persist and survive reload. Invalid and unknown design fields fail before a save.
- The project and series manual asset image endpoints require a non-empty reviewed prompt, `preserve_prompt=true` and `apply_style=false`. Character `all` mode is rejected because its derived images use separate generated prompt text.
- The legacy project batch route rejects generation until a per-asset prompt review flow exists. Its old `AssetGrid` caller has no imports in the current frontend tree.
- Studio and Cast workbenches copy optional global style into editable prompt fields only on a user action. The asset library asks for an editable prompt and negative prompt before generating more variants. These requests send the reviewed text and no style suffix.
- The character three-view generator does not add hidden negative terms when receiving a reviewed prompt.
- Reviewed project and series tasks freeze positive/negative text, effective model, ratio, mode, stable explicit reference IDs and the latest confirmed design revision at enqueue. New image variants carry that snapshot after generation; older variants and direct generator calls have no fabricated snapshot.
- Manual character three-view and headshot requests require one explicitly selected master variant. The character workbench checks this before submission and passes that variant as one structured reference. Manual requests using a legacy reference URL fail validation because the URL does not establish a stable visible identity. Series character text generation no longer implicitly reuses its selected image.
- Project asset generation now exposes a read-only server preflight. Character, Cast, scene/prop and asset-library manual entry points freeze their edited request and show the server-effective model, ratio, mode, quantity, reference identities and exact positive/negative text before final confirmation. The final request carries a fingerprint; enqueue rejects changed reviewed fields before creating a task.
- The fingerprint also binds the project or series scope, target asset type and target asset ID. An asset-library entry opened outside the current project leaves the model unspecified so the server projects that target project's actual setting. Structured preview errors render as readable text without closing the review surface.

## Remaining work

- Bring the structure of scene/prop AI design drafts beyond one `visual_notes` string if field-specific editing proves useful. Keep frame content and continuity choices at generation scope, outside the reusable asset design record.

### Preflight cutover

- Use a read-only server projection of the exact pending image request. It resolves the effective model and ratio through the same project/series settings used at enqueue, checks reference identities, and returns a fingerprint of all reviewed fields. It must not call an LLM or mutate the asset.
- The UI freezes the edited prompt, negative prompt, mode, generation type, count and explicit references when opening review. It shows the server projection in one confirmation surface. Returning to edit discards that review.
- The final generation request must carry the fingerprint. Enqueue recomputes it inside the existing asset lock and rejects a changed model, ratio, design revision, prompt or reference set before creating a paid task. Both manual HTTP generation routes reject requests without a fingerprint; direct pipeline callers remain outside this browser review contract.
- Character, scene, prop, Cast and asset-library manual generation use the same review surface. The backend remains authoritative for effective model and ratio; the visible text remains the request body and cannot be changed by the projection.

## Submission ledger implementation plan

- At enqueue, freeze the request's visible positive/negative text, requested and effective image model, aspect ratio, generation type, image mode, stable explicit reference IDs and confirmed design revision. Do not store signed delivery URLs in this ledger.
- At execution, associate that frozen record only with variants created by the task. A later design edit must not change the recorded source revision.
- Derived character views require an explicit structured master variant. A text-mode request cannot quietly consume a selected master image.
- Legacy or directly invoked generator paths may lack a reviewed snapshot; represent that absence explicitly instead of inventing provenance.
- Verify scene, prop, character reference sheet and derived character paths with a task queued before a design revision changes. Check reload and API projection, not only in-memory state.

## Acceptance criteria

1. Scene/prop design confirmation round-trips through storage with a monotonically increasing confirmed revision.
2. A rejected or unknown design payload does not report successful confirmation.
3. In every migrated image-generation entry, the positive and negative text seen before submission equal the text passed to the provider, apart from documented provider-side transformations outside iFrame's control.
4. Reference identities, model and aspect ratio remain visible in the same preflight review.
