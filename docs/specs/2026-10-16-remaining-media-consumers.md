# Remaining media-root consumers

Contract: configured IFRAME_MEDIA_ROOT controls Agent default SQLite storage,
Recreation database/files/provider signing and remaining API media consumers.
LUMENX_AGENT_DB remains an explicit override. Default output behavior and
root-relative persisted media keys remain compatible. Recreation snapshots its
root per service instance; owner containment and signed-reference checks remain
mandatory. No storage migration or rendering behavior change is included.

Affected paths: agent_api.py, recreation/service.py, comic_gen/api.py.
Verification: custom-root database reopen/isolation, signed reference bytes,
foreign-owner rejection and symlink escape rejection; existing Agent/Recreation
tests and backend CI selection. All calls are local; no paid provider calls.

Runtime deployment and historical data migration are outside this code slice.
Existing data must remain in the configured root; changing the root does not
copy old databases or files automatically. Voice library expansion, timeline
editing and composition enhancements remain deferred.
