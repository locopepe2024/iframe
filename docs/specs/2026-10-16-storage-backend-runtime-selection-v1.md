# Storage backend runtime selection

Code fact: #142 exposed IFRAME_STORAGE_BACKEND but neither cloud upload
adapter read it. Configuring local could still upload to COS when credentials
were present. This slice makes an explicit backend gate new cloud writes.

Contract: local disables cloud uploads, while cos permits only COS uploads.
The OSS setting is disabled in the API and Settings UI until its read identity
and signing path are defined.
Storage backend selection is platform-scoped. It is read from the server
environment (`.env` in the current deployment) and is not a user preference.
The account settings page is read-only: it may show the effective backend, but
must not expose controls that write backend, media-root, public-origin, or TTL
settings. There is no per-user storage selection or credential flow in this
version.
When the setting is absent, preserve legacy COS-first selection and upload
behavior for installations that have not opted in. The read-only settings
status must report COS in this legacy case when COS credentials are configured.
Missing COS credentials
must not activate OSS writes when cos was selected. Explicit local mode rejects
cloud reads and signing; existing cloud media must be moved to the local root or
regenerated before switching. Explicit cos mode rejects local media delivery;
local generation intermediates may still exist on the host but are not an
additional published storage backend. The existing OSS_ENABLE flag applies
only to the legacy unset mode.

Verify with fake clients and no network: local performs zero cloud writes or
signing; explicit COS without credentials performs no OSS writes;
unset retains legacy selection; OSS is rejected as a new setting. No deployment,
credentials, root migration or rendering changes.
