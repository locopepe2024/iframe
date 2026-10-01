# Motion track manual annotation v1

## Purpose

Automatic extraction must expose identity and pose failures for targeted human
review. A failed target match is not evidence of occlusion.

## Review states

- `tracked`: automatic target and landmarks are accepted.
- `manual_recovered`: reviewer selected the visible target pose.
- `detector_missed`: target is visible but landmarks need re-extraction or overrides.
- `real_occlusion`: the target is visibly occluded in the source frame.
- `out_of_frame`: the target is outside the source image.

Only `tracked`, `manual_recovered`, and reviewed detector corrections may feed
the canonical track. `real_occlusion` and `out_of_frame` remain explicit gaps;
they must not be silently filled.

## Review artifact

`motion-track-annotation-review.v1` contains one entry per unresolved frame,
candidate pose boxes, distance to the previous accepted target center, optional
joint overrides, and a reviewer note. The Director 3D UI can render this list
as a contact sheet and a timeline issue panel.

## Current sample

The `recreation2-final120.json` sample has 120 source frames. The first pass
has 79 frames with target landmarks and 41 unresolved frames. The unresolved
status is currently reported as `occluded`, but the raw data does not prove
occlusion; those frames require the review artifact before canonicalization.
