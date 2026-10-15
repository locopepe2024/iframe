# Owned media reference reconciliation

## Observed

Production contains authenticated owner routes and frontend URL normalization that main lacks for imported Playground files. Main's Studio resolver rejects authentic expired original-media URLs, so an authenticated owner cannot reuse them in a later edit. The production history refresh calls `relpath(..., "output")` on a locator already relative to output; that produces `../users/...` rather than a fresh usable signed URL. Existing production tests only check that the URL changes, which does not prove access works.

## Scope and acceptance

Port only owner-local imported-media download and reference renewal behavior. An authenticated owner may resolve an expired original Studio signature after HMAC, ownership, realpath containment and file-existence checks. Public signed GETs still reject expiry and tampering. Refresh history/draft reference projections without mutating stored records; retain media names. Re-submission must turn a Studio locator into a real output-rooted file path and preserve names keyed by signed URLs. Fresh signed references must pass the public verification path and return the original bytes, not merely differ from the stale URL.

The editor maps owner-local Studio and Playground locators to authenticated routes. Same-backend signed Studio URLs may use the authenticated route for long-lived tabs; external URLs stay external. Preserve preview sizes, filename escaping and output-root semantics. Protect the new Playground route using the existing owner middleware and dependency checks. Cross-owner and symlink/traversal escapes must fail.

No new video-poster extraction, generation recovery, provider credentials, storage-root migration or remote FFmpeg service in this slice. Keep the observed Playground Failed to fetch report open until its exact failing operation is independently reproduced. Existing deployed patches remain running; submit the reviewed main reconciliation through a PR for administrator merge.

Verify Python owner-route, signature, history/session, H3 and multi-user behavior; frontend URL mapping/security tests and typecheck; full backend suite excluding the two previously established local Blender-environment tests. No model calls, no local Go, no wholesale deployment.
