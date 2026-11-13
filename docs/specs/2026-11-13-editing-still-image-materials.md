# Standalone editing still image materials

## Scope

Standalone editing can use owner-uploaded still images from its material library
as visual clips on the existing video lane. Images are uploaded files registered
in the library; importing arbitrary internet URLs is out of scope.

Supported still formats are PNG, JPEG, and WebP. Animated images are rejected.
Uploads retain the existing 256 MiB limit and owner-scoped immutable media
registry behavior. Image metadata is validated from the file itself and records
`image=true`, `video=false`, and `audio=false`.

## Timeline behavior

- A still image is added to the video lane with a 5 second default duration.
- The image is represented by the existing `AssemblyClip` media reference and
  its timeline range. It starts with a virtual source range of `0..5000 ms`;
  normal split and edge-trim operations adjust that range to match the clip.
- Existing video split, move, resize, delete, save, restore, undo, and redo
  interactions apply to image clips through the normal video lane.
- Still images count as visual coverage for the contiguous sequence requirement.
- The preview displays the still frame while the playhead is within its clip;
  playback advances the playhead and audio lanes continue to follow it.

## Rendering and validation

- Rendering loops the still image at 24 fps for the clip's timeline duration,
  then normalizes it to the existing 1280x720, 24 fps output format.
- A still image contributes silence to the base picture sequence; dialogue,
  music, and effects lanes are mixed as usual.
- The renderer never fetches media from a user-provided URL. All sources resolve
  through the owner-scoped media registry and local managed storage.
- Save and render reject unreadable, animated, unsupported, or mutated images;
  image virtual source ranges must be positive and no longer than one hour.

## Acceptance

- PNG, JPEG, and WebP uploads appear in the library with image previews and can
  be imported into a workspace and placed on the video lane.
- Unsupported and animated image uploads fail without creating a registry card
  or leaving a partial managed file.
- Save, reopen, and restore preserve still image clips and source identity.
- A rendered sequence containing a still image has the requested duration and
  playable video/audio streams, with other clip and audio-lane behavior intact.
- Frontend coverage verifies image cards, timeline placement, and still preview.
