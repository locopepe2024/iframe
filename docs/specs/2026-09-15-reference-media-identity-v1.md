# Reference Media Identity and Mention Contract V1

Status: specification established; runtime migration not implemented.
Scope: Playground uploads, generated outputs, library selection, selected
references, prompt mentions, session drafts, and generation submission.

## Observed

Code facts at `b909c61`:

- `models.py` defines generated output IDs, but reference inputs are strings.
- `api.py:upload_media` returns a UUID-based file path, not a media record.
- `AssetPickerModal.tsx` lists generation history and its inputs; it does not
  query an independent library-entry registry.
- `service.py:save_to_library` copies a file and sets `saved_to_library`; it does
  not create or return an asset ID.
- `PromptInput.tsx` inserts numbered plain text from selected `inputMedia`.
  There is no structured mention-to-media binding.
- `service.py:create_generation` resolves references to local paths and writes
  those paths into both generation inputs and the saved session draft.

Direct implication: filenames, paths, generated-output IDs, and displayed mention
numbers currently serve different purposes. A visible mention is not evidence
of a persistent media binding or provider-level reference semantics.

Not yet proven: identical reference interpretation across model providers.
No provider semantics are assumed by this specification.

## Identity Rules

| Field | Meaning | Stability and use |
| --- | --- | --- |
| `media_id` | Server-issued opaque ID of one immutable logical media object | Canonical file identity, scoped and authorized by owner |
| `display_name` | Human-readable filename or title | Mutable display only; never lookup, authorization, or deduplication key |
| `asset_id` | Optional library-entry identity | Organization and metadata; references resolve to an explicit `media_id` |
| `generation_id` + `output_id` | Generation provenance | Maps to a media object; not replaced by library save |
| `reference_id` | ID of one selected reference instance in a draft | Mention binding target; retained on reorder and session reload |
| `preview_url` / `thumbnail_url` | Authorized delivery location | Refreshable projection, never durable identity |
| `storage_key` | Server-only storage locator | Never exposed as a client identity or persisted client input |

The canonical field name is `media_id`, not interchangeable `file_id` or
`asset_id`. Original filenames, basenames, array indexes, signed URLs, and
content hashes must not become identity keys.

An upload receives its media ID after successful storage and registration. A
generated output receives its media ID when its file is materialized, regardless
of whether it is saved to the library. Registration is idempotent for the same
output. Library save retains that ID; a physical copy alone does not create a new
logical object. Replacing content creates a new media ID. Byte-identical,
independently uploaded files may have distinct IDs; deduplication is separate.

An existing generated output ID can be adopted through an explicit migration
mapping if uniqueness and ownership are verified. Do not reinterpret arbitrary
legacy path strings as IDs.

## Selected References and Mentions

Every selection entry point uses the same reference operation and schema:

```typescript
type Reference = {
  reference_id: string;
  media_id: string;
  role: 'reference' | 'first_frame' | 'last_frame';
};

type PromptNode =
  | { type: 'text'; text: string }
  | { type: 'media_reference'; reference_id: string };
```

Media metadata and preview URLs are hydrated from the authorized media registry.
They are not a second source of identity in the reference list.

- The `@` menu lists only the active draft's selected references, in list order.
- Historical results, uploaded files, and library entries follow identical rules.
- Selecting a reference does not require saving it to the library.
- UI labels and mentions use the media display name, with no reference ordinal.
  The menu shows a thumbnail and source to distinguish equal names. Raw IDs are
  not primary UI. Reordering does not change names or mention targets.
- Clicking a mention option inserts a structured node targeting `reference_id`.
  It does not add a file, change mode, or resubmit generation.
- Selecting the same `media_id` and role twice focuses the existing reference.
  Different frame roles may deliberately reference the same media object.
- Removing a referenced item leaves an unresolved mention until removed or
  rebound. Submission fails with an actionable error; never silently retarget
  an old mention to the new occupant of an array index.
