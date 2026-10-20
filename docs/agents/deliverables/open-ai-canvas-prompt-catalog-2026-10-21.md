# Open AI Canvas Prompt catalog

## Contract

Import the 45 style, 33 motion and 9 contact-sheet/projection text definitions from
Open AI Canvas revision 86ebb6c5345287c645e857a8f550901bb6fd4bd8,
`backend/internal/tools/seed/tools.json`. Preserve prompt text verbatim, stable
upstream keys, tags, descriptions and ratio hints. Copy no remote images/videos,
owner IDs or runtime state. MIT attribution accompanies the bundled catalog.

The upstream catalog is structured metadata around text prompts, not a typed
character-field schema. Do not infer face/body fields or constraints from prose.

## UI boundary

Keep 基础面板 / 词典 / Prompt 模板. Add three explicit template tasks:
视觉风格, 运镜, 多视图与推演. Preserve upstream tag filters, allow preview text
editing before explicit insertion, and retain existing text/reference handling.
Motion is intended for video/storyboard; contact sheets require a source image.
Display these hints without binding a reference or changing model/aspect ratio.
No automatic generation, aesthetic rewriting, or identity constraint mutation.

## Verification

Catalog counts and unique IDs, exact source-text parity, excluded media,
explicit classification, editable insertion and scope/ratio hints. Run panel UI
regressions, catalog unit tests, TypeScript and production build.

## Template insertion correction

Template application appends after the full current draft, regardless of cursor
position. Remove only the active slash query; preserve following text, selected
text from toolbar opening and reference nodes. Add a sentence terminator only
when missing, then a line break. Empty drafts receive no leading punctuation.
Placeholder and individual dictionary-term replacements retain their local range.
Stale template selections must not overwrite a changed document; one undo restores
the original draft.
