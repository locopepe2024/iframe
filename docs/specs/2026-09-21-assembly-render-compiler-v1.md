# Assembly render compiler v1

## Status

Follow-up implementation contract for turning a validated Assembly plan into
an explicit render. This slice is intentionally video-only; audio lanes remain
an explicit capability boundary until their source media contract is added.

## Observed

- **Code fact:** the persisted plan already carries stable project/episode,
  frame, task, source and timeline ranges.
- **Code fact:** legacy `merge_videos` concatenates selected frame media and
  persists a project-scoped output path.
- **Direct implication:** the first compiler can resolve Video lane clips to
  project-owned Motion outputs, trim each source range, and concatenate the
  resulting clips without changing provider submission or recovery.
- **Not yet proven:** provider outputs share a single codec, frame size, frame
  rate, or audio layout. The compiler therefore re-encodes each clip before
  concatenation and reports FFmpeg failures instead of claiming compatibility.

## Contract

1. Rendering is explicit: saving a plan never renders or submits paid Motion.
2. A project render uses `POST /projects/{id}/assembly-plan/render` and a
   series render uses `POST /series/{id}/assembly-plan/render`.
3. Only enabled `video` clips are compiled in v1. Enabled clips in dialogue,
   BGM, or SFX lanes cause a clear unsupported-capability validation error;
   they are never silently dropped.
4. Video clips must form a contiguous timeline beginning at 0 and ending at
   `target_duration_ms` for v1. The editor may save non-contiguous drafts, but
   render rejects them until gap/filler semantics are implemented.
5. Source media is resolved from owner-scoped frame/task records. Signed URLs
   are never used as durable identity and remote URLs are not fetched by this
   compiler.
6. `source_start_ms`/`source_end_ms` are applied as trim ranges. A missing end
   uses the requested timeline duration; a non-positive effective range fails.
7. Series renders may reference only episodes registered in that series; the
   existing plan reference validator remains the authority.
8. The output path is owner-scoped and persisted on `Script.merged_video_url`
   or `Series.merged_video_url`. Legacy projects with no plan continue through
   the existing frame-order merge path.

## Boundaries

- No automatic render after PUT.
- No audio mixing, subtitles, FunASR inference, FunClip embedding, OTIO export,
  or gap filler in v1.
- No provider-specific fields or new paid generation paths.
- No remote URL download: a source must resolve to a local owner-scoped file.

## Success criteria

1. A contiguous 60-second three-clip project/series plan renders in source
   timeline order with each source range applied.
2. A missing task/media, non-contiguous timeline, unsupported audio lane, or
   cross-owner/episode reference fails before FFmpeg execution.
3. A project with no plan retains existing `merge_videos` behavior.
4. Tests cover command inputs/path safety, output persistence, and the explicit
   render endpoints.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/api.py`
- `tests/test_assembly_render_compiler.py`

