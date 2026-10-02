# Character identity design Skill v1

## Observed

- The character workbench already submits an editable prompt, style positive/negative prompts, and generic quality exclusions.
- The image editor saves a modified image copy and does not define durable character identity.
- The owner-scoped Skill catalog can expose installed and enabled instruction packages, but Skill instructions must not be sent verbatim as provider image prompt text.

## Direct implication

- Character appearance guidance belongs in the character workbench.
- The workbench needs a structured, user-editable representation of suggestions so accepting a suggestion is distinct from merely installing a Skill.
- Generic negative prompts remain quality controls; they do not replace identity fields.

## Contract

`character-identity-design` is an owner-installable Skill with two surfaces:

1. `instructions`: guidance for an Agent or future prompt assistant;
2. `workbench_facets`: short bilingual suggestions that the UI may offer as editable prompt fragments.

The UI only reads facets from an enabled installation. Clicking a facet appends its text to the editable prompt. The user may change or remove it before submission. No facet is automatically applied merely because the Skill is installed.

## Boundaries

- The Skill does not choose a model, provider, SKU, size, ratio, or generation mode.
- The Skill does not alter the image editor.
- The Skill does not write suggestions into the original script or Director profile.
- Global style controls overall image language; the Skill controls character identity and continuity.
- Generic negative prompts remain separate from character identity constraints.

## Success criteria

- The catalog exposes the Skill with a content-addressed revision and structured facets.
- An enabled Skill appears in the character workbench only; scenes and props do not show character facets.
- A clicked facet becomes editable prompt text and is not submitted as hidden metadata.
- Existing generation and image-editor flows remain unchanged.

## Verification

- `pytest -q tests/test_agent_skills.py`
- `python3 -m compileall -q src/apps/agent_skills.py`
- `npm run typecheck`
- `npm run test:ui -- src/components/modules/cast/CastWorkbenchModal.test.tsx`
