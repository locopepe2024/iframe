# 3D 导演台动作结构数据库与 Agent 提案 V1

## Status

Design specification for a local, review-first action-structure catalog that
works alongside the humanoid/rigger database. The first validation target is a
curated, explicitly illustrative `鹤形拳` action sequence. This document does
not claim a motion-capture solver, a physically correct martial-arts
reconstruction, or an animation-video export path.

## Observed

- **Code fact:** the director already has a versioned humanoid rig profile,
  semantic joint vocabulary, pose presets, bounded timeline pose/transform
  tracks, contact/path events, local draft persistence, and undo/redo.
- **Code fact:** the current pose catalog describes isolated key poses such as
  `action.guard`, `action.kick`, `action.throw`, `interaction.push`, and
  `seated.sit`; it does not yet describe a named action as a phase sequence.
- **Code fact:** the director command bar is currently disabled and the browser
  workbench does not send director commands to a model or backend.
- **Code fact:** timeline pose values are normalized joint-rotation snapshots;
  contact/path events carry explicit review limitations and an optional export
  marker.
- **Code fact:** the existing `复刻` module already accepts a local source video,
  records duration/size/audio metadata, exposes detected frame PTS on a review
  timeline, allows timestamp import, and can request evidence frames. It does
  not currently hand a frame manifest or pose annotations to the 3D director.

## Direct implication

- A named action must be represented as an ordered, inspectable structure that
  references the canonical rig/joint vocabulary rather than as an opaque prompt
  or a single giant pose blob.
- Agent assistance should first return a proposal with matched action,
  target actor(s), duration, phase list, contact candidates, and limitations;
  applying it should be an explicit, undoable authoring command.
- The local browser can validate catalog matching and deterministic white-model
  blocking without claiming that it inferred the exact choreography from text.
- The historical-video path should reuse the `复刻` module's source/timeline
  evidence instead of inventing a second upload or cut-detection contract in
  the director. The director receives an explicit, reviewed frame manifest.

## Not yet proven

- Whether a text label such as `鹤形拳` denotes one canonical sequence for the
  user's intended school, performer, camera, or duration.
- Whether the existing white-model rig can express the action's balance,
  footwork, wrist articulation, hand shape, or contact timing without manual
  correction.
- Whether any future agent or motion model can produce physically valid motion,
  preserve identity, or export a usable reference video from this structure.

## Hypotheses

- A structured phase graph gives the user a faster and safer starting point
  than asking an agent to write raw joint rotations directly.
- The first useful agent response for `鹤形拳` is a short blocking proposal that
  can be previewed, edited, and rejected before any generation or export.
- Action entries should carry provenance and confidence so culturally specific
  labels are presented as curated interpretations, not universal truth.

## Action structure contract

Each catalog entry should include:

- `actionId`, `catalogVersion`, canonical label, aliases, locale, category, and
  a `reviewState` (`curated`, `draft`, or `needs_review`).
- `intent`: a short human-readable description and an explicit statement of
  whether the entry is illustrative, reference-derived, or solver-derived.
- `durationRangeSeconds`, default duration, default FPS, and a normalized phase
  list. Each phase has an id, label, start/end fraction, role (`setup`,
  `transfer`, `strike`, `contact`, `recovery`, `end`), one or more pose-preset
  or joint-rotation references, optional root displacement, and interpolation.
- `roles`: primary actor, opponent/partner, and optional prop/target slots. The
  mapping must resolve to existing characters or remain an explicit unresolved
  slot in the proposal.
- `contacts`: candidate joint/target pairs, contact mode, phase interval, and a
  `reference_constraint_not_physics` limitation.
- `cameraHints`: optional coverage suggestions only; camera changes are never
  applied silently.
- `source`, `confidence`, `limitations`, and a stable checksum for catalog
  review and local draft serialization.

## `鹤形拳` validation entry

The first entry should be named `martial.hexingquan.blocking.v1` and displayed
as `鹤形拳（示意动作结构）`. Its initial five-phase blocking sequence is:

1. `prepare`: neutral/guard stance and weight settle;
2. `lift`: single-leg balance with raised knee and open wing line;
3. `probe`: forward hand/forearm extension toward the opponent's upper-body
   target;
4. `contact-recoil`: optional touch/contact marker followed by a guarded recoil;
5. `recover`: return to a stable guard/end pose.

