# Recreation two-pass shot review v1

## Goal and evidence

Produce a reviewed, source-frame-indexed timeline before GVHMR/VPoser pose fitting and
camera solving. The Addams shot 1 source has 65 indexed frames. Its first model pass
groups frames 1-5 into one action and describes the heel as raised throughout frames
1-3. A reviewer observed a change between frame 1 and frames 2-3 that this event-level
record cannot encode. The observation still needs source-frame confirmation; this spec
does not assert which anatomical foot is visible.

The current `shot-review.v1` is one mutable item list. It has no distinction between
macro review, model detail candidates, and final detail review. The current offline
handoff checks that list and can therefore mistake an event-level review for a complete
time-series review. These are code facts, not evidence that a pose solver has consumed
the review.

## Ownership and stages

| Stage | Owner | Input | Durable output | Exit gate |
| --- | --- | --- | --- | --- |
| Source indexing | system | source video | fingerprint, frame PTS, time base, shot cut candidates | source identity verified |
| Macro analysis | LLM | indexed source frames | candidate shot boundaries, action phases, camera station/motion/optics intervals, evidence and unknowns | candidate schema valid |
| Candidate completion | model and temporal analysis | macro candidates, original frames before and after each uncertain interval | revised candidates with frame evidence, provenance, competing explanations, and remaining questions | every uncertainty has been re-examined before human review |
| Macro review | human | candidate and source frames | reviewed macro timeline `M` | all candidate decisions explicit; shot and phase boundaries confirmed |
| Detail analysis | LLM | source frames and frozen `M` | per-frame/interval detail candidates `D`, tied to `M` | full frame coverage report and candidate schema valid |
| Detail review | human | `D`, `M`, and source frames | reviewed time series `R` | every required interval decided; unresolved values explicitly retained |
| Solve and render | GVHMR/VPoser, camera solver, Blender | frozen `R`, source and tracks | pose/camera solve and white-model frames | source-aligned 1-65 frame review |

`M` is a constraint on the second model pass, not a claim that the first pass contains
pose truth. Only `R` can authorize a pose/camera handoff. A saved draft or a review with
zero pending coarse items is not a final approval.

Candidate completion happens before the first human review. For each first-pass
`unknown`, inspect original frames on both sides of the interval together with the
uncertain frames. Use temporal continuity, subject orientation, stable background
landmarks, and visible body or foot contours to propose the most specific supported
answer. A focused image restoration or LLM pass may help inspect a damaged interval,
but its output remains a hypothesis tied to the original frames; it cannot create
observed contact or a new anatomical-side fact. Record the original model statement,
the revised inference, evidence frames, method, and remaining alternatives separately.
Only unresolved conflicts that affect the macro decision enter the first human queue.
Do not treat a generic `unknown` or blurred single frame as a request for the reviewer
to repeat the temporal analysis. Frame-level feet and exact contact timing remain for
detail analysis after the macro review is frozen.

The v2 second-pass frame pack contains every model candidate, with pending items first.
Each item carries its first-pass text and source fields, overlapping first-pass context,
and source frames at the interval boundaries, midpoint, evidence frames, and immediate
neighbors within the confirmed shot. The manifest binds frame numbers and PTS to the
source fingerprint, analysis, timeline, and candidate digest. A vision model reads the
ordered images and returns a complete `shot-candidate-completion.v2` JSON package;
unresolved cases need a specific reason and source-frame evidence. The script
`python3 -m scripts.recreation.second_pass_infer INPUT.zip OUTPUT.json --model MODEL`
uses the configured `LLM_PROVIDER` credentials. The imported result remains a model
proposal until the reviewer compares both passes and confirms decisions in the UI.

## Macro review contract

The first model pass proposes, for each shot, a half-open source-PTS range and
frame-indexed intervals for action phases, camera station, orientation motion, optical
change, and visible scene/object continuity. Every claim carries evidence frame IDs,
an observation separate from interpretation, and an explicit uncertainty when needed.
The reviewer can accept, correct, reject, or retain an unknown. `unknown` is an explicit
review outcome; an absent field remains pending.

The macro snapshot records `source_fingerprint`, `analysis_id`, `timeline_key`,
`macro_revision`, reviewer decisions, and a canonical content digest. Freeze it only
when every shot has reviewed boundaries and its macro claims have explicit decisions.
Changing source indexing, shot cuts, or any frozen macro claim invalidates dependent
detail runs and final approvals. Prior artifacts remain readable for audit.

## Detail analysis contract

The second model pass receives the frozen macro snapshot and the exact source frames
for each shot. It may refine phase boundaries only by proposing a change request; it
cannot silently replace `M`. Specialized passes may run separately for body action,
foot contact, anatomical-side identity, camera station/orientation, and optics. Their
outputs are merged only after checking source frame identity and the macro digest.

