# Owner-local video posters

## Observed

Main's media thumbnail helper opens every source with Pillow, which cannot decode MP4 video. PreviewVideo requests only metadata and has no derived poster when its caller omits one. Production has local video extraction and an owner-route poster URL helper, but its extraction calls a literal `ffmpeg`, bypassing the newly merged executable configuration.

## Scope and success criteria

Reconcile video poster extraction for owner-local Studio and imported Playground videos. Use the configured backend-local FFmpeg executable, argument arrays without shell execution, one first-frame extraction, bounded dimensions, a timeout and atomic owner-local WebP caching. Accept MP4/MOV/WebM/MKV with explicit container demuxers; do not allow network protocols while decoding local inputs. Preserve original video playback/download and supplied poster precedence. External videos do not acquire local poster URLs. Existing signed and authenticated owner checks remain the access boundary.

Cache keys continue to include source path, size, mtime and requested edge; changing the source must produce a new still. Image limits remain unchanged; local videos have an explicit 512 MiB input size bound. Missing/invalid tools or invalid video return a controlled preview error and leave no temporary output. Cached stills need no running FFmpeg process. No new remote service, provider calls, media-root migration or production deployment.

## Verification and delivery

Reproduce MP4 preview failure before implementation; test real first-frame color/size, cache reuse and source replacement; test command configuration, timeout/failure cleanup and owner rejection; test route bytes and frontend poster URL/precedence. Run relevant owner/media tests, frontend typecheck/build, and the full backend suite with the previously established local Blender exclusions. Add the real-video regression module to the existing FFmpeg CI job. Changes touch media_thumbnails, preview routes/error wording, PreviewVideo and URL helpers/tests only. Depends on PR #119 owner routes and merged PR #118 executable configuration; administrator merges #119 first. Keep deployed source untouched.
