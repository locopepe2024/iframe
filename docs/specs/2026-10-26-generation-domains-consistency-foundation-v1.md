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

## Script-to-asset handoff

The script Skill identifies places before visual design. It keeps separate narrative scenes and physical locations, checks all appearances including nonadjacent ones, and records adjacency, connection and visibility with evidence status. User-confirmed reciprocal visibility between the grain-shop entrance and loft eave belongs to both location candidates. This is not a demand to show the eave in every shop shot. Exact distance, height, facing and occlusion remain unknown until confirmed by source or design.

Entity extraction places the location candidate in `scenes` and the bounded reusable facts in `asset_baseline`; Director interpretation reviews temporal and spatial relationships in `scene_summaries`, `continuity_constraints` and `unresolved_questions`. The present Director schema has no dedicated location graph, so text there is a review surface, not a machine-verified relation. Confirmed scene design is the authority for visual layout; a draft baseline is not an approved scene design.

## Skill coverage audit

| Current instruction | Stage/coverage | Gap |
| --- | --- | --- |
| `scene-asset-extraction` | Reusable scene baseline and temporary-content separation | Previously also decided location identity/merges; move that judgment to script analysis |
| `character-identity-design`, `character-style-routes` | Character identity/look candidates | Does not own script facts or transient shot expression |
| Scene/prop design prompts and workbenches | Structured visual fields, references, revisions | Verify each confirms a revision and records the exact image snapshot; no single catalog Skill covers both |
| `shot-static-framing`, `shot-field-continuity` | First/key-frame static fields | Frame ownership must remain distinct from reusable scene geometry |
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
- Script-mode storyboard draft lineage includes a hash of its approved asset/variant context; changing that context after preview rejects application. The plan-mode transformation retains its confirmed plan contract. The hash covers a bounded planning projection, not the complete visual source or actual attached media; image/video generation pinning remains a separate boundary.
- Only after request-level checks, run fixed-reference image/video comparisons. Prompt and schema tests cannot establish visual or motion quality.

## Verification note

The focused extraction, Director, storyboard and prompt tests pass. Two existing agent-skill tests that install every catalog item fail in an isolated temporary database: total catalog instruction text is about 25,548 characters, above the product's 24,000-character enabled-Skill budget. This budget was not widened; those tests need a selected-Skill fixture or a separate budget test. The failure does not establish a regression in this slice because the new script Skill is loaded by the script/Director pipeline and is not an installable catalog item. No provider image or video output was produced in this slice.
