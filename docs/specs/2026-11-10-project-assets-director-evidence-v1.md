# Project assets and Director evidence

## Scope

All project workflows expose one Assets stage for character, scene and prop design/generation. Character voice binding stays in CharacterWorkbench. Cards show actual frame reference counts; a repeated ID in one frame counts once. Internal navigation targets Assets. Series shared assets remain separate.

Director analysis receives no confirmed Fact Ledger IDs. Its generation schema must therefore exclude `explicit` evidence on events and relationship states and require empty citations. Refinement can retain existing citations but cannot invent new ones. Confirmation continues to reject explicit claims without confirmed citations.

Existing drafts may contain uncited explicit claims. Show their locations and an explicit action to classify just those claims as Director interpretation. This only edits the visible draft; saving and confirming remain separate actions. Never invent citations or silently change saved/confirmed content. Invalid or rejected citations remain blocked by server validation.

## Verification

- Project navigation tests: scripted, legacy and freeform expose one Assets stage; storyboard navigation opens the canonical workbench.
- Asset UI test: character, scene and prop counts derive from frame references.
- Director tests: generation/refinement schema, preserved confirmation guard, visible repair and no implicit save/apply.
- Focused Python and frontend tests, frontend typecheck/build.
- Isolated GreenA candidate from the active host source, read-only replay of the failing draft, then deployment with backup and document integrity verification.
