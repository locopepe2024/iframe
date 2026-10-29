# Director 3D reusable assets and language Skills

## Evidence and scope

Code facts: the motion intake catalog and BVH Blender probe exist. The example
catalog contains unverified placeholders, not playable production assets. Current
crowd motion is a procedural reference on the canonical flat-ground rig.
Story/episode creative Skills are a separate domain and must not be relabeled as
3D execution capabilities.

The unified asset library owns files, media, ownership and reusable references.
Director 3D owns motion compatibility, layout templates and executable language
methods. No separate file storage service, approval gate or Storyboard protocol
is introduced. User preview/apply remains the editing flow.

## Three reusable records

1. Asset: stable asset/variant/media IDs, revision and file SHA-256; source URL,
   exact package/version and license evidence; skeleton/rest-pose hashes, scale,
   locomotion mode (in-place or root-motion), nominal speed and cycle duration;
   looping, start/stop/turn roles and left/right contact intervals. Quality
   evidence must identify the target rig, validator version and report checksum.
2. Template: local origin/heading, formation and actors with source asset refs,
   spacing, paths, start delays, duration and deterministic seed. Half-circle
   observation, loose gathering, opposing traffic and staggered avoidance are
   candidate templates; a name alone does not prove they are implemented.
3. Language Skill: stable ID/version/revision, intent examples, typed parameters,
   dependencies, compatible operation kinds, preconditions, compiler and checks.
   Resolution yields exact asset revisions and a preview plan. Missing assets
   yield explicit unavailable reasons; never silently substitute walk for run.

## Motion admission and execution

External package -> license/source registration -> media-host intake hash ->
Blender import -> rest-pose/bone mapping -> retarget -> contact and visual checks
-> unified asset registration -> director lookup -> preview -> user apply.

Normal walk, small steps, stagger, jog and fast run are separate action tags.
Running has flight phases and must not inherit walking support assumptions.
In-place clips require a measured nominal translation speed for path matching;
root-motion clips must not add their displacement twice. Speed changes must stay
inside the clip's validated range; otherwise return an unsupported-speed reason.
Contacts refer to source clip time and must be remapped when retiming.

## First implementation slice

Extend the existing v1 intake catalog with optional locomotion metadata and an
explicit `intake` / `ready` availability field (omitted means intake). Preserve
existing examples. Ready locomotion entries require verified license, validated
retarget, target rig/file hashes and a hashed contact-validation report. This
validator is an intake check, not runtime Skill dispatch or a proof that a named
file/report exists. Actual hash verification and media loading remain mandatory
at later runtime admission.

Commands: focused pytest catalog tests and the existing example-catalog CLI.
Affected paths: existing catalog validator, catalog tests and this spec.

## Subsequent slices and acceptance

- Verify an exact permissively licensed source package; do not claim all of a
  provider's assets share one license. Quaternius is a candidate, not imported.
- Import walk, small-step and jog samples through media Blender, retarget to the
  shipped rig and save full-body/foot close-up previews and contact metrics.
- Add owner-scoped library discovery and version-frozen Skill resolution; test
  missing assets, incompatible rigs, changed revisions and unavailable speeds.
- Add local-coordinate crowd templates, then verify reuse in street and square
  layouts with obstacles, reproducible timing and camera framing.

No automatic downloads or licenses are approved by this document. No browser
UI should advertise five supported gaits until playable validated assets exist.
Admin owns merge/deploy. Storyboard integration is outside this work.