This entry may reuse existing guard/kick/push pose vocabulary and add only the
minimum custom joint values needed for the raised-knee and wing-line silhouette.
The label must remain marked as an illustrative blocking interpretation; it is
not a claim to reproduce a specific traditional school or a reference
performer's exact form.

## Agent interaction flow

1. User enters natural language, for example `让 A 做一段鹤形拳，15 秒`.
2. Local intent matching returns zero, one, or several catalog candidates. A
   match must show the matched label, alias, confidence, and unresolved choices.
3. The proposal panel exposes target actor, duration, start time, opponent/prop
   slots, and whether contact markers should be inserted. Defaults are visible
   and editable.
4. User chooses `预览动作` first. The workbench creates a proposal preview
   without mutating the authored timeline.
5. User chooses `应用到时间线` to create pose/transform tracks and optional
   contact events as one undoable command. The command history records the
   action id and catalog version.
6. The panel exposes `仅白模预览` and `需要人工校正` status. It does not imply
   that an animation video or provider generation has completed.

## Historical video to white-model validation flow

This is a separate validation lane from text-to-action intent matching. The
lanes may meet at an explicitly reviewed frame/phase manifest, but one lane
must not be treated as evidence for the other.

```text
历史视频
  → 复刻模块上传与媒体准入
  → 复刻分析 / 抽帧时间线（frame PTS）
  → 人工确认或导入时间点
  → 证据帧 manifest 导出
  → 导演台帧导入（只读参考）
  → 人工或 Agent 建议白模关键帧
  → 人工复核后写入动作/姿态轨道
  → （未来）白模动画视频渲染
```

### Stage H0 — source and frame evidence

- Reuse the current `复刻` source-video admission and analysis result. Preserve
  source checksum, MIME type, duration, dimensions, frame rate/time-base when
  available, and permission/retention metadata.
- Export a versioned manifest rather than copying opaque page state. Minimum
  fields: `manifestId`, `sourceMediaId`, `sourceChecksum`, `analysisId`,
  `timeBase`, `frames[]`, and `reviewState`.
- Each frame entry contains `frameId`, source PTS, source seconds, derived
  media id/path, width/height, extraction method, and an optional evidence
  note. A frame timestamp must resolve to an actual source frame; do not round
  to a nearby frame silently.

#### V1 reviewed frame manifest contract

The first implementation slice is a browser-local pure function exported by
`frontend/src/lib/recreation.ts`. It accepts the existing `SourceAnalysis`,
the registered source media identity, and indexed sample/evidence media rows.
It returns a versioned `RecreationFrameManifest`; it does not call an API or
mutate a recreation project or director timeline.

The serialized shape uses the frontend's existing snake-case field convention:

```text
schema_version: "recreation.frame-manifest.v1"
manifest_id: stable caller-provided id
source_media_id: registered source video media id
source_checksum: registered source video sha256
analysis_id: reviewed source analysis id
time_base: authoritative source PTS time base
source_start_pts / source_end_pts / duration_seconds: copied from analysis
review_state: "draft" | "reviewed"
frames: ordered unique entries
  frame_id: stable media-derived id
  source_pts: exact member of analysis.frame_pts
  source_seconds: derived from source_pts and time_base
  evidence_media_id / evidence_media_path: indexed media identity
  width / height: source analysis dimensions
  extraction_method: indexed media role or explicit extraction method
  note: optional review note
```

The builder must reject a source checksum or source media id that is missing,
reject media from another project/source/analysis, require every frame PTS to
be an exact source frame, and reject duplicate PTS. Media rows may arrive in a
different API/index order; the builder sorts valid rows into source order for
deterministic export. This is ordering of references only and never a silent
timestamp snap. `source_checksum` is preserved as provenance, not treated as
proof that a pose was reconstructed.

The manifest is a read-only evidence handoff. Importing it into the director
may create reference markers later, but this slice must not create pose,
transform, contact, or export tracks.

### Stage H1 — director frame import

- Import is read-only reference data first. It creates a reference strip or
  timeline markers and preserves source timestamps; it does not mutate pose
  tracks or claim that a skeleton was solved.
- The imported frame set must be reviewable against the source video and may be
  filtered to phase changes such as setup, contact, recoil, recovery, and end.
