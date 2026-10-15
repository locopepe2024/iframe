# Studio media write layout v1

## Observed

- Studio's authenticated media root is `output/users/<profile-hash>/studio/`; `/files/*` dynamic media paths are denied. Browser delivery uses signed `/studio/media/*` URLs.
- Character, scene, and prop images already use an owner root in `AssetGenerator`. Storyboard rendering was corrected to use that root after a generated image under `output/storyboard/` returned 404.
- Motion-reference video generation and some legacy helpers still choose `output/video/` themselves. Pipeline, asset, audio, and upload code each construct owner subdirectories separately.

## Contract

`owner_profile_id` selects one private Studio root. The owner hash is a storage namespace, not a project, episode, scene, shot, or asset ID. A generated file's stored locator is relative to `output/`; a signed delivery URL is a response projection and must not be persisted as the locator.

| Material | Write directory under the owner Studio root | Identity in filename or record |
| --- | --- | --- |
| Character design | `assets/characters/` | character asset ID and variant ID |
| Scene reference design | `assets/scenes/` | scene asset ID and variant ID |
| Prop design | `assets/props/` | prop asset ID and variant ID |
| Storyboard still / first frame | `storyboard/` | frame ID and variant ID |
| Generated video and motion reference | `video/` | task, frame, or generated variant ID |
| Input snapshot for video | `video_inputs/` | generated snapshot ID |
| Dialogue, effects, music | `audio/dialogue/`, `audio/sfx/`, `audio/bgm/` | frame or generated variant ID |
| Uploaded Studio reference | `uploads/` | generated upload ID |

Scene `scene_id` and shooting-plan `shot_id` remain logical references. A scene image does not become a shot's first-frame file merely because the shot references it. A storyboard render writes a new frame variant and records its own storage key.

Every owner-bearing Studio write resolves its category through `studio_media_dir(owner_profile_id, category)`. The helper rejects missing owners and unknown categories. Direct generator calls without an owner still have a legacy output fallback for old records and tests; authenticated API paths must attach the owner before calling them. Legacy unowned records may retain their former path until a separate owner-verified migration; a public `/files/*` mount must not be reopened to make them display.

## Access and migration

The API stores `users/<profile-hash>/studio/<category>/<file>` or a managed object key. It signs owner-local keys on response. Provider input resolution verifies the owner before reading local media. Legacy shared-path migration must confirm the file belongs to the recorded frame or asset, copy without deleting the source, update the stored key, and register the new owner media record.

Playground, Recreation, Director3D, knowledge blobs, project JSON, and internal processing caches retain their own storage contracts. They are not Studio asset or storyboard material and should not be moved by this change.

Two legacy voice preview flows currently write user-visible audio to `output/cache/voice_preview/` and `output/cache/voice_design_preview/`. Those URLs are denied by `/files/cache/*`. They need owner authorization, owner-scoped cache keys and signed delivery before cutover; this layout change does not claim they already comply.

## Verification

- Unit tests assert category validation and owner-scoped output paths for scene assets, storyboard frames, uploads, audio, and motion-reference video.
- A legacy storyboard image remains readable after owner-verified migration, while `/files/storyboard/*` remains denied.
- Production smoke checks the stored key, signed URL, and HTTP 200 for a generated or migrated frame under one authenticated owner. A local test alone does not prove the browser request succeeded in production.
