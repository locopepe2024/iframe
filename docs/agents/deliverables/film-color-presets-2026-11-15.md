# Additive film color discovery

## Scope and assumptions

Add eight neutral, editable color/tonal descriptions to the existing
`Prompt 模板 → 视觉风格` task. Preserve all 45 existing visual style templates,
33 motion templates and 9 multi-view templates. The previous source register,
including Film Grab and Screenweaver, remains authoritative context; see
`docs/agents/context/visual-reference-sources-2026-11-15.md`.

The source audit found Portra and Gold already present, so neither is re-added.
The eight additions offer searchable combinations, not new camera capabilities
or verified physical film simulations. Source labels distinguish independently
written descriptions from source classification/brand references.

## Plan and acceptance checks

1. Bundle the eight descriptions with stable IDs and pinned provenance in a
   separate JSON file and adapter. Verify identity uniqueness across catalogs,
   task classification, absence of implicit media/identity/settings mutations,
   and separation of prompt text from advisory usage notes.
2. Merge discovery entries and tag choices in the existing component. Verify
   that all existing tasks remain available and color/monochrome filters work.
3. Exercise search, preview, edit, cancel and explicit append. No model call,
   reference binding, camera setting or output size change is introduced.
4. Run focused unit/UI tests, TypeScript and a production build. Record actual
   results below before committing.

## Changed surfaces

- `frontend/src/lib/filmColorPrompts.json` — eight descriptions, category and
  per-entry source positions; reference repository/revision and README license
  declaration retained as provenance.
- `frontend/src/lib/filmColorPrompts.ts` — existing discovery entry projection;
  warnings stay in usage hints and are not appended to the generation prompt.
- `frontend/src/components/modules/CharacterPromptDictionary.tsx` — aggregate
  discovery and category choices using both catalogs. No visual redesign.
- Focused catalog and existing dictionary UI tests.

## Boundaries

Combination notes are advisory, not an automatic compatibility engine. They do
not reject a user's intentional mixed look. The full device/shot/lens/quality
matrix, modern makeup dictionary and academy content are outside this slice.
No runtime fetching or import of upstream README instructions is added.

## Verification

- Catalog tests: 3 passed across `filmColorPrompts.test.ts` and
  `openAiCanvasPrompts.test.ts`.
- Dictionary and shared editor UI regression: 80 passed (55 dictionary and
  25 editor tests). This includes color/monochrome filtering, Chinese/English
  search, editable preview, cancel without mutation, and explicit append.
- `npm run typecheck`: passed. The clean-checkout script also bootstrapped a
  production export before running TypeScript.
- `npm run build`: passed. Existing static-export/rewrites warnings remain.
- Extra existing dictionary-preset regression: 19 passed, 1 failed at
  `characterDictionaryPresets.test.ts:207` (height selection). The identical
  failure was reproduced from an isolated Git archive of the unchanged base
  `507ef283985e9a2a86dedce0d8763c596e19956d`; no height code or test is changed.
- After clarifying source attribution and conflict-note wording, all 3 catalog
  and 80 UI tests, production build and direct `tsc --noEmit` passed again.
- Sensitive-pattern review found only the two new public revision literals;
  there are no new credential-pattern or sensitive-file hits.

Deployment, browser visual inspection and image-quality evaluation are separate
from this source-level integration and have not been performed.
