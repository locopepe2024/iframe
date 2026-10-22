# Companion photo demo deployment — 2026-10-22

User authorized an independent test deployment on the iFrame host; no branch push or merge was performed.

- Public entry: https://garage.uniart.fun/companion-demo/companion/photos
- Companion entry: https://garage.uniart.fun/companion-demo/companion
- Health: https://garage.uniart.fun/companion-demo/health
- Container: `iframe-companion-demo`, loopback `127.0.0.1:18082`, restart policy `unless-stopped`.
- Release: `/srv/lumenx/companion-demo/releases/2020e3ab/`.
- Persistent demo database: `/srv/lumenx/companion-demo/data/photos.db`.
- Existing backend image supplies Python dependencies only: `iframe-backend:git-8fed521b8bf4`; the demo mounts its own photo/identity source, frontend and database, without production environment variables or data mounts.
- API/photo source and frontend: git archive of `2020e3ab7047ee7915ae2e8bca161cdda05cb457`. Frontend built with `IFRAME_PREVIEW_BASE_PATH=/companion-demo` and `NEXT_PUBLIC_API_URL=/companion-demo`. A build-only realpath CSS alias was added in the temporary build directory because node_modules is a symlink; it preserves the existing empty CopilotKit CSS alias. Only companion pages and their shared chunks were published. Manifest resides at `web/build-manifest.json` inside the release directory.
- Runtime wrapper: release `source/demo_app.py`; mounts the isolated photo API and serves companion pages. It renames the browser identity cookie to `iframe-companion-demo-profile`; nginx limits its cookie path to `/companion-demo/`. This separates demo browser identity from the production cookie; it is still the previously accepted Demo identity, not registered-account authentication.

Observed deployment checks: public health and photo HTML return 200; production root still returns 200. Server-side synthetic upload, consent, missing EXIF pending state, month correction, persisted date and three history revisions passed. Public browser automation completed upload, decline/consent, EXIF organization, date correction and restoration. Initial remote touch/mouse runs had missed clicks/timeouts without JavaScript exceptions; this is not evidence of reliable physical touch behavior. Final full browser result is recorded below when available. No real microphone, sound quality or older-adult usability claim follows from simulated speech.

Final public browser run passed with DOM clicks in a mobile viewport: upload, decline/consent, EXIF organization, manual year, restoration, reload persistence, revocation, missing-date pending state, simulated reading/stop and final dictation result. Direct API reads showed transcription/proposal/cancel left server date/history unchanged; confirmation sent one PATCH and added one revision, preserving month precision after reload. Layout checks passed at 320×568, 375×812 with 200% root font size, and 844×390. The script's upload wait was changed to require a new photo card because the previous upload's success text could still be present; remote latency exposed that test race. This pass uses DOM clicks and does not validate actual touch dispatch. Independent server-side API verification also passed again after the final deployment.

Port 3443 has a separate TLS nginx listener (`/etc/nginx/sites-available/iframe-companion-demo`) and is listening on the server, but the external connection timed out. Cause is not proven; cloud firewall filtering is a hypothesis. `arcreel.uniart.fun` did not resolve at verification time; garage did resolve. The usable test entry therefore uses existing HTTPS port 443 and an explicit nginx location proxying to the independent 18082 instance. No cloud firewall rules were changed.

Rollback: restore `/etc/nginx/sites-available/garage.uniart.fun` from `/srv/lumenx/companion-demo/garage.nginx.before-preview`, remove only the demo site's enabled symlink, run `sudo nginx -t` then reload nginx, and stop `iframe-companion-demo`. Retain the data directory unless deletion is separately requested. The server-side `enable-preview.py` and original nginx backup are under `/srv/lumenx/companion-demo/`.

The earlier navigation limit was fixed in c4fa248d: “返回陪伴首页” uses `/companion-demo/companion` in the preview build. Public browser regression verified this prefix.

## Qwen current-user channel update

The demo now also mounts `/srv/lumenx/output/lumenx_users.db` read-only at `/user-config/lumenx_users.db`, selected with `IFRAME_PHOTOS_USER_CONFIG_DB`. No production data directory or provider environment key is mounted. Photo analysis passes the request's existing UserContext into the shared user-config decryption path and requires a personal UniArt configuration; shared-provider fallback is disabled for this path. The model is `qwen3.8-flash`. The original container was retained stopped as `iframe-companion-demo-before-user-channel` for rollback; restoring its old behavior also requires restoring its source files from the previous release backup.

Observed: the user's uploaded photo belongs to the same API-key owner as an existing personal configuration. An authorized real HTTP photo-analysis request succeeded using that configuration; the structured observation persisted and reread identically, while the date remained unchanged. Only success metadata and field lengths were printed by the verification script, not photo descriptions or credentials. The earlier 401 applies to the stale shared environment key, not this verified personal configuration. Single-image success does not verify video analysis or general accuracy. Code validation: 103 backend tests, 16 UI tests, typecheck and isolated static build passed. No branch push/merge.

## Photo storytelling update

Deployed source/frontend revision: `1fe936ef` (backend story storage commit `c299fef6`). Same container, release paths and persistent database; startup explicitly creates the new append-only `photo_stories` table. Existing personal photos and their review status were not changed by test scripts. No new provider call is needed for storytelling. No push/merge.

Validation: 112 photo backend tests, 35 companion UI tests, typecheck and isolated static build passed. Public Chrome/CDP regression used a new synthetic image/owner: text preview and cancellation, simulated voice draft, explicit save, edits, history restore as revision 3, reload persistence and unchanged date passed. Existing description flow/recovery and microphone handoff also passed. Layout checks found no horizontal overflow at 320×568, 375×812 with root font at 200%, and 844×390. Targets were checked at >=44px; CSS specifies 48px. No screenshot, recording, or actual user's photo was collected. DOM clicks/simulated speech do not establish physical touch reliability, real microphone behavior or elderly usability. Health reports `source_revision=1fe936ef`.
