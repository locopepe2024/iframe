# iFrame Knowledge Runtime Deployment Runbook v1

Status: prepared, not deployed. Date: 2026-10-10.

## Required state

- Release source is a clean, GitHub-pushed `feature/` or `fix/` branch containing the current production changes and merged knowledge API. The host release script rejects `main` and unpushed revisions.
- TencentDB `iframe_knowledge` has migrations v1/v2; the iFrame host can reach its private endpoint with CA-verified TLS.
- COS bucket `iframe-knowledge-1451819552` is private. Use a dedicated CAM identity limited to the bucket's `knowledge/` prefix; do not reuse a general provider key for the knowledge runtime.
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
4. Complete the two-owner acceptance against the candidate's localhost port 17178 before switching. Use disposable collections and source fixtures. Confirm text/image/video import, exact revision and locator IDs, owner A/B isolation, public publication visibility, and COS media read. Remove disposable data under the retention procedure.
5. Run `sudo python3 scripts/iframe_release.py deploy --revision <full-sha>` only after the candidate checks pass. Confirm the live backend/static revision and repeat the owner A/B HTTP smoke test.

## Outstanding gates

- The current COS bucket was checked with an administrative credential; dedicated CAM identity and scoped policy remain to be configured and verified.
- Database and COS backup/restore must be exercised together before production ingestion. The existing release snapshot covers Studio files, not PostgreSQL/COS.
- Web collection workers, Playground Agent tool calls, and public curator APIs are separate later slices. This release does not claim those capabilities.
