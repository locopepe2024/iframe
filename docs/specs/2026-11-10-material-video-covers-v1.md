# Material video covers

Temporary and saved video materials currently show a generic film icon. Retrieve a still through an authenticated owner-scoped endpoint, using the existing bounded, version-keyed WebP thumbnail generator. Resolve only owned temporary media or saved exact-version content; reject remote references, missing files and non-video materials before attempting thumbnail generation.

Load covers when cards approach the viewport. Fetch through the authenticated API client, cancel outstanding requests when a card changes or unmounts, and revoke browser object URLs. Keep the film icon when a cover is unavailable. Preserve media bytes, generation history, saved versions and project references; automatic deletion remains paused.

Verify both temporary and saved covers, cross-owner rejection, invalid references and thumbnail failures. Run the combined material, screenplay, Director and owner-routing regressions before merging the independently reviewed PRs.