- The director should record the manifest checksum and revision in the local
  draft so a later re-import cannot silently replace reviewed evidence.

The first H1 browser slice is deliberately narrower: `FrameManifestImporter`
reads a local `.json` manifest, validates its versioned shape, and stores the
manifest plus a monotonically increasing local `revision` in the director
draft. The panel reports frame count, source/analysis identity, review state,
and the exact source-time reference. It exposes replace/clear actions, but no
`应用到时间线` action. Closing the panel or importing a manifest must leave
`dialogueTimeline.tracks`, pose values, transform values, contact anchors, and
export markers unchanged.

### Stage H2 — white-model mapping

- A user or Agent may propose a mapping from selected frames to action phases,
  target actor, facing direction, approximate screen/world anchor, and contact
  candidates.
- Every generated keyframe stores `sourceFrameId`, source seconds, mapping
  method (`manual`, `agent_suggestion`, or future `solver`), confidence, and a
  review state. Low-confidence or occluded frames remain proposals and are not
  silently promoted to authored motion.
- Applying a reviewed mapping creates ordinary director pose/transform tracks
  and optional contact markers as one undoable command. The resulting stage is
  still a white-model blocking preview.

### Stage H3 — animation/video output

- A future renderer may turn the reviewed white-model timeline into a video
  reference, but codec, FPS, camera, watermark, metadata, and ownership must be
  specified before implementation.
- A rendered white-model video is a review artifact or model input candidate;
  it is not evidence that the source video was faithfully reconstructed.

### Evidence boundary between lanes

| Lane | Proven by the lane | Not proven by the lane |
| --- | --- | --- |
| Text action intent | Catalog match, explicit phases, editable proposal | Exact traditional choreography or physical validity |
| Historical video evidence | Source frames, timestamps, evidence images, review notes | Pose/skeleton solve or identity preservation |
| White-model mapping | Applied keyframes and contact markers with provenance | Automatic motion capture, IK/physics, or final animation |
| Future render | Encoded output with declared settings | Semantic faithfulness to source or provider quality |

## Boundaries

- V1 is browser-local and deterministic. No backend, model-provider, upload,
  motion-capture, automatic IK/physics, or MP4 export is added.
- The action catalog is not a replacement for the humanoid/rigger database;
  it references that database's joint and pose contracts.
- Unknown or ambiguous action names must produce a reviewable no-match or
  multi-candidate result; do not silently choose a culturally specific motion.
- Applying an action must be undoable and must preserve existing draft,
  timeline, collapse/expand, camera-guide, and export-marker contracts.

## Acceptance criteria for the next implementation slice

1. A typed local action catalog exposes the `鹤形拳（示意动作结构）` entry and
   validates its phase/role/contact fields.
2. A deterministic matcher recognizes `鹤形拳` and returns an explicit
   illustrative confidence/limitation instead of calling a model.
3. The director UI exposes a compact proposal flow with keyboard-accessible
   preview/apply actions and no yellow-only status semantics; green/white
   controls remain consistent with the current workbench.
4. Applying the proposal creates deterministic white-model pose tracks and any
   contact marker in one undoable command; rejecting or closing it leaves the
   timeline unchanged.
5. Tests cover exact match, ambiguous/no-match behavior, proposal preview vs
   apply, timeline phase counts, limitation text, undo, and no external
   requests.
6. The recreation frame-manifest slice covers exact source PTS, deterministic
   normalization of unsorted media rows, duplicate/out-of-range rejection,
   source and analysis checksum/identity validation, and proves that it
   remains a pure read-only export.

## Affected paths (planned)

- `frontend/src/lib/recreation.ts` (frame-manifest contract only; reuse existing
  source/timeline evidence)
- `frontend/src/components/modules/recreation/RecreationPage.tsx` (export or
  handoff affordance, after its contract is specified)
- `frontend/src/components/director3d/action/action-structures.ts`
- `frontend/src/components/director3d/action/action-intent.ts`
- `frontend/src/components/director3d/reference/FrameManifestImporter.tsx`
- `frontend/src/components/director3d/action/ActionProposalPanel.tsx`
- `frontend/src/components/director3d/state/workbench-store.ts`
- `frontend/src/components/director3d/App.tsx`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/styles.css`
- `docs/specs/2026-09-23-director-action-structure-agent-v1.md`
