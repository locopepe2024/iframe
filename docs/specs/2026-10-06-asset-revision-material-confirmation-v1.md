# Asset, Revision, Variant, and Material Confirmation V1

Status: product contract with partial runtime implementation (2026-10-10).
Date: 2026-10-06

Cross-stage ID and revision definitions, including plan and shot keyframe
boundaries: `2026-10-10-script-plan-asset-material-identity-v1.md`.

Implementation status (2026-10-10): project, series, and personal-library
assets persist monotonic semantic snapshots. Existing attachments start as
`legacy_attached`; explicit confirmation records `user_confirmed`. Project
asset details support variant membership confirmation and revision restore.
Confirmed storyboard reference packages and video tasks persist asset revision,
variant, and available media/storage identities. Restore appends a new revision.
Generation still attaches variants immediately, so the separate candidate
material area and acceptance boundary below remain target behavior. Legacy
variants without `media_id` can pin a storage key, but lack a complete media
registry identity. Series and personal-library assets can be resolved through
an episode project; their direct library views have no confirmation action yet.

## Goal

Define what it means to save a generated image, confirm it as an asset variant,
and choose the image currently used by an asset. The same identity rules apply
to Agent, image editing, the character workbench, project/series Assets, and
reference search. The initial implementation scope is image material; video and
motion use the same identity distinction but need separate selection rules.

## Observed

- Code fact: `ImageVariant` currently stores a URL and lives directly inside
  `AssetUnit` or `ImageAsset`. Generating for an existing asset writes a variant
  immediately and usually selects it. There is no separate acceptance step.
- Code fact: the character workbench displays variants already in the asset's
  image containers. Its variant strip is therefore asset membership, not a
  search result over unrelated materials.
- Code fact: the asset index expands all attached variants for reference
  pickers. `selected_variant_id` and `cover_variant_id` are distinct fields.
  The September cover spec explicitly allowed the displayed cover to differ
  from the selected generation variant.
- Code fact: Playground's `saved_to_library` records a saved output, while
  `Import as asset` creates a semantic asset and an initial variant. A unified
  owner-scoped `media_id` registry and a monotonic asset revision are not yet
  implemented.
- Direct implication: an existing `ImageVariant` is evidence of a stored
  asset-to-image association, but not evidence that a user reviewed or accepted
  that image. The current UI cannot infer acceptance from creation time alone.

## Identity Model

```text
Material (media_id) -- explicit confirmation --> Asset variant binding (variant_id)
                                               --> Asset revision N
Asset (asset_type, asset_id) -------------------^       |
                                                        +-- active variant set
                                                        +-- current selection by role
```

| Object | Meaning | Identity and mutation |
| --- | --- | --- |
| Material | One immutable image file and its provenance. It can exist without an asset. | Stable `media_id` is the target; current URL/output ID is a transitional locator. Replacing bytes creates another material. |
| Asset | A semantic character, scene, or prop, independent of images. | Stable `(asset_type, asset_id)` across edits. |
| Asset variant binding | One explicit association between an asset and a material, with role and source provenance. | Stable `variant_id` after confirmation. One material may be referenced by more than one asset through distinct bindings. |
| Asset revision | A committed snapshot of the asset's variant membership, roles, and current selections. | Monotonic revision advances on confirmed asset changes; it is not an image file or an extra asset. |
| Generation task/output | An attempt and its resulting material. | Task/output identity remains separate from asset and variant identity. |
| Generation reference | A choice of material or an exact asset variant for one request. | Request-local binding; it does not change asset membership. |

`schema_version` describes a response format. It is not an asset revision.
`cover_variant_id`, `selected_variant_id`, a signed URL, and a thumbnail are
not material or asset identities.

## States and Actions

| State/action | Meaning | Asset effect |
| --- | --- | --- |
| Generated, unsaved output | Material belongs to task history or workbench material area. | None. It is not an asset variant. |
| Save material | Retain an Agent or editor output in the user's material library. | None. Saving alone does not create or modify an asset. |
| Check a material in an asset workbench and confirm | Accept that material for this asset, assigning a role and a new `variant_id`. | Adds an active variant binding and commits a new asset revision. |
| Uncheck an active variant and confirm | Remove it from the asset's active variant set. | Commits a new asset revision. Material and provenance remain retained under their own lifecycle rules. |
| Select current variant | Choose one active variant for a specific role or default usage. | Commits a new asset revision; membership does not change. |
| Use as generation reference | Select a material or exact variant for one image/video task. | Does not add a variant or change the source asset. |
| Archive or invalidate | Explicitly withdraw use, or mark missing/corrupt media. | Archived items leave ordinary selection; missing media cannot be submitted. Historical identity remains auditable. |

