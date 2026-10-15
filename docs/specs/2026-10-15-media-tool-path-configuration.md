# Media tool executable configuration

Observed: malysis backend runs `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` inside its Docker container. No executable was found by `command -v ffmpeg` on the host. These are local process executables, not HTTP listeners. `127.0.0.1` refers to the executing network namespace and does not identify a media tool service.

Add administrator environment settings `FFMPEG_PATH` and `FFPROBE_PATH`. Each is one absolute executable filename on the backend filesystem; unset/blank preserves automatic discovery. Explicit invalid, missing, non-executable or URL values fail visibly without fallback. Never accept shell arguments, launch through a shell, expose executable selection as an owner preference, or execute a configured program during path resolution.

Resolve ffprobe from its explicit setting, then the chosen FFmpeg sibling, then PATH. Existing FFmpeg discovery retains bundled/PATH/Windows behavior when no explicit setting exists. Assembly, Studio merge/extraction and Recreation processing use these shared resolvers; status checks report missing/invalid dependencies without crashing. Include ffprobe availability in dependency status.

Success: custom executable paths (including spaces) are passed as one subprocess argument; wrong configuration cannot silently use another binary; original managed-media validation order remains intact. Validate path discovery, malformed config, status reporting, Assembly source audio and Recreation commands with mocks and real FFmpeg. This depends on the source-audio PR #116. No production cutover or remote HTTP/SSH FFmpeg executor in this slice; remote media execution requires a separate service/worker contract and media-path mapping.

Docker example for malysis: set `FFMPEG_PATH=/usr/bin/ffmpeg` and `FFPROBE_PATH=/usr/bin/ffprobe` in the backend environment. These paths must exist inside the backend image. A host loopback address is not a substitute. Keep deployment values out of versioned application code.
