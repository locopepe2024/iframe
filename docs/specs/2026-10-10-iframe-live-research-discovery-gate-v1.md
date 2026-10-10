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

## Conversation And Task Contract

The Playground conversation Agent owns the user interaction and research plan. A network discovery adapter returns candidate metadata; an ingestion worker captures, parses and indexes selected sources; the knowledge service retrieves authorized evidence. These are distinct capabilities behind typed calls, not independent chat participants with separate answers. When an enabled live research tool can discover sources, an empty library search alone must not cause the Agent to ask the user for links.

For each request, extract a `ResearchIntent` with `subject` (company, event or topic), `entity_id` when resolved, `task` (briefing, comparison, explanation or collection), `as_of`, `time_window`, `regions`, `dimensions`, `source_scope` (public plus authorized owner/project material), `freshness_requirement`, `output_format` and `collection_mode` (one-off or subscription). Keep the user's exact wording alongside normalized values. Defaults may fill presentation choices and a one-off collection mode; they must not silently resolve an ambiguous listed company, change an explicit date range, or enable continuing collection.

Ask one grouped clarification only when the answer materially changes the evidence set or conclusion: an ambiguous entity/ticker, a date range that cannot be resolved from the request or conversation, or a source/access choice requiring user action. Reuse established conversation context, including a previously specified March 2026 range. If the user only says "recent", use the last 30 calendar days ending at the visible as-of date and state that window in the progress and answer; the user can change it. If an optional dimension is missing, propose a small editable set and proceed. Continuing refresh, adding a private paywalled source, and publishing into the shared public library retain their separate authorization or curator boundaries.

The Agent first searches the authorized library and records its coverage and newest relevant source date. If evidence is absent or older than the requested window and live research is enabled, it creates a bounded `ResearchRun` and calls discovery. Discovery returns leads only. The Agent presents candidate sources and their access/rights status for capture under the first slice's explicit selection rule; a user request naming URLs or approving the proposed list supplies selection. The worker captures selected sources, preserves raw revisions, extracts text and media with locators, indexes completed units, and returns source/revision IDs. The Agent searches those revisions and writes the answer from queryable units. A future preauthorized source policy may allow automatic selection, but that requires a separate reviewed change.

Persist each run with `run_id`, authenticated owner, conversation/turn ID, normalized intent and its revision, selected sources, per-source job IDs, budgets, state, errors and timestamps. A handoff is a typed command with correlation and idempotency keys; the model cannot submit arbitrary network URLs directly to the worker. Run states are `needs_clarification`, `searching_library`, `discovering`, `awaiting_source_selection`, `capturing`, `indexing`, `ready`, `partial`, `failed` and `cancelled`. The UI shows phase, source count and failures; discovery completion is never displayed as capture completion. On restart, the Agent reloads the run from durable job state. The user can cancel a run; subscriptions have separate pause/resume controls.

The answer carries `as_of`, requested window, source publication and capture times, exact source/revision/unit citations, evidence gaps and per-source failures. Source statements, normalized financial facts and Agent analysis remain labeled separately. A partial run answers only supported dimensions and names the missing ones. A pending run yields progress with its `run_id`, not a fabricated briefing. The Agent must report a real provider outage or disabled capability rather than claiming live research happened.

Example for a first NVIDIA briefing demo:

1. User: "检索并生成英伟达 2026 年 3 月的近期简报，重点看财报、Blackwell 和出口限制。" The Agent resolves subject, window and dimensions without another question; it reports library coverage and starts discovery.
2. Agent: "找到 4 条候选来源，其中 2 条可采集。请选择要纳入本次简报的来源。" Candidate titles are labeled as leads. After the user selects sources, the Agent returns a durable run ID and phase while capture/indexing continue.
3. Once indexed, the Agent returns a dated briefing with unit-level citations and a gap for any missing price, filing or regulatory fact. "加上客户资本开支" updates the dimension revision and searches for that evidence without replacing earlier source revisions. "每周更新" creates a subscription only after the user requests it.

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
