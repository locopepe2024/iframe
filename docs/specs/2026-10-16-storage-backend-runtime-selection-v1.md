# Storage backend runtime selection

Code fact: #142 exposed IFRAME_STORAGE_BACKEND but neither cloud upload
adapter read it. Configuring local could still upload to COS when credentials
were present. This slice makes an explicit backend gate new cloud writes.

Contract: local disables cloud uploads, while cos permits only COS uploads.
The OSS setting is disabled in the API and Settings UI until its read identity
and signing path are defined.
When the setting is absent, preserve legacy COS-first selection and upload
behavior for installations that have not opted in. Missing COS credentials
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
