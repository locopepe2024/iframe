# Support route continuity review

Media Blender 4.5.9 reran the alternating Walk_Loop support fixture after the
route gate was added. Left 0..8 and right 16..24 do not overlap; the shared
route check therefore has no conflicts. Each segment is internally bounded:

- Left maximum route speed: 1.40866 m/s.
- Right maximum route speed: 1.53365 m/s.
- Speed limit: 4 m/s.
- Missing bridge gaps: none for the annotated segments.
- Both interval IK gates remain `supportAccepted: false`.

The simultaneous fixture with independently fitted routes now fails before IK,
as required by the shared-route gate. A route passing both checks is only
internally consistent and speed-bounded; it is not proof of authored movement,
terrain adaptation or no sliding. The unannotated frames between alternating
support windows still need a real world route and transition review.
