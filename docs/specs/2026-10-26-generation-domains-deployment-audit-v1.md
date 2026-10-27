# Generation domains and Skill capability audit before deployment

Date: 2026-10-26. Scope: current `fix/shot-tail-timing-20261024` branch, not a live provider or production audit. Evidence labels distinguish implemented code, direct implications, and unverified outcomes. The ownership contract is in `2026-10-26-generation-domains-consistency-foundation-v1.md`.

## Observed

| Business domain | Implemented owner and capability | Skill/method status | Remaining boundary |
| --- | --- | --- | --- |
| Script analysis | Entity extraction loads `script-analysis` and `scene-asset-extraction`; Director interpretation loads script analysis. Prompt revision includes Skill bytes. Separate location candidates, current events and uncertain relations are requested. | `script-analysis/SKILL.md` owns source-backed place/event analysis. `scene-asset-extraction/SKILL.md` owns reusable place baseline. | `scenes` and Director `scene_summaries`/`continuity_constraints` carry text; no stable, reviewed location-relation graph enforces reciprocal shop/loft sightlines or distinct street corners. LLM compliance needs case-level review. |
| Character design | Confirmed design revisions, episode look selection and variant/media identity are resolved for shot image/video text. | `character-identity-design` and style routes guide design candidates. | Request-text checks do not establish that generated faces match the approved look. |
| Scene design | Confirmed scene revision, fixed geometry, landmarks, materials, environment and lighting baseline enter the continuity row and image/video draft projections. Variant design snapshots exist. | Scene extraction guides reusable content; structured scene tools and revision confirmation belong to the asset workbench. | A reference image's visual facts and source parameters are not proven equivalent for every old or uploaded variant. Exact reciprocal spatial geometry remains unconfirmed where the script lacks it. |
| Prop design | Confirmed prop design and selected variant are resolved; missing variants/revisions block image preview and video task creation. | Prop workbench owns stable shape/material; no independent catalog Skill is the authority for its revision. | Provider reproduction of scale/material remains unverified. |
| First/key frame image | First-frame candidate prompt reads confirmed scene and character/prop state; `shot-static-framing` proposes reviewable start size, angle and composition. Tail image has its own selected media. | Static framing owns the 0.00-second image; timed action Skills are excluded from this ownership. | No independent timestamped key-frame design/approval state. A selected tail image is not a general key-frame workflow. Static-frame versus later-action separation needs fixed-case provider comparison. |
| Shot motion | Frame fields and continuity manifest snapshot provide the submitted motion context. `shot-action-physics` and `shot-martial-choreography` are loaded from observable action terms for polish; micro-expression has a separate timed candidate contract. | Motion Skills own causal action, fight and gaze timing; H3/Seedance guidance compiles model prose. | First-stage model-independent field decisions and second-stage model compilation are not fully separated. Old whole-prompt polish still operates. Temporal action/impact quality requires video observations, not prompt inspection. |
| Shared consistency and library | Source hash covers confirmed scene projection, selected asset variants/media IDs and reviewed episode looks. Image preview and video creation reject missing visual sources. R2V image submission validates ordered asset/variant/media identity against submitted URLs and stores task inputs. Locked video tasks retain snapshots. | A cross-domain resolver/checker, not an authoring Skill. | Legacy R2V callers omit ordered identities; their URLs remain compatible but unverified by the new check. External URLs are compared as strings, not immutable remote bytes. Video-reference roles and pose references do not yet have the same ordered asset validation. A manifest exists, but provider payloads have not been proven to consume every manifest field as sole truth. |
| Model adapter | H3 V2 modes, media roles, duration and ratio are validated at the adapter. First/last frame defaults to `adaptive` when ratio is absent; explicit fixed ratio is preserved. | Model-specific constraints do not own creative decisions. | Actual H3/Seedance output fidelity, timing and cross-model semantic equivalence need controlled generation tests. |

## Direct implication

The structured consistency layer is partially operational at the request boundary: it resolves approved asset text, detects changed sources, and freezes selected identities. That supports traceability. It does not prove visual or motion consistency. The asset library holds confirmed revisions and variants; `frontend/src/lib/characterMoveDictionary.ts` is currently a client-side curated action vocabulary, not a versioned server-side library with independently verified reference media. `move_ref` and `performance_moves` can be saved on a shot, but a saved ID alone does not prove the referenced move was resolved or visually reproduced.

The H3 first/last ratio defect was a defaulting conflict: Studio supplied `16:9` for an absent ratio, and the adapter also defaulted to `16:9`. The mode-specific default is now `adaptive` with explicit fixed choices preserved. Mocked request tests verify payload behavior; they do not verify the provider's rendered aspect ratio.

## Not yet proven

- Scene/light/identity consistency across several generated first frames and videos from the same confirmed asset revisions.
- The shot manifest as the exclusive input authority for all image/video provider payloads, including historical uploaded variants and non-H3 models.
- A four-stage action chain (approach, contact, reaction, completed fall) matching authored timing in H3 output. Written timestamps are instructions, not measured execution.
- Reusable, role-specific motion video and grid references preserving only their authorized action/camera/pose channels.
- Skill selection and model switching retaining one accepted model-independent design without the legacy whole-prompt path reauthoring it.

## Deployment decision

This branch is ready for a *code release candidate review* after focused checks and sensitive-data screening. The H3 ratio fix and current request consistency checks are independently testable. Do not present the full cross-domain architecture as completed in release notes. A deployment of these incremental fixes can proceed separately from the following product milestones:

1. Script: reviewed location IDs and typed, evidence-backed relations, including the two street corners and shop/loft visibility in both directions.
2. Image: timestamped key-frame contract and same-shot image/video accepted visual baseline comparison at actual provider payload boundaries.
3. Motion: model-independent accepted beat/action state, versioned action dictionary/reference roles, and model compiler that reads those accepted fields without making new shot decisions.
4. Evidence: fixed-reference generation trials for identity, lighting, blocking, weapon contact and real-time action tempo; record provider model/version, request, frame samples and observed result separately.

Existing unrelated working-tree edits in `api.py`, `test_video_polish_review.py` and the Director3D/storyboard backlog draft are excluded from this release-candidate audit and must not be silently staged.

The production release gate is not yet satisfied. `scripts/iframe_release.py` requires one full reviewed SHA on the GitHub feature branch, a clean host checkout, matching backend image and static manifest, isolated writable-state candidate startup, and verified rollback topology before a switch. The local branch is ahead of GitHub and the worktree retains the unrelated edits above. Release preparation must use a clean pinned checkout or worktree and the canonical `inspect`/`prepare` flow; the retired `deploy_server_release.py` is not a deployment entry.

## Local verification

- H3 transport and Studio ratio/mode checks: 159 passed. The pre-fix first/last default failed in both Studio and direct adapter tests; it now sends `adaptive`, while an explicit `9:16` remains `9:16`.
- Script/Director, storyboard, continuity, asset revision, frame preview and H3 checks: 254 passed.
- Reference ordering and assembled-prompt UI checks: 34 passed; frontend TypeScript check passed.
- No paid generation, rendered-frame comparison, remote provider call, push or production deploy was performed by this audit.
