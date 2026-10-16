# Deployment version alignment checklist

The runtime must be built from the exact reviewed GitHub main revision. For
this configuration slice, create a release manifest with
`scripts/verify_release.py create --build-revision <full-sha>` after the
frontend build, then verify the repository, static export, container source and
nginx snapshot with `scripts/verify_release.py verify` before cutover.

The deployment environment must provide the same `IFRAME_MEDIA_ROOT`,
`IFRAME_STORAGE_BACKEND`, `PROVIDER_MEDIA_PUBLIC_BASE_URL` and
`PROVIDER_MEDIA_URL_TTL_SECONDS` values used by the API configuration. The
public origin must resolve to the iFrame host and the provider route must be
reachable from Wan/GreenA/UniArt. A changed media root or backend requires a
restart and a retained mount; it does not migrate old files automatically.

This repository change does not deploy to `malysis`, modify containers, or
change credentials. Deployment remains an administrator-controlled action with
revision-pinned rollback verification.
