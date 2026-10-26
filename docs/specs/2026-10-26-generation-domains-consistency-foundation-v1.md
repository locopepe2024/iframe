# Generation domains and consistency foundation V1

## Evidence and scope

Code fact: entity extraction currently loads `scene-asset-extraction`; Director interpretation has a separate preset; storyboard analysis receives resolved asset descriptions and optional confirmed plan context. Asset revisions and image variants have identities and submission snapshots. A frame can carry a `StoryboardConsistencyManifest` with asset pins, reference projection and shot fields. These mechanisms do not prove that every image and video provider request consumes the same frozen values.

This change establishes the script-analysis boundary and its loading in extraction and Director interpretation. It also projects approved asset design revisions and currently selected variant identities into script-based storyboard analysis. It does not migrate existing assets, silently accept a Director draft, attach the selected media to that LLM request, or claim visual consistency from prompt inspection.

## Work domains and owners

| Domain | Owns | Reads | Must not decide |
| --- | --- | --- | --- |
| Script analysis | Source-backed events, people, location candidates, chronology, place relations and uncertainties | Original script, user confirmations, source/series versions | Faces, costume, materials, camera, action choreography |
| Image design: character | Stable identity and approved look, reference variants | Script identity and confirmed style | Current shot expression, gaze or action |
| Image design: scene | Reusable fixed layout, landmarks, material and lighting design; spatial reference variants | Confirmed place identities/relations, script time cues | Plot events, temporary crowd, one shot's framing |
| Image design: prop | Reusable identity, shape, scale and material; reference variants | Script prop identity and confirmed style | Current owner/hand, damage event or movement |
| Image design: first/key frame | One instant's composition, viewpoint, blocking and visible lighting | Script event, confirmed assets, shot start/key state | Full motion sequence or permanent scene layout |
| Shot design | Time process: beats, acting, action physics, martial arts, effects, camera motion and transitions | Approved script/plan, asset versions, first/key frames | Asset identity, permanent look or source facts |
| Model adapter | Complete request text, media mapping and model parameters | Accepted design and frozen references | New story, camera or action decisions |

The structured consistency layer is a cross-domain resolver and checker, not an author. The asset library is the source of approved revisions, media identities, variants and snapshots, not a script fact source. Every stage must distinguish candidate, confirmed value and generated result. A locked generation retains its input snapshot; an unlocked design may resolve the current approved variant. Deleted or unavailable variants are reported as missing, never silently replaced.

Martial choreography, contact physics and expression timing are time-based Shot Design methods. Space structure, viewpoint and composition for the first frame or a timestamped key frame belong to image design. The existing `shot-static-framing` endpoint currently edits only the 0.00-second start frame; its presence does not establish a key-frame design workflow. Reusable location geometry belongs to scene assets, while one frame's composition belongs to that frame.

### Static frame and motion handoff

The image deliverable is a state at a named time, not a description of the intervening motion. A first frame uses `t=0.00`; a future key frame needs its own timestamp, confirmed state and media identity. For each static state, resolve location/asset IDs and approved revisions, selected reference media, visible subjects and props, blocking/depth, pose and gaze at that instant, viewpoint, shot size, composition and effective light with sources. A scene asset supplies stable geometry; it does not decide which part of the scene is in the image. A planned frame and an actually selected/generated image must retain distinct statuses.

The motion deliverable reads the accepted starting state and optional confirmed key states. It specifies ordered visible changes: action and martial technique, contact/force and prop response, expression/gaze transitions, effects, camera trajectory, timing, end state and transition. A fight Skill can request a view in which wrist action or impact is readable, but only image/camera design selects the frame or camera path. A key frame can constrain the result at its timestamp; it cannot by itself establish how the sword or body moved between frames. Model adapters compile these contracts for H3/Seedance without becoming their owners.

`shot-field-continuity` is currently a mixed-field review endpoint. Its single JSON result is not a new shared owner: static shot size/angle are image candidates, duration/camera movement are temporal candidates, style/light overrides require consistency resolution, and transition is inter-shot. Each candidate needs separate acceptance and lineage. The existing editor has no independent timestamped key-frame persistence, so this is a target contract rather than a claim of implementation.

## Script-to-asset handoff

The script Skill identifies places before visual design. It keeps separate narrative scenes and physical locations, checks all appearances including nonadjacent ones, and records adjacency, connection and visibility with evidence status. User-confirmed reciprocal visibility between the grain-shop entrance and loft eave belongs to both location candidates. This is not a demand to show the eave in every shop shot. Exact distance, height, facing and occlusion remain unknown until confirmed by source or design.

Entity extraction places the location candidate in `scenes` and the bounded reusable facts in `asset_baseline`; Director interpretation reviews temporal and spatial relationships in `scene_summaries`, `continuity_constraints` and `unresolved_questions`. The present Director schema has no dedicated location graph, so text there is a review surface, not a machine-verified relation. Confirmed scene design is the authority for visual layout; a draft baseline is not an approved scene design.

