# Scene crowd layer contract v1

## Purpose

Scene design must separate reusable spatial composition from shot-only events. Crowd
and signage are authored by visibility layer so a person or text element that enters
the readable foreground can be promoted to a stable asset instead of remaining an
uncontrolled background detail.

## Layer ownership

The current implementation allows `crowd_design` with `near`, `mid`, and `far`.
These are camera-relative visibility layers, not permanent scene geography.
Reusable scene geography owns physical crowd zones and routes; each shot projects
those zones into near/mid/far according to its camera. Migrating the current
scene-level fields to that ownership is pending.
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

## Series extra roster

A production may maintain a reusable roster sized by script coverage and repeated
appearances. The Skill may propose a reviewable batch of candidates; a batch size
is not a required count and candidates are not confirmed assets. A roster entry is
either a fixed extra (`extra_id`) with
approved face, height, body build, wardrobe and recurring props, or an extra template
(`extra_template_id`) with bounded age range, body-type range, palette and wardrobe family.

Shots reference roster entries through shot-scoped instances. An instance records the
selected layer, screen region, relative scale, facing, path or motion, and whether the face
or carried text must be readable. The roster is reusable across locations; the instance is
where a character enters a particular street, shop, or battle formation. Anonymous far
background agents do not require roster entries.

Principal, supporting, fixed extra, and anonymous group are production tiers,
not incompatible identity systems. A fixed extra promoted to a supporting role
keeps its confirmed identity ID and receives any missing character detail through
an explicit reviewed asset decision. A close camera creates a need for a readable
identity reference; it does not silently create one. A template is not a fixed face.
Shot assignments must be explicit and stable rather than newly randomized on each
prompt build. This stage contract is in
`config/agent_skills/performer-tier-continuity/SKILL.md`.

## Implementation status

The asset extraction and storyboard LLM prompt paths load the shared performer
tier Skill. Current `Series.extra_roster` and `StoryboardFrame.crowd_instances`
work is in progress and is not an image-generation or face-locking pipeline.
There is no reviewed batch proposal UI or automatic assignment UI yet. The
current roster API accepts confirmed records directly; callers own review.

## Evidence boundary

This contract guarantees structured intent and provenance, not that a video provider will
render every face or glyph correctly. Validation requires fixed-scene generations at near,
mid, and far framings, with provider/model/version and observed frame samples recorded.
