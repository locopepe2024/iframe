# LumenX Multi-User Identity, Config, and Session v1

## Status

- Date: 2026-09-14
- Branch: `feature/lumenx-multi-user-v1`
- Scope: authentication boundary, user configuration, Playground sessions/history/templates
- Identity owner: UniArt account service
- Business-data owner: LumenX

## Observed

- LumenX currently reads provider credentials from process environment variables.
- `GET /config/env` returns one server-wide masked credential state to every browser.
- `POST /config/env` changes the server-wide `.env` or packaged `config.json`.
- Playground sessions, generations, and templates are stored in shared JSON arrays without a user owner.
- UniArt/Canvas authenticates a bearer session and resolves both `user_id` and `owner_profile_id`.
- UniArt generation endpoints require an API token; an ordinary dashboard session is not a substitute for token auth.

## Direct Implication

- A browser identifier or localStorage-only namespace is not a security boundary.
- LumenX must authenticate every private API request before it can claim user isolation.
- User-editable provider credentials must not be written into the shared process environment.
- Every read, mutation, polling request, and background writeback must carry the authenticated owner.

## Not Yet Proven

- Legacy Studio projects, series, assets, voices, and task records are not yet owner-scoped.
- Existing production JSON files may contain records created by multiple human users but have no owner metadata.
- UniArt account APIs available to the production LumenX backend may differ from the local Canvas integration URL.

## v1 Architecture

### Authentication

- The browser signs in through LumenX `/auth/login`.
- LumenX forwards login to the configured UniArt identity endpoint.
- The returned opaque access token is stored by the browser and sent as `Authorization: Bearer ...`.
- LumenX validates the token through UniArt `/api/auth/me` and derives:
  - `user_id`
  - `owner_profile_id`
  - display identity
- Client-supplied owner identifiers are never authoritative.

### User Configuration

- LumenX stores one config document per `owner_profile_id`.
- Non-secret preferences are stored as JSON.
- Provider credentials are encrypted at rest with a server master key.
- Config reads return only `configured` and a short non-secret prefix; raw secrets are write-only.
- Environment credentials remain an explicit administrator fallback for legacy Studio paths during migration.

### Playground Ownership

- `PlaygroundSession`, `PlaygroundGeneration`, and `PlaygroundTemplate` carry `owner_user_id` and `owner_profile_id`.
- Storage queries require `owner_profile_id` and filter before returning data.
- Access to another owner's identifier returns 404 to avoid resource enumeration.
- Background generation receives an immutable owner context and resolves the owner's provider credential before submission.
- Output files are stored below `output/users/<owner_profile_id>/playground/`.

### Compatibility

- Existing ownerless Playground records migrate to a configurable legacy owner only when that owner is explicitly set.
- No authenticated user automatically inherits ownerless records.
- Legacy Studio routes remain available in this slice, but are labeled not yet multi-user-safe.

## Security Boundaries

- Fail closed when authentication is missing or UniArt validation is unavailable.
- Never log bearer tokens or decrypted provider credentials.
- Never return a stored provider credential after write.
- Do not cache authentication longer than a short bounded interval.
- Decryption requires `LUMENX_CONFIG_MASTER_KEY`; production startup must not generate an ephemeral key.
- Ordinary users cannot update process environment variables through `/config/env`.

## API Surface

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /user/config`
- `PUT /user/config`
- Existing `/playground/*` routes become authenticated and owner-scoped.

## Success Criteria

1. Anonymous Playground and user-config requests return 401.
2. User A cannot list, read, mutate, delete, poll, or save User B resources.
3. User A and User B can save different UniArt keys without changing process environment variables.
4. Config reads expose no raw credential.
5. A generation submitted by User A resolves only User A's credential.
6. Cross-user tests cover sessions, history, templates, generation status, deletion, and config.
7. Existing unrelated working-tree changes are not included.

## Follow-Up Phases

- Phase 2: owner-scope Studio projects, series, library assets, voices, uploads, and video tasks.
- Phase 3: migrate JSON persistence to transactional SQLite/PostgreSQL repositories.
- Phase 4: team/workspace sharing and explicit resource grants.
- Phase 5: remove the legacy environment credential fallback from user-facing production routes.

## Hypothesis

- Reusing UniArt identity while keeping LumenX business data separate should provide the fastest compatible migration path. Production endpoint compatibility and token lifetime behavior still require deployment validation.
