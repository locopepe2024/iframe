# iFrame Live Research Discovery Gate v1

Date: 2026-10-10. Status: proposed; no live discovery provider is selected or deployed.

## Observed

- The deployed Playground Agent can search content already stored in the public and current owner's knowledge collections. `knowledge_search` does not access the open web, fetch a URL, or refresh an old source.
- A request for a recent NVIDIA briefing therefore produced a limitation response asking for links or a date. That response is consistent with the current code path. It does not show that a live search was attempted.
- An anonymous GDELT DOC API probe for `NVIDIA` returned HTTP 429 with a one-request-per-five-seconds notice. An anonymous Google News RSS probe timed out from this environment. These are observations of two probes, not proof that either provider is always unavailable.

## Direct Implication

The Agent needs two distinct capabilities before it can produce a recent, source-backed briefing from an open-ended question:

1. **Discovery:** obtain dated candidate URLs and publisher metadata from a configured provider. Candidate titles and snippets are leads, not citation evidence.
2. **Capture:** fetch selected accessible source documents under a bounded source policy, preserve raw bytes and capture time, extract text and relevant media with locators, and import a revision through the existing owner-scoped knowledge API. A source that fails capture or parsing cannot support a factual claim.

The current owner API can accept collected units from another Agent. It does not perform either step itself. A financial analysis skill may choose dimensions and query terms; it cannot grant network access or make a snippet authoritative.

## First Vertical Slice

1. Add a provider-neutral `knowledge.discover` service. Its configuration identifies the provider, credential reference if needed, regional/date constraints, per-user request budget, timeout and backoff. Store no provider secret in a chat message or source record. Do not silently substitute another provider after a failure.
2. Return at most ten candidate records with query, provider, retrieval time, title, publisher, published time if supplied, canonical URL, language, and access/status fields. Distinguish provider failure, rate limit, no results and missing configuration. Reject fabricated dates and URLs.
3. Let the user select a candidate or supply a URL. The capture job validates the URL and every redirect/DNS destination, respects source access restrictions, bounds bytes and MIME types, and stores the raw response and parser version. The first supported fixture is a public HTML article with text, an image and a caption. Official filings and market data use separate source adapters because their structures and units differ.
4. Import only authorized extracted material into the current owner's collection. Each text/image unit retains a section or figure locator, original source URL, source publication time if verified, capture time, rights status and immutable revision. If rights are unclear, keep the source in a review state and avoid republishing it to the public base.
5. The Agent may answer a “recent briefing” only from captured, queryable units. It displays an as-of time, exact citations and material gaps. If discovery succeeds but capture fails, it reports candidates and the failure; it does not turn snippets into a briefing.

## Acceptance

- A test provider fixture returns three dated NVIDIA candidates; the Agent shows them as unverified leads and does not save them as knowledge units.
- A selected public HTML fixture with text, image and caption becomes one private, queryable source revision. Repeating unchanged content is idempotent; changed content creates a new revision with old citations intact.
- Owner B cannot see Owner A's captured text, metadata or media. An attempted private-IP redirect, oversized response, unsupported content type or rate-limited provider fails with a stable reason and leaves no partial published revision.
- A generated briefing uses only successfully captured units, carries exact unit/revision/source IDs and an as-of date, and separates source statements from analysis. A test with discovery-only results cannot produce cited factual claims.
- The selected provider passes a documented live smoke test for availability, terms and rate limits before an administrator enables it in production. Provider failure leaves the existing library-search path available and visibly marks live research unavailable.

## Not Yet Proven

- No free public search source has passed the availability and usage checks for shared deployment. The GDELT and Google News probes above are insufficient to select a provider.
- No live article capture, image association, publication-date verification, licensing review, model-backed briefing or citation-accuracy evaluation has passed.
- Financial figures require official filing/market adapters with period, unit, currency and timestamp normalization. General news capture cannot establish current share price or financial facts.

## Review Boundary

This document is a development gate, not deployment authorization. The next implementation PR must include provider documentation, fixture-based behavior tests, the live smoke result and a migration/rollback plan. An iFrame administrator reviews, merges and deploys it.
