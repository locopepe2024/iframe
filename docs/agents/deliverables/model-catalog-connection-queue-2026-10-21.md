# Model catalog delay: browser connection queue

## Observed

- Production revision remained 269d8727; backend and static manifest matched. No rollback.
- Six owner-scoped GET /agent/models probes: backend loopback 82–86 ms; public origin from host 92–97 ms. Seven returned model entries (six ordinary design models and H3 IR).
- Authorized, isolated headless Chrome reproduction on the actual episode/character workbench, without design/generation writes:
  - /agent/models Resource Timing: fetchStart 29615.4 ms, requestStart 48942.9 ms, responseStart 49533.4 ms, responseEnd 49534.3 ms.
  - Total 19918.9 ms; before request transmission 19327.5 ms; request-to-first-byte 590.5 ms; body transfer 0.9 ms. Protocol http/1.1.
  - Other previews and asset-pack requests showed 16–44-second waits before requestStart.
  - Multiple concurrent /series/:id downloads occupied connections for over two minutes in this reproduction.
- Production series response: 22,692,287 bytes with 425 asset revision snapshots; no Content-Encoding even when accepting gzip. Removing asset_revisions from this response yielded ~1.84 MB. Existing frontend entry paths independently request the same series for breadcrumbs, workflow mode and shared assets.

## Direct implication

The reproduced model delay occurs primarily before the HTTP request is sent. The upstream model API is not responsible for that 19.3-second segment. Large, repeated same-origin transfers occupy browser connections; the model request waits behind those transfers and asset previews.

## Change

- Series read projections omit asset_revisions, matching the existing project-read contract. Current assets, asset_revision, design drafts and design revisions remain. Persisted immutable history and dedicated history endpoints remain intact.
- Concurrent getSeries calls for the same workspace identity/series share only the in-flight request. Completed/rejected requests are removed; later reads fetch fresh state. Different identities/series do not share.
- Frontend nginx enables JSON, JavaScript and CSS gzip compression, including proxied JSON, reducing connection occupancy for text payloads. No client loading-label change.

## Verification boundary

Regression tests assert persisted revision history survives projected reads, overlapping series reads coalesce, later reads are fresh, and failure does not poison subsequent calls. Browser timing must be repeated after cutover; no claim of improvement follows merely from code changes.

Browser checks use an ephemeral context, output only timing and relevant UI labels, and block write methods. No screenshots, page dumps, tokens, cookies or project documents are retained.