- Session save/load, undo/redo, queued submissions, and history re-edit preserve
  the structured prompt and reference IDs. Queue entries capture immutable
  snapshots so later draft changes cannot alter an already queued request.

## Persistence and Submission

Version the new draft/request representation explicitly (`reference_schema_version:
1`). Persist ordered `references` and a structured `prompt_document`. A plain-text
prompt is a derived display/provider projection, not a competing editable source.

Server validation must establish that every reference belongs to the current
owner, the media exists, roles/types/counts match the generation mode, and every
mention resolves to a selected reference. A media ID is not an access credential.

Resolve storage paths only at the execution boundary. Generation records retain
the submitted reference snapshot for replay and re-edit. Signed delivery URLs
can expire and be refreshed without changing IDs or prompt bindings.

Provider adapters receive the same validated order of media and compiled prompt.
Provider-specific ordinal syntax or native reference IDs must be verified against
authoritative provider contracts and tested per adapter before enabling it.
Do not send internal media IDs as if providers understand them. A provider lacking
verified targeted-reference semantics must expose that limitation explicitly;
passing numbered ordinary text is not proof of binding support.

## Migration and Boundaries

1. Add owner-scoped media records and idempotent provenance mappings. Inventory
   old upload paths, output references, copied library files, and saved drafts.
2. Resolve legacy paths/URLs only through owned records and trusted storage roots.
   Parse URL components structurally. Delivery signatures are not part of IDs.
   Reject ambiguous, missing, foreign-owner, or unrecognized references explicitly.
3. Existing numbered prompt text may be converted only against a verified matching
   reference snapshot. Where reorder/deletion history makes binding ambiguous,
   preserve the text and require rebinding; never guess the original target.
4. Introduce the versioned request and migrate a complete selectable-media to
   mention to persisted-draft to generation slice before cutting over the UI.
5. Retire writable legacy `input_media` at a documented cutover. A compatibility
   reader may adapt old persisted records, but there must be one authoritative
   reference representation for new writes. Do not accept divergent dual inputs.

Affected paths: `src/apps/playground/{models,storage,api,service}.py`, media registry
storage, `frontend/src/lib/api.ts`, and Playground store, page, media input, picker,
result card, prompt editor, and session serialization code. Library integration
must resolve its entries through the same media owner; this spec does not rewrite
Studio/Atelier state or introduce provider model changes.

## Verification and Release Gates

- Reproduce the current missing structured binding with a failing behavioral test.
- Equal filenames with different media IDs remain distinct.
- One generated file selected from history and library retains the same media ID.
- Uploads and unsaved generated images support the same mention workflow.
- Rename, signed URL refresh, reference reorder, and session reload retain targets.
- Deletion produces an unresolved reference, never a different-image substitution.
- First/last frame roles and queued snapshot ordering remain correct.
- Cross-owner IDs, missing files, and ambiguous legacy references are rejected.
- Each enabled adapter has verified prompt/media binding and a captured request test.
- Migration is repeatable; old drafts and re-edit flows have explicit fixtures.

Local checks: `python -m pytest -q tests/test_playground_media_reference.py
tests/test_multi_user_boundary.py` plus migration/service coverage; frontend
`npm run test:ui -- PromptInput.test.tsx`, session-store tests, `npm run typecheck`,
and `DOCKER_BUILD=true npm run build`. Runtime cutover requires upload, historical
reference, library reference, draft reload, and submitted payload verification.

This specification makes no claim that these release gates have already passed.
The current deployed `b909c61` contains selected-list filtering and display
numbering only. It does not implement this identity and structured binding model.

## Name Display Slice

The next deployment removes numbered labels, uses prompt-derived names for
generated media and original upload names, and persists `media_names` as display
metadata in drafts and generations. The existing `input_media` remains the file
reference authority until the versioned migration. Names never resolve files.
This slice does not claim structured mention binding or add a media registry.