Each foot-state candidate uses source frame indices and PTS, with a change interval
bounded at every observed transition. Minimum fields:

```json
{
  "frame_span": [1, 1],
  "actor_id": "A1",
  "screen_foot": "screen_left",
  "anatomical_foot": "unknown",
  "support_state": "supporting",
  "sole_contact": "full_sole",
  "contact_target": "ground",
  "evidence_frames": [1],
  "observation": "Visible sole lies against pavement",
  "uncertainty": "Anatomical left/right is not resolved from this view"
}
```

Valid `support_state` values are `supporting`, `touching`, `swinging`, `airborne`,
and `unknown`. Valid `sole_contact` values are `full_sole`, `heel`, `forefoot`,
`toe`, `rolling`, `none`, and `unknown`. Screen and anatomical side are separate;
neither is inferred from the other when the subject turns or occlusion obscures the
leg. One event-level support/contact value cannot stand in for both feet or for a
multi-frame change. Contact with the ground and contact with an object are separate
claims. The model must not promote object proximity or a glow into object contact.

Camera candidates similarly separate camera position translation, orientation
rotation, optical change, and subject translation. A decrease in subject size alone
does not establish dolly, zoom, or depth motion. Candidates carry evidence, competing
interpretations, and unresolved parameters. Unknown geometry is retained instead of
invented for the solver.

The detail package records `macro_digest`, model and prompt revision, source frame
range, specialized-pass provenance, candidates, unknowns, and a coverage report.
Coverage means every source frame belongs to a reviewed shot and each requested
dimension is either proposed or explicitly unresolved. It does not mean the model
produced a confident value for every frame.

## Detail review and handoff

The second human review works from frame/interval candidates and source-frame
comparison. It can split or merge intervals, change values, reject a claim, or retain
an evidence-backed unknown. Its approval requires explicit decisions on all detail
items and no unreviewed macro change requests. It creates an immutable `R` with its
own revision and a reference to the exact `M` digest and detail-run ID.

Handoff validates source fingerprint, analysis and timeline key, macro digest, detail
run ID, and final review revision. It rejects a missing or stale stage, incomplete
coverage, pending decisions, and any attempt to treat legacy event-level fields as
per-foot observations. It exports reviewed observations and unknowns separately.
Unknown sole geometry never enables hard foot IK. Solver output is a hypothesis until
compared with the source; rendering does not retroactively approve the input review.

## UI and process management

The recreation review page shows candidate-completion status before separate macro/detail queues.
Each stage displays its source revision, pending count, coverage gaps, and freeze or
approval status. Reviewers seek by original source frame and PTS. Candidate text,
evidence, human correction, and provenance remain visible together. A model run cannot
start before macro freeze; a final approval cannot occur before the referenced detail
run finishes. Editing frozen macro semantics offers a new macro revision and marks
dependent detail and render artifacts stale.

The next model pass must be an explicit operation with a recorded run ID and status
(`queued`, `running`, `completed`, `failed`). A failed or partial run is inspectable
and retryable; it must not be presented as reviewable full coverage. Importing an
external detail JSON uses the same validation and provenance rules as an integrated
run. Saving a review is never equivalent to starting an LLM run.

## Addams revision 7 migration

Treat revision 7 as a legacy macro-review draft. Preserve its existing human text and
decisions. Do not automatically freeze it: unresolved model items and the coarse
1-5 action require macro review against source frames. Do not copy its event-level
contact or support values into per-foot detail. After macro freeze, run the focused
detail analyses on all 65 frames, review their candidates, then export `R` for a new
white-model solve and render. The prior white-model frames lack required camera and
timeline context and are excluded from acceptance.

## Implementation slices and verification

1. Add versioned stage records and server-side freeze/approval transitions. Keep
   legacy `shot-review.v1` readable, but prevent it from authorizing a new pose
   handoff. Test stale-source, stale-macro, incomplete-review, and revision conflicts.
2. Define detail candidate and reviewed time-series schemas, frame coverage validation,
   and per-foot/camera fields. Test the 1-3 transition, screen/anatomical ambiguity,
   unknown contact, and shot boundary enforcement.
3. Add the specialized LLM runner with recorded prompts, model version, run status,
   source-frame identity, retry behavior, and macro-digest binding. Test partial and
   failed runs without treating them as complete.
4. Expose macro and detail queues in the recreation UI, then gate the offline handoff
   on final review. Verify stage transitions and 1-65 frame source comparison.

No stage can be marked complete by counting fields alone; its explicit review decisions
and source binding are the authority.
