# iFrame Knowledge: Agent Search Slice v1

Status: implemented in source; production release pending. Date: 2026-10-10.

## Observed

- The deployed knowledge service accepts owner-scoped imports and searches published public plus the current owner's latest private revisions.
- Playground chat currently sends one model completion with no knowledge tool execution. Knowledge search is not invoked by the chat path.

## Contract

- A chat request may set `knowledge_search=true` and an optional `knowledge_query`. The server searches with the current authenticated `owner_profile_id`, the explicit query or the first 200 characters of the current user message, and a maximum of five hits. It never accepts a caller-supplied owner ID. The Playground exposes a query override for precise keyword lookup.
- Only normal Chat models without companion skills use this slice. H3 Context-IR and companion mode reject `knowledge_search=true` explicitly.
- Search failures leave the turn unsaved and return a service error. Empty results remain explicit; the model must not imply it found a source.
- Hits are bounded before inclusion in the model request. Search output is untrusted source data, not system instructions. The Agent must distinguish source claims from verified facts and may cite only returned IDs.
- The assistant message persists structured citations for the exact hit IDs and revisions used in that turn. The UI displays those citations with title, locator, collection scope, source URI and rights state. The citation list documents retrieved material, not proof that each source supports every generated claim.
- The search has no import, web fetch, public publication, draft mutation or attachment side effect.

## Acceptance

1. A normal chat turn with search enabled invokes `knowledge.store.search` once using its authenticated owner and at most five hits. A/B identities receive only their authorized results.
2. The model sees bounded excerpts and immutable citation IDs, and the saved assistant message exposes the same structured citations after reload.
3. A disabled turn performs no knowledge access. H3/companion use is rejected, and database failure does not save a partial turn.
4. Playground offers a binary search control and renders persisted citations without treating a source URL as a fetch command.

## Not Yet Proven

- Keyword retrieval recall, source truth, attribution accuracy in generated prose, or usefulness for finance and creative disciplines. Those need evaluated fixtures and human review.
- Automatic web collection, public curation, refresh jobs and model-proposed multi-step tool calls remain later slices.
