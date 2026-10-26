# Scene crowd layer contract v1

## Purpose

Scene design must separate reusable spatial composition from shot-only events. Crowd
and signage are authored by visibility layer so a person or text element that enters
the readable foreground can be promoted to a stable asset instead of remaining an
uncontrolled background detail.

## Layer ownership

Each confirmed scene design may contain `crowd_design` with `near`, `mid`, and `far`.
Each layer records:

- `identity_policy`: `asset_required`, `template_allowed`, or `unidentified`
- `density`: bounded text describing approximate density
- `subjects`: reusable subject or group labels
- `text_elements`: fixed readable signs, banners, or storefront text
- `motion`: bounded movement/path rule

Near layer is for faces, hands, clothing marks, props, and readable text. `asset_required`
is the default when an element is close enough to be recognized or recurs across shots.
Mid layer may use a reusable extras template. Far layer may use anonymous silhouettes or
simulated agents and is governed by density, direction, and region rather than identity.

## Consistency behavior

Confirmed scene revisions and shot consistency manifests carry `crowd_design`. Prompt
compilation must preserve the layer policy and must not promote shot-only people or events
into reusable scene assets. Camera perspective may change apparent size; it does not change
the authored identity or physical scale of an asset.

Readable signage is an asset concern. If exact text matters, the text belongs in
`text_elements` and should be supplied as a controlled image/vector or postproduction layer.
Prompt-only text is treated as unverified provider output.

## Evidence boundary

This contract guarantees structured intent and provenance, not that a video provider will
render every face or glyph correctly. Validation requires fixed-scene generations at near,
mid, and far framings, with provider/model/version and observed frame samples recorded.
