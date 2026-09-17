# Independent image editor v1

Scope: reusable client-only Filerobot editor in shared/image-editor; Playground host opens local images and generated image results. Save creates an immutable owner-scoped copy, records source fingerprint and operation lineage, and appends to references without changing prior order. Saved copies remain browsable after reload. No AI generation, recreation cut changes, full-resolution frame extraction or paid calls in this slice.

Engine: react-filerobot-image-editor 4.9.1, react-konva 18.2.10, styled-components 5.3.11 (React 18 peer compatibility verified via npm). Core takes source/title/onSave/onClose and imports no Playground state or network client. AI mask is a separate future control layer, never a visible annotation implicitly sent as a mask.

Backend under existing /playground proxy: source validation resolves only owner-owned uploads/generated images; no server fetching arbitrary URLs. Source preview returns bytes plus server fingerprint. Saves verify source hash, bounded PNG/JPEG/WebP decode, immutable UUID output, idempotency key + payload identity, durable SQLite metadata. Saved media uses existing owner-scoped input-media retrieval.

UI: modal portal, focus containment/restoration, Escape/close dirty confirmation, busy guard, asynchronous save errors retain edits; translated labels; lazy-loaded engine. Source switching creates a new editor instance. Successful saves append only if the active session still matches the opening session; copies remain in history regardless.

Acceptance: source ownership rejection, malformed/oversized image rejection, immutable parent, replay returns same record, conflict rejects changed bytes, history reload, save failure retains edit, duplicate save blocked, reference order preserved, UI/typecheck/static production build. PR #3 commit 6cc623a is already an ancestor of iFrame and requires no duplicate merge.
