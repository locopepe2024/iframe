# Shot references and replacement images v1

Code facts: confirmed shots have IDs but re-confirming a timeline currently regenerates every ID. Media records already have stable IDs, owner checks, hashes and signed delivery paths. A neutral shared ImageEditor exports a File; Playground persistence is domain-specific and must not be reused for recreation writes.

Scope: confirmed shots store reference_media_id, replacement_media_id and a human replacement instruction. Upload validated PNG/JPEG/WebP as immutable owner-scoped reference_image/replacement_image media; edited copies link parent_media_id. Reuse existing indexed images via a paginated picker. Use the shared image editor for manual correction; no AI editing or paid generation in this slice.

Contracts: POST /recreation/projects/{id}/images multipart(file,kind,parent_media_id?); PUT /recreation/projects/{id}/shots/{shot_id}/references JSON(revision,analysis_id,reference_media_id?,replacement_media_id?,instruction). IDs, never signed URLs, are persisted. Binding validates image kind, current owner, file fingerprint and confirmed timeline under revision control. Returned project uses existing signing. Upload failure leaves no record/file. Existing media can be reused across projects owned by the same user. Detaching a binding does not delete media.

Timeline identity: preserve IDs and bindings only for shots with identical start/end PTS in the same analysis. Changed boundaries create unbound shots; reanalysis already discards the timeline. UI warns that changed shots lose assignments and blocks binding edits until draft cuts are confirmed.

Success: uploaded/edited files are searchable and original evidence remains immutable; reload retains shot bindings; stale revision and cross-owner IDs fail; unchanged shots survive reconfirmation; changed shots do not inherit stale references; invalid/oversized images are rejected. UI supports reference/replacement selection, upload, edit-as-copy, instruction and explicit save. Save failures preserve form drafts; switching projects does not publish stale results.

Validation: focused backend and API tests, reference-panel UI tests, existing recreation/library tests, frontend typecheck/build. Merge/deployment by version administrator through PR.

Local validation: 17 backend tests passed, 1 skipped; 13 UI tests passed; frontend typecheck and production build passed. The editor export integration is mocked in the new UI test; actual editing and signed-image delivery in the deployed browser still require acceptance. The neutral editor itself is reused unchanged. No H3 request or deployment performed.

Uploads register a reusable image immediately; assigning it to a shot requires a separate save. Unsaved form changes are local to the selected shot and are discarded on navigation. There is no image deletion endpoint in this slice. Repeated upload retries may register separate media records; byte deduplication is not claimed.
