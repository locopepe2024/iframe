# Asset consistency constraints in the current production flow

Status: design proposal. No editor, generation integration, or output consistency is claimed here.

## Observed

- Confirmed scene, character and prop designs have numbered revisions. Basic meter-based fields exist in `asset_spatial.py`, but asset editors do not expose them.
- Storyboard already has selected reference variants, asset revision pins, a shot visual design snapshot, and a consistency manifest. Image submission snapshots can record the visual design and design revision used at submission.
- `ShotSpatialConstraints` checks the confirmed scene layout revision, selected asset IDs and scene anchor IDs. It does not prove generated pixels obey the layout or validate character and prop revision pins.

## Business flow and ownership

```text
confirmed character / scene / prop designs
  -> asset image variants with historical submission snapshots
  -> storyboard selects asset revisions and reference variants
  -> creator reviews inherited fields and shot overrides
  -> generation submission freezes resolved fields and media identities
  -> creator reviews the output against that frozen submission
```

An asset revision owns reusable identity, appearance and spatial facts. An image variant retains the design revision and effective input used to create it. A storyboard shot owns references, placement, lighting, action and local overrides. Later edits cannot change a completed result or its submitted constraints.

3D is an independent consumer that may obtain and process these assets on its own. It is not a prerequisite for asset confirmation, storyboard design, generation or output review. No 3D camera, collision proxy, animation or rendering gate belongs in this contract.

## Constraint provenance and precedence

Each structured fact has a stable field ID, value, source asset/revision or variant, and state: `confirmed`, `estimated` or `unresolved`. A creator-confirmed design value is accepted input, not proof of model adherence. Image-derived estimates retain their source image identity and extraction method; unknown values remain absent. Conflicts are visible and require review.

For a shot, precedence is explicit shot override, then creator-selected reference projection, then pinned asset baseline. A reference image alone does not transfer its structured fields. Existing same-place/time continuity rules govern which fields may be selected. The preview shows source value, target value and final value. A lighting-tab redesign replaces inherited lighting for this shot.

## Scene asset

Keep fixed place identity, landmark names and relative directions, entrances/windows, approximate dimensions where known, materials and a separate lighting baseline. Qingxi street's grain shop and loft are distinct landmarks. Their intended two-way visibility can be recorded as two directed relationships; each generated view must be judged separately. A near, middle or far image variant can retain the same scene identity and fixed relations. Unknown depth and distances stay unresolved. Temporary crowds, one-shot obstacles and framing belong to the shot.

## Character asset

Keep stable face, hair, distinctive marks, wardrobe variant, build and relative or metric height, tied to the approved character design and reference images. Current height, body width and single-arm reach fields remain useful when measured. Optional arm span is distinct from reach. For stylized bodies, optional leg length / torso length, shoulder width / head width, and head height / total height ratios belong to the same character design revision. Leg length is measured from hip to floor, torso length from hip to shoulder line, and head height from crown to chin. Unknown measurements remain absent; ratios are dimensionless and must not be inferred from an image without an explicit review. Pose, expression, action, screen position and apparent scale are shot choices. A saved face preset or metric white model is an input constraint, not a face-lock guarantee. Deliberate age, costume or body changes use explicit variants/revisions while prior shot pins remain intact.

## Prop asset

Keep silhouette, materials, distinctive details, dimensions when known, and named usable parts such as a handle. Current `dimensionsM` and `gripLocalM` describe only one basic size/grip. Multiple grips or changeable states need explicit revisioned fields. Which character holds the prop, which hand, orientation, placement and time-dependent state belong to the storyboard.

## Generation closure

1. Read selected confirmed asset revisions and show missing or estimated fields. The creator chooses the reference variants for this shot.
2. Resolve effective structured fields with their sources, conflicts and overrides. Preserve image identities as separate reference inputs.
3. Preview effective prompt, selected media, revision pins, field values and overrides. Freeze the resolved state and checksum at submission. Changes to a pin or reference invalidate an unsubmitted preview. The actual request must match that frozen state.
4. Show the frozen submission beside the result. Human review records match, conflict or unable-to-judge for scene landmarks and lighting, character face/body/height relations, and prop identity/scale/use. Input checks do not prove visual consistency.

Use existing consistency manifests and submission snapshots as the truth surfaces. Do not introduce a second mutable copy of shot state. `ShotSpatialConstraints` remains optional supplemental data for ordinary image/video generation.

## Implementation slices and acceptance

1. Extend asset schemas only for fields captured by current editors. Validate finite positive dimensions, stable IDs, references, status and source identity. Keep v1 readable; missing fields remain unresolved. Verify draft/confirmed revision save and reload.
2. Surface concise constraint editing in scene, character and prop design. Show selected reference variant's historical revision beside current design. Verify new asset revisions do not mutate old variant snapshots.
3. Project opt-in reference fields and asset facts into storyboard preview. Verify conflict display and that explicit lighting replaces inherited lighting.
4. Freeze effective constraints in image/video submissions and show them for result review. Verify preview/request parity, stale-preview rejection and historical immutability using request-capture tests. Real generated samples are required before claiming output improvement.

Likely affected paths: `src/apps/comic_gen/asset_spatial.py`, asset save/read and submission paths in `pipeline.py` and `api.py`, existing visual continuity projection, `frontend/src/lib/assetSpatialConstraints.ts`, current asset design/storyboard UI, and focused persistence/request tests. 3D code and the media host are out of scope.
