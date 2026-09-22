# LumenX release baseline and image edit contract — 2026-09-16

## Observed

- Deployment repository: `https://github.com/locopepe2024/lumenx`, branch `feature/lumenx-multi-user-v1`. The inherited upstream publishing workflow targets Alibaba and is not the deployment destination for this fork.
- Server `/srv/lumenx/repo` previously tracked Alibaba main at `f2a02e2`; its working files had been manually overlaid. Local feature branch was 59 commits ahead of its published branch.
- Published feature branch and server checkout now follow the same source. Original server changes are retained in stash `pre-sync-20260916`, with private server-side backup files. Do not push that stash: it includes environment backups.
- Frontend export was built from `32f74f1`. Subsequent release-management and backend-only changes do not change its source. Do not record a later documentation commit as its build revision.
- Hash audit of the old running backend matched tracked runtime files, but found three extra files: `src/apps/api.py`, `src/apps/Dockerfile.backend`, and `src/apps/playground/service.py.before-uniart-20260907-054707`. Its active entrypoint is `src.apps.comic_gen.api:app`, not the extra API file.
- Local untracked `docs/design/iyishow-web-agent-optimization-and-lumenx-agent-alignment-v1.md` is preserved and excluded from release artifacts.

## Image interface evidence

Authoritative local UniArt source checked: `uniart-media-api-audit/relay/channel/openai/adaptor.go`, `newtoken_image.go`, and `docs/openai-image-async-task-contract-v1.md`.

- GPT Image 2 AtlasCloud edit forwards the public `images` JSON to upstream. The reported error contains a serialized `image_url` object used as a URL. LumenX now sends URL strings for this route.
- Nano Banana 2 Special / GPT Image Special Cangyuan routes accept URL arrays. Cangyuan conversion explicitly enables async; historical public Nano Banana Special acceptance returned an image task. Thus “Special must always be synchronous” is not established.
- GPT Image 2.5 Flare/Sunburst Discount requires `image_url` objects on NewToken; preserve this format.
- No model-name-based forced response lifecycle: direct image data/URLs are consumed directly, accepted task IDs are polled at `/images/{id}`. Mask requests retain the existing async flag.
- Six regression cases failed before repair; all 37 UniArt tests passed after repair. These are contract tests, not paid upstream generation acceptance. The original Nano Banana failure's exact upstream cause remains unproven until an end-to-end replay succeeds.

## Release procedure

1. Commit intended changes; never include credentials, output data or server stashes. Push only the deployment feature branch to the fork above. Do not force-push or reset server changes.
2. Server fetches the explicit feature ref and merges with `--ff-only`. Abort if dirty. Keep deployment source separate from `/srv/lumenx/output` and static export.
3. Build the backend from a clean `git archive HEAD` and the tracked Dockerfile. Label its OCI revision. Preserve previous container, environment and output mounts; validate import and OpenAPI before/after replacement; roll back on failure.
4. Frontend changes require typecheck/tests/build. Upload hashed assets first, index last; preserve old assets for existing browser sessions. A backend-only release reuses the verified frontend export with its original build revision.
5. Generate the private release manifest locally:

```sh
python3 scripts/verify_release.py create --manifest /tmp/lumenx-release-manifest.json --static frontend/out --build-revision 32f74f1
```

6. Transfer manifest to the server and obtain a fresh runtime snapshot (unique empty directory):

```sh
sudo docker cp lumenx-backend:/app/src "$AUDIT_DIR/src"
sudo docker cp lumenx-backend:/app/config "$AUDIT_DIR/config"
sudo docker cp lumenx-backend:/app/requirements.txt "$AUDIT_DIR/requirements-docker.txt"
sudo docker cp lumenx-frontend:/etc/nginx/conf.d/default.conf "$AUDIT_DIR/nginx.conf"
python3 scripts/verify_release.py verify --manifest /srv/lumenx/releases/current-manifest.json --static /srv/lumenx/chat-static --runtime "$AUDIT_DIR"
```

7. Require identical local/GitHub/server HEAD, clean server status, passing manifest audit, and HTTP 200 from `127.0.0.1:3000/` and `127.0.0.1:17177/openapi.json`. Port 80 alone is not evidence that LumenX is healthy. Save manifest, container image ID and rollback name under `/srv/lumenx/releases`.

## Limits

The manifest verifies code/config/static bytes and missing/unexpected runtime source. It does not verify credentials, database contents, Python installed-package lock state or model availability. Existing hashed static files are retained deliberately. Never claim browser visual verification based only on HTTP 200.
