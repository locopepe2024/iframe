# Character prompt language policy v1

## Observed

- The character workbench builds default image prompts with English template text
  around Chinese name and description fields.
- The backend has a second copy of those fallback templates, plus an English
  default style suffix and English reverse-reference instructions.
- User-entered prompts and art-direction style text can intentionally be in
  English, so their language cannot be inferred from the entity description.

## Direct implication

- A newly generated character prompt is often mixed Chinese and English, and a
  Chinese description ending in `。` can be followed by an English `.`.
- Frontend and backend defaults can drift because they construct the same
  prompt independently.

## Policy

1. System-generated character image and motion templates use Simplified Chinese,
   including the default style suffix, reverse-reference wording, and default
   negative prompt.
2. User-authored prompt text and art-direction style text are preserved verbatim;
   this change does not silently translate or rewrite creative input.
3. New templates join description fragments with Chinese punctuation and remove
   duplicate terminal punctuation.
4. Persisted custom prompts are not rewritten automatically. A prompt stored from
   an older version remains user-editable and is only replaced when the user
   chooses the generated default path.

## Not yet proven

- Mixed prompt language is a possible consistency/UX problem. This change does
  not claim that it alone changes provider image quality.

## Success criteria

- New frontend defaults for full-body, three-view, headshot, and motion prompts
  contain no English scaffolding.
- Backend fallback prompts and default style/reverse-reference text follow the
  same Chinese policy.
- Existing custom English style/prompt input remains unchanged.
- Frontend and backend regression tests cover the default paths.