"Historical" only means an earlier revision or generation. It does not mean
invalid. A previously selected variant stays active until explicitly removed
or archived. A failed generation has no successful image material to accept and
must not remove existing active variants.

## Workbench Contract

The character workbench has two distinct areas:

1. **Material area:** newly generated, uploaded, Agent-saved, or imported image
   candidates. An unchecked candidate is not part of the character asset.
   Checking candidates prepares a membership change; a visible **Confirm as
   asset** action commits the checked set. Closing the workbench before
   confirmation leaves the asset unchanged.
2. **Asset variant list:** only confirmed active bindings for this character.
   A checkmark means the material belongs to this asset. A separate single
   selection indicates the current image for its role. The list is not a
   cross-asset reference search or a list of all generation history.

Roles may include identity/master, full body, three-view, portrait, look,
expression, or pose. A material can have multiple applicable roles, but each
role needs a clear current selection if downstream workflows require one.
Changing the current portrait must not silently replace the current full-body
identity image. A workbench may show a material and an active binding together,
but they must be visually labeled as the same source material rather than two
independent images.

## Display and Reference Rules

- Project/series asset cards and episode Assets cards show the confirmed
  current default variant. They do not rotate through candidates or historical
  variants. If no current variant exists, show an explicit empty state.
- The explicit library cover field is a legacy display override. The target
  contract uses the current default variant for cards; migrating existing
  covers requires reviewing whether each cover should become the current
  selection. Do not silently discard a user's cover choice.
- Asset details show active variants and their roles. Older revisions and
  archived bindings appear only in a history view, not in the active strip.
- `@` and reference search initially show an asset once with its current
  variant. Expanding or searching that asset reveals its other active variants.
  Loose materials appear only when the user switches to material search.
- The prompt displays only references explicitly inserted into that prompt.
  Index availability is not a submitted reference. The task records the exact
  selected variant or material; subsequent asset selection changes do not
  retarget an already accepted task.

## Revision Boundary

The revision records a user-confirmed asset state, not every generated output.
For an asset, confirmation of multiple checked candidates is one atomic
revision: either all valid bindings and selections commit or none do. Current
selection must point to an active, accessible binding in the same committed
revision. A revision stores material identities and role assignments; delivery
URLs are resolved when viewed or submitted.

When a shot requires a stable look, it should bind the exact asset revision and
variant ID. A later change to the current default can affect future unbound
choices but must not silently replace the shot's accepted reference. A mere
change to asset name or preview URL does not create a new image material.

## Migration From Current Code

1. Preserve all existing variant IDs, selections, cover pointers, URLs, and
   provenance. Treat existing stored variants as legacy attached variants;
   do not claim they passed a review step that did not exist.
2. Introduce material identity and an explicit acceptance state for new
   outputs. New generation writes task output/material first, then commits an
   asset binding only after user confirmation.
3. Add asset revisions at the asset owner (project, series, or global), with
   atomic variant membership and selection mutations. Do not derive revision
   from timestamps, browser arrays, or `schema_version`.
4. Resolve legacy `cover_variant_id` versus selected IDs with a visible user
   decision or a documented compatibility presentation. Remove the second
   display pointer only after migration is verified.
5. Keep owner checks and existing media retention. Unchecking must not delete
   a file used by another asset, shot, saved material, or accepted task.

## Acceptance Criteria For A Future Implementation

- Generating an image changes only task/material state until confirmation.
- Confirming two checked materials adds two active bindings in one asset
  revision; choosing one current variant is a separate explicit decision.
- Agent **Save material** and workbench **Confirm as asset** have different
  persisted effects and unambiguous labels.
- Both asset card surfaces show the same current confirmed image for the same
  asset and never show an unconfirmed candidate as the asset image.
- Workbench active variants are limited to that asset. Reference search can
  discover other assets and loose materials without adding them to it.
- An old shot or accepted generation request keeps its exact reference after
  the asset's current selection changes.
- Existing variants and covers remain readable during migration; no user media
  is deleted or silently reclassified.

## Affected Boundaries For Implementation

- Backend asset/material models, task completion, asset mutation and index
  projections: `src/apps/comic_gen/models.py`, `pipeline.py`, and `api.py`.
- Character workbench, project/episode asset cards, library inspector, `@`
  picker, and storyboard reference submission in `frontend/src/components/`.
- Material retention and reference resolution; tests must cover owner scope,
  candidate confirmation, selection, archived media, and pinned task inputs.

This document defines product semantics. It does not introduce a new endpoint,
database transaction, or automatic migration by itself.
