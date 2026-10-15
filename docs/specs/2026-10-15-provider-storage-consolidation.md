# Provider and storage configuration consolidation

Status: phased implementation. The first slice unifies upstream media URL configuration.

## Observed

- Provider media URLs use the supplier-specific `UNIART_MEDIA_BASE_URL`, although both UniArt and NSFW consume them. UniArt, Studio and Recreation read this variable separately.
- Provider media signatures default to 1,800 seconds. Browser preview URLs have a different audience and lifetime.
- Cloud upload selection currently depends on configured credentials. Several media paths still use literal `output` directories.
- Workspace ownership can depend on an API-key fingerprint. Exposing independent provider credentials requires preserving existing ownership.

## Boundaries and success criteria

Use one application codebase and external deployment profiles. Keep model suppliers (`uniart`, `nsfw`) independent of storage backends (`local`, `cos`, `oss`). Preserve existing data, task routing, ownership and signed URL verification. Never commit runtime credentials or generated media.

The existing deployed NSFW changes must be reconciled independently; merging a configuration slice does not establish that the entire deployed tree matches main. Editing/timeline features are developed in main iFrame and integrated afterward.

## Ordered implementation slices

1. **Upstream media configuration:** introduce supplier-neutral public origin and configurable signing lifetime. Route Studio, UniArt and Recreation through one validated configuration reader. Preserve the legacy origin variable when the new variable is absent. Reject invalid explicit settings. Tests cover origin precedence, validity, signature lifetime, existing access restrictions and real adapter selection.
2. **Provider profiles and catalogs:** separate credentials/endpoints for UniArt and NSFW; switch normalized catalogs by selected provider; namespace caches/models. First define the stable workspace identity migration and task snapshot contract. Changing provider or API key must retain assets/history and original-provider polling.
3. **Media root and locators:** introduce one administrator-managed local root and owner-scoped media resolver. Audit Studio, Playground, library, previews/downloads, assembly, registry and recovery. Store stable locators; derive signed URLs on demand. Preserve legacy reads and reject traversal/symlink escapes.
4. **Storage adapters:** explicit local/COS/OSS selection; backend readiness errors rather than credential-driven selection or silent fallback. Cloud bucket/region/prefix, local staging/cache/export, retention and quotas. Test upload, generation output, preview, byte-range playback, download and upstream references for each backend. Switching defaults must preserve existing backend locators.
5. **Deployment consolidation:** reconcile reviewed NSFW patches with main, versioned external profiles and commit/image-pinned releases. Health output must identify the deployed revision. Validate before replacing production; preserve a rollback image and user volumes.

Each slice uses a feature branch and reviewed PR to main, with focused verification. No direct push to main. Do not deploy main wholesale over the NSFW host before the reconciliation slice.

## Slice 1 configuration

- `PROVIDER_MEDIA_PUBLIC_BASE_URL`: HTTP(S) origin without path, query, fragment or credentials; used regardless of model supplier.
- `UNIART_MEDIA_BASE_URL`: deprecated compatibility value, used only when the new variable is absent.
- `PROVIDER_MEDIA_URL_TTL_SECONDS`: positive integer, default 1800. Operators must size it for upstream queueing, retries and fetching. This does not refresh already submitted URLs.
- Media signing keys and browser preview expiration remain independent. No new storage root or storage backend behavior is claimed by this slice.

Affected paths: shared configuration reader, `studio_access.py`, `models/uniart.py`, Recreation media URL resolution, `.env.example`, focused tests.

Verification: `python3 -m pytest -q tests/test_provider_media_config.py tests/test_provider_media.py tests/test_uniart_image_controls.py tests/test_nsfw_new_one_image.py tests/test_recreation.py` plus relevant existing image/reference suites. No billable model requests. No local Go commands.

## Open evidence / follow-up

Expired historical preview requests have been observed; their relationship to the reported browser `Failed to fetch` is not established. Diagnose the exact failed browser operation separately; do not treat a signing configuration change as proof that this UI error is fixed.

## Slice 2a — independent owner provider profiles

Scope: backend configuration, catalog selection and existing image/video credential resolution; no global UI provider selector or default-provider change yet.

- Store one encrypted profile per existing workspace owner and provider (`uniart`, `nsfw`) in a separate SQLite table. An explicit profile has its own API key and base URL. Profile writes do not change browser identity, cookies or asset ownership. Use the existing encryption envelope, with separate keys per record; never mix legacy ciphertext with a new envelope.
- Expose owner-authenticated `GET/PUT /user/providers/{provider}`. API key is write-only; return readiness, not plaintext or key prefixes. Blank key explicitly clears it; an omitted key preserves it. An explicit empty/unavailable profile must fail rather than use another provider's key.
- An explicit `/config/models?provider=uniart|nsfw` fetches only that provider profile, namespaces IDs to that provider and applies only its own allowlist. No provider/model-name guessing at this boundary. The existing no-query catalog endpoint retains its legacy behavior until consumers migrate.
- Existing Studio and Playground image/video operations use their model's provider profile when present. With no explicit profile, preserve the legacy deployment contract and identify it as legacy in profile status. This compatibility does not apply to the new explicit catalog selection API. No cross-owner credential cache.
- Preserve existing task model/provider IDs. Global selection and endpoint changes for in-flight tasks remain gated on a later task profile/version snapshot slice; this batch does not advertise a global provider switch.

Success criteria: profile writes leave identity and other provider records unchanged; secrets encrypted on disk and absent from public responses; malformed endpoints fail; clear/missing-key profiles fail closed; explicit catalogs use matching credentials, namespacing and allowlists; Studio and Playground NSFW requests use the NSFW profile's endpoint/key, and legacy tests continue passing.

Verification: focused profile/API/catalog tests plus existing multi-user boundaries, model routing, NSFW image/video, Playground recovery and backend CI. No provider network calls in tests, no billable generations, no local Go. Deploy only after reviewing compatibility against the NSFW node's active jobs and unreconciled patches.
