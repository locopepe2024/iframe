# Shot consistency manifest v1

## Objective

Provide one frame-owned intermediate layer between character, scene, prop,
reference, and video generation state. Editing fields remain live until a
shot is confirmed; video generation receives an immutable copy.

## Ownership

`StoryboardFrame.consistency_manifest` is the only shot-level consistency
snapshot owner. Asset records remain the source of current variants. Legacy
fields (`character_ids`, `prop_ids`, workbench selections, and reference
package fields) remain editable inputs for compatibility, but are not the
generation truth after a manifest is built.

## Lifecycle

1. Resolve current scene, character, and prop selections into revision pins.
2. Combine confirmed reference projection, shot visual design, and structured
   shot fields into a bounded manifest.
3. On video task creation, deep-copy the manifest into
   `VideoTask.consistency_manifest`.
4. Deleting a variant invalidates the live frame manifest and references. It
   never mutates an existing task snapshot.
5. Re-generation after invalidation must rebuild and confirm a new manifest.

## Success criteria

- A generated task contains one complete, serializable consistency snapshot.
- Variant deletion clears live frame state but preserves task history.
- Character, scene, and prop pins are resolved through the same structure.
- Existing clients can still read legacy fields during migration.
- Tests cover construction, persistence, deletion invalidation, and task copy.

## Non-goals

- Removing legacy fields in v1.
- Changing provider routing or prompt wording.
- Making an asset revision immutable before the user confirms the shot.
