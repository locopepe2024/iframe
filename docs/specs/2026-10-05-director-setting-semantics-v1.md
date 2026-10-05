# Director setting semantics v1

## Observed

- `DirectorProfile.setting` is an open dictionary. The earlier generation prompt required an object but did not define its internal keys.
- The visual editor displayed every unrecognized key as its raw name. Existing drafts can therefore show `era` beside `time_period`, or `primary_location` beside `locations`.
- `style_config` is selected separately; `visual_language` carries Director visual direction. Shooting plans own concrete scene time, place, cast and props.

## Default template

The built-in Director overview template asks for six string fields in `setting`:

| Field | Meaning | Boundary |
| --- | --- | --- |
| `format_genre` | Work format and narrative genre | Not visual style |
| `locations` | Region and major story locations | No per-scene room or blocking |
| `time_period` | Historical era and story span, including unknowns | No separate `era` or `session_time` |
| `social_context` | Social, cultural and world rules affecting behavior | No invented facts |
| `dramatic_contrast` | Source-supported contrast between people, relationships or events and its narrative role | Empty when unsupported |
| `spatial_motif` | Recurring spaces with a narrative role | Not a second location list |

Scene time, interior/exterior, weather and specific place belong to scene summaries and shooting plans. Visual style belongs to style selection and `visual_language`. Evidence status belongs to facts/events, not `setting.status`.

## Compatibility

Old drafts retain all additional keys. The editor shows them in a collapsed legacy section with editable values; saving does not silently delete or merge them. A future explicit migration can consolidate duplicates after reviewing their values and evidence.

## User-configurable overview template

- Store the template separately from Director conclusions. Template changes must not rewrite a confirmed profile or force existing shooting plans to regenerate.
- A template field needs a stable key, user-facing label, purpose, evidence requirement, order and enabled state. User-defined fields are allowed; their keys must not collide with the reserved profile fields.
- Scope: a series template can be inherited by an episode; the episode may override it. Snapshot the effective template identity/revision with each new analysis draft so reopening that draft uses the same field meanings.
- The analysis prompt should receive the effective template and ask the model to populate its enabled fields. The built-in six fields are defaults, not a permanent limit on user-configured fields.
- An asynchronous job captures the effective template at submission. Its draft stores that template snapshot so later edits retain the original field meanings.
- Keep a raw/advanced editor for unexpected historical fields and preserve them during save. Template removal hides a field from new generation; it does not delete existing content.
- The template describes *what to analyze*, while selected style describes *how to render*. A martial-arts animation style preset belongs to style selection, not a replacement for the Director overview template.

Implementation uses a separate template contract, persistence and generation handoff. A project may inherit the series template or save an override. The effective template and revision are included in the analysis job fingerprint. Saving a template does not mutate a Director profile.

## Verification

- Existing draft with duplicate time/place fields remains readable and editable.
- New generation and refinement prompts request the six canonical keys only.
- Applying a draft retains unrecognized fields and downstream profile compatibility.

## Current script verification

- Runtime observation (local request capture): the supplied `武林传·苍桐` source file contains 60 consecutive episode headings. Episode 1 contributed 2,363 characters to the captured Director request.
- Runtime observation: a custom `jianghu_rules` field and the selected `中式武侠动漫` style both reached the request in separate template/style sections. The internal template key was excluded from the story entity section.
- Not yet proven: model output quality with the live provider, or the effect of the template on downstream storyboard quality. The request-capture test uses a mock response and does not spend a generation call.
