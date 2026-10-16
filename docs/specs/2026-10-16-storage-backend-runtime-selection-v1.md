# Storage backend runtime selection

Code fact: #142 exposed IFRAME_STORAGE_BACKEND but neither cloud upload
adapter read it. Configuring local could still upload to COS when credentials
were present. This slice makes an explicit backend gate new cloud writes.

Contract: local disables cloud uploads, cos permits only COS uploads, oss
permits only OSS uploads and prevents credential-driven COS selection.
When the setting is absent, preserve legacy COS-first selection and upload
behavior for installations that have not opted in. Missing COS credentials
must not activate OSS writes when cos was selected. Existing cloud reads and
signing remain available in local mode so previously persisted keys can renew.
The existing OSS_ENABLE flag still gates OSS writes.

Verify with fake clients and no network: both credentials present with explicit
OSS selects OSS; local performs zero cloud writes while retaining signing;
explicit COS without credentials performs no OSS writes; unset retains legacy
selection. No deployment, credentials, root migration or rendering changes.