## Skill coverage audit

| Current instruction | Stage/coverage | Gap |
| --- | --- | --- |
| `scene-asset-extraction` | Reusable scene baseline and temporary-content separation | Previously also decided location identity/merges; move that judgment to script analysis |
| `character-identity-design`, `character-style-routes` | Character identity/look candidates | Does not own script facts or transient shot expression |
| Scene/prop design prompts and workbenches | Structured visual fields, references, revisions | Verify each confirms a revision and records the exact image snapshot; no single catalog Skill covers both |
| `shot-static-framing` | 0.00-second first-frame size, angle and composition candidates | No saved timestamped key-frame design yet; frame ownership differs from scene geometry |
| `shot-field-continuity` | Mixed-field review of image, temporal and consistency candidates | One review response does not confer common ownership or acceptance |
| `shot-action-physics`, `shot-martial-choreography`, `micro-expression-timing` | Timed action, fight and expression methods | Belong to Shot Design; should not be injected into asset images or script analysis |
| H3/Seedance instructions | Model-specific compilation | Do not become a second owner of action, composition or asset identity |

## First implementation slice

1. Add a concise script-analysis Skill for location coverage and relations. Load it in entity extraction and Director interpretation; keep the scene Skill limited to reusable visual baselines.
2. Include the script Skill bytes in extraction and Director job fingerprints so changed rules do not reuse old AI results.
3. Project only bounded summaries of confirmed design revisions and selected asset variant identities into the storyboard LLM context. Entity IDs remain the binding keys. A missing selected variant is marked missing; it is not replaced. The variant ID is an index, not evidence that its image was attached to the model. Full visual design remains owned by the asset workbench and is resolved again by downstream image/video requests.
4. Verify prompt contents, hash changes, and extraction/Director/storyboard tests. Existing drafts remain unchanged; no auto-promotion of model claims to confirmed facts.

## Subsequent acceptance gates

- A reviewed location relation must have stable source/target location identities, relation type, evidence status and source/user confirmation. Test the two street corners and reciprocal shop/loft sightline before asset design.
- Asset and frame reference resolution must show exact approved revision, variant/media identity and source scope. Missing variants produce a visible conflict, not a fallback. Test live unlocked edits and locked generation snapshots.
- Capture actual image and video provider payloads for the same shot. Confirm they use the same accepted visual baseline while applying their own static or timed fields; stale preview tokens must reject changed inputs.
- Verify a 0.00-second image preview cannot acquire a later martial contact or facial change; verify an accepted key-frame state, once supported, stays timestamped and does not replace the first frame. Verify the video request receives the accepted start state plus motion contract and does not interpret a fight Skill's camera visibility request as an unreviewed camera change.
- Script-mode storyboard draft lineage includes a hash of its approved asset/variant context; changing that context after preview rejects application. The plan-mode transformation retains its confirmed plan contract. The hash covers a bounded planning projection, not the complete visual source or actual attached media; image/video generation pinning remains a separate boundary.
- Only after request-level checks, run fixed-reference image/video comparisons. Prompt and schema tests cannot establish visual or motion quality.

## Verification note

The focused extraction, Director, storyboard and prompt tests pass. Two existing agent-skill tests that install every catalog item fail in an isolated temporary database: total catalog instruction text is about 25,548 characters, above the product's 24,000-character enabled-Skill budget. This budget was not widened; those tests need a selected-Skill fixture or a separate budget test. The failure does not establish a regression in this slice because the new script Skill is loaded by the script/Director pipeline and is not an installable catalog item. No provider image or video output was produced in this slice.

## Request projection slice

Code fact: the image preview already includes confirmed scene `asset_baseline` fields. The video draft previously read only the continuity row's effective style and light; its manifest and source hash recorded provenance but did not insert fixed scene geometry into the submitted text. The continuity row now carries the confirmed scene identity, location type, fixed geometry, landmarks, materials, environment and reusable constraints. Its visual source hash includes that projection. The unoptimized video draft appends this scene baseline, and the submission preview uses the same assembled text. Unconfirmed scene drafts are excluded. An accepted complete model prompt remains user-authored text and is not silently amended; its existing stale-source warning remains the review path.

This is a text-input boundary check, not proof of provider visual consistency. The video reference image selection and actual provider media mapping remain separate from the new scene-text projection. Character/prop visual descriptions, reference-selected spatial fields, and an independent timestamped key-frame contract still need request-level acceptance tests before claiming a fully shared frozen image/video visual baseline.

The next source-boundary slice extends the video preview hash to the shot's explicit variant selections, reviewed episode character looks, confirmed designs and selected variant media identities. The create-task API already compares this hash before creating a task; a changed selection or replacement now invalidates the old preview. The hash does not validate that the submitted reference URLs are the same media, and it does not add character/prop design prose to either model request. Variant-specific design snapshots may refer to an older approved revision; that revision must be resolved before a shared character/prop prompt projection is introduced.
