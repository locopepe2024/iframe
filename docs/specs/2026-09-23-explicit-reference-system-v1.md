# Explicit reference system across Studio generation surfaces V1

Status: implementation contract for the next Cast/Assets slice.
Date: 2026-09-23.

## Observed

- Cast already lets a user upload or choose several image variants through a
  library picker, but `CastWorkbenchModal` keeps those choices in
  `generationReferences` and submits them directly when reference mode is
  selected. The prompt field is still a plain textarea. This makes a selected
  image an implicit provider input.
- The character Assets workbench already uses `ReferencePromptEditor` and
  structured token attributes (`asset_type`, `asset_id`, `variant_id`). It
  submits only references reported by the editor. Manually typed `@name` text
  is not resolved to an asset.
- Storyboard R2V and Recreation have separate, domain-specific reference
  protocols. Storyboard maps selected asset variants to ordered provider
  pictures; Recreation stores shot reference bindings. They must not be
  collapsed into image-asset prompt mentions.
- Playground has its own selected-media/session reference model. Its current
  editor supports ordinary media names and must retain its existing
  persistence contract while shared editor behavior is extracted.

## Direct implication

Selecting a file and mentioning a file are different operations:

1. **Available reference pool**: the user uploads or selects one to N stable
   asset variants. This is local UI state and is not provider input by itself.
2. **Explicit prompt binding**: the user types `@` in the generation prompt,
   chooses a candidate, and inserts a structured token. The token carries
   stable asset and variant IDs and remains visible as `@name`.
3. **Submission snapshot**: only tokens still present in the prompt are
   converted, in document order, to `references`; no URL or display-name
   lookup is allowed. An empty token set submits text mode and no references.

The generation mode is an explicit request field. The UI may derive its
current value from the token set for convenience, but a picker selection must
never silently switch a text request to reference mode.

## Product contract

```ts
type AssetLibraryReference = {
  asset_type: "character" | "scene" | "prop";
  asset_id: string;
  variant_id: string;
};

type ReferenceCandidate = {
  label: string;
  reference: AssetLibraryReference;
  previewUrl?: string;
  sourceLabel?: string;
  variantLabel?: string;
};
```

- Cast's "设置为参考图" / upload / library picker adds or removes candidates
  in the available pool only. It never adds provider references on its own.
- Selecting a Cast gallery variant as the current canonical image also adds
  that variant to the available pool, so several gallery images can be
  prepared before writing the prompt.
- Cast's `@` suggestion menu is anchored to the **生成描述** editor. It lists
  only candidates from the available pool and inserts a rich token with the
  stable IDs above.
- Assets' upload and multi-select controls have the same available-pool
  semantics. Its existing character panels use the same editor contract.
- Removing an image from the pool removes any matching prompt tokens and the
  next submission fails or falls back to text only according to the explicit
  UI contract; it must not retarget a token to another variant.
- Removing a token from the prompt removes that reference from the submitted
  ordered list. Token order is provider input order.
- Candidate labels are display-only. Names, URLs, signed URLs, array indexes,
  and selected/default flags are never identity or authorization keys.
- A provider reference limit is enforced by the server; the client may cap
  the picker at the current limit (nine for Studio image assets).

## Surface matrix

| Surface | Prompt control | Candidate source | Binding protocol | Status / gap |
| --- | --- | --- | --- | --- |
| Cast character/scene/prop | Cast 生成描述 | project/series/global asset index + uploads | structured `@` token | implemented in this slice |
| Assets character panels | each panel prompt | project asset index + panel uploads | structured `@` token | implemented in this slice |
| Assets scene/prop detail | image generation description | project asset index + uploaded variants | structured `@` token | implemented in this slice |
| Asset Inspector quick-variant action | no prompt editor | selected asset is only the generation subject | text-only variant reroll | intentionally no references; add an editor before enabling refs |
| Playground image/edit | Playground PromptInput | selected media/session | Playground media reference contract | separate contract; do not regress |
| Storyboard R2V | shot prompt / asset drawer | selected asset variants | ordered picture/subject mapping | separate video contract |
| Recreation | shot description | shot reference assignments | recreation shot binding | separate contract |
| Agent | Agent composer | owner-validated attachments | multimodal attachment contract | separate agent contract |

## Boundaries and non-goals

- Do not infer a reference from a selected/default asset, an asset name, or
  the presence of an uploaded image.
- Do not make `@` text in one surface imply provider syntax in another. The
  server compiles structured references per provider capability.
- Do not merge image asset mentions with Storyboard `<Picture N>` mapping,
  Recreation shot references, or Agent attachments.
- Editing an existing image with a source canvas remains an explicit edit
  context; its source image is part of that editor request, not a hidden asset
  mention.
- This slice does not change CDN delivery, provider routing, model selection,
  asset ownership, or the maximum reference count.

## Success criteria

- Cast can select/upload multiple candidates, see them above the 生成描述
  editor, and use `@` to bind zero to N candidates.
- Cast submits text mode with an empty `references` array when candidates are
  selected but no token is present.
- Cast submits stable IDs in prompt order; deleting a token removes only that
  binding.
- Assets preserves the same semantics after upload and refreshes its candidate
  index without requiring a page reload.
- Focused tests cover picker-vs-token distinction, ordering, token deletion,
  and absence of URL/name inference.
- The audit identifies every remaining image/video generation surface and
  records whether it uses this image-token contract or a separate protocol.

The Asset Inspector's "generate more variants" action remains a text-only
quick action with no reference picker or prompt editor. It does not currently
submit a hidden provider reference; if that action later gains a prompt or
reference control, it must adopt this contract rather than reusing a selected
variant implicitly.

## What would verify it

- Frontend request-capture tests assert the exact `generateAsset` arguments.
- Backend validation tests reject `image_generation_mode="text"` with
  references and `"reference"` without references.
- Typecheck, UI tests, production build, targeted Python tests, and compileall
  pass. Runtime browser validation is separate and requires explicit approval
  under the repository browser-access rules.
