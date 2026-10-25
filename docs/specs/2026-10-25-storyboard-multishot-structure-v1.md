# Storyboard multi-shot structure v1

## Decision

A storyboard record is a generation unit, not necessarily one camera shot.
MiniMax H3 may receive one video prompt containing multiple authored shot
segments. The prompt may use provider-native labels such as `[Shot 1]` and
`[Shot 2]` when the selected structure permits them.

## Contract

`shot_structure` is planning metadata, not a submission gate:

- `single`: a planning hint for one continuous camera shot.
- `multi`: a planning hint that multiple camera shots are useful.
- `auto`: no shot-count restriction; the system decides.

The optimizer must not hard-reject a returned shot count. The user can edit
the prompt before submission.

This field is independent of provider-specific `shot_type` controls. It does
not split one storyboard record into multiple provider tasks.

## Timing invariants

For every structure, authored ranges or timestamp nodes must start at 0.00s,
remain strictly ordered and contiguous, and end at the requested duration.
`[Shot N]` labels are valid and do not by themselves indicate an error.

## Continuity

First-frame and last-frame references anchor the generated video as a whole.
Internal shot changes may alter camera angle, size, or movement only when the
prompt makes that change explicit. A multi-shot prompt must not silently
change character identity, blocking, or scene continuity.

## Scope

This contract changes prompt construction and validation. It does not change
provider duration, ratio, task polling, or media assembly behavior.
