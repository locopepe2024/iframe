# iFrame Knowledge Runtime Deployment Runbook v1

Status: deployed at `621246da0309b3bfd96e718bd43a4d43509d8e81`; later `main` CI fixes are not on the host. Date: 2026-10-10.

## Required state

- Release source is a clean, GitHub-pushed `feature/` or `fix/` branch containing the current production changes and merged knowledge API. The host release script rejects `main` and unpushed revisions.
- TencentDB `iframe_knowledge` has migrations v1/v2; the iFrame host can reach its private endpoint with CA-verified TLS.
- COS bucket `iframe-knowledge-1451819552` is private. The dedicated `iframe-knowledge-cos-app` CAM identity is limited to the bucket's `knowledge/` prefix; scoped write/read passed and a write outside the prefix was denied. The application relies on the bucket's private default ACL and does not request object ACL changes.
- Host `/srv/lumenx/runtime/knowledge-pg-provision/` is mode `0700`. The four files `knowledge-pg-app-password`, `knowledge-pg-ca.pem`, `knowledge-cos-secret-id`, `knowledge-cos-secret-key` are regular files, not symlinks, with mode `0600`. Never print their contents.
- Managed `/srv/lumenx/repo/.env` is mode `0600` and defines `IFRAME_KNOWLEDGE_PG_HOST`, `IFRAME_KNOWLEDGE_PG_USER`, `IFRAME_KNOWLEDGE_BLOB_BACKEND=cos`, `IFRAME_KNOWLEDGE_COS_REGION`, `IFRAME_KNOWLEDGE_COS_BUCKET`, and these exact container paths:
  - `IFRAME_KNOWLEDGE_PG_PASSWORD_FILE=/run/iframe-knowledge/knowledge-pg-app-password`
  - `IFRAME_KNOWLEDGE_PG_CA_FILE=/run/iframe-knowledge/knowledge-pg-ca.pem`
  - `IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE=/run/iframe-knowledge/knowledge-cos-secret-id`
  - `IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE=/run/iframe-knowledge/knowledge-cos-secret-key`

`scripts/iframe_release.py` accepts the current one-mount production topology during inspection. For candidate and new production containers it adds the secrets directory read-only, checks OpenAPI knowledge routes, and verifies database connectivity. No secret is written into the image or release manifest.

## Prepare and deploy

1. On the host, fetch and check out the reviewed feature branch; confirm the working tree is clean and its full revision matches GitHub.
2. Run `python3 scripts/iframe_release.py inspect` and record backend/static revision.
3. Run `sudo python3 scripts/iframe_release.py prepare --revision <full-sha>`. Candidate startup must pass state-identity, route and knowledge database checks. The production backend stays untouched during prepare.
4. `prepare` removes its candidate on success. For deeper HTTP acceptance, start a separate container from the prepared image on localhost port 17178 with an isolated copy of durable output state, the same managed environment and read-only secret mount. Use disposable collections and source fixtures. Confirm text/image/video import, exact revision and locator IDs, owner A/B isolation and COS media read. Public publication visibility requires a separate curator fixture and remains unverified. Remove disposable data under the retention procedure.
5. Run `sudo python3 scripts/iframe_release.py deploy --revision <full-sha>` only after the candidate checks pass. Confirm the live backend/static revision and repeat the owner A/B HTTP smoke test.

## Deployment evidence (2026-10-10)

- `prepare` verified isolated candidate health, knowledge routes, TLS database access and unchanged project/series identities. The production revision was still `e01224463a82b4aa8db0c2dd984198c3b6e668fa`.
- A separate isolated HTTP candidate and the live API each passed two-browser-identity import, idempotency, text/image/video retrieval and private-isolation checks using disposable fixtures. This does not validate real third-party identity login or public publication.
- `deploy` completed. `inspect` reported matching backend and static revision `621246da0309b3bfd96e718bd43a4d43509d8e81`; localhost static `build-manifest.json` reported the same revision. Previous containers and static content remain as rollback targets.
- GitHub `main` later advanced to PR #67 and Backend CI run `38043886431` passed. The host remains pinned to the reviewed knowledge release. Its earlier CI failure included missing FFmpeg and other baseline assertions; PR #67 addressed those in a later revision.

## Outstanding gates

- The scoped COS identity exists; verify its key rotation and revoke any stale key before production ingestion.
- Database and COS backup/restore must be exercised together before production ingestion. The existing release snapshot covers Studio files, not PostgreSQL/COS.
- Web collection workers, Playground Agent tool calls, and public curator APIs are separate later slices. This release does not claim those capabilities.
