# iFrame Live Research: First Implementation Slice

Date: 2026-10-11. Status: code submitted for review; not deployed or enabled. This slice implements the conversation and task boundary proposed in `2026-10-10-iframe-live-research-discovery-gate-v1.md` (PR #71).

## Implemented contract

- Playground's Knowledge panel has a separate live-research toggle. It is disabled unless the backend advertises a configured provider and at least one allowed capture host. Ordinary public-plus-owner library retrieval retains its existing behavior.
- A live request uses the selected chat model to extract a bounded subject, English discovery query, date window and analysis dimensions. A material company ambiguity yields one clarification question and no discovery run. The model's plan is validated before it can trigger a tool; it cannot supply a capture host or change authorization.
- The Agent checks its existing authorized library for the subject before discovery and displays the hit count. This slice does not yet have a reliable freshness/coverage gate, so an explicit live request still performs discovery even when the library has hits.
- `POST /knowledge/research` creates an owner-scoped, durable run. The first provider adapter is GDELT DOC candidate discovery behind `IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER=gdelt`; no provider is enabled by default. Seen time is not labeled publication time. A database budget caps calls globally and per owner; provider errors and empty results get distinct codes.
- `POST /knowledge/research/{id}/sources` accepts at most five exact candidate URLs marked available by the configured host policy. The owner selects them in the conversation. A separate process runs `python -m src.apps.knowledge.worker`, claims jobs with leases, validates every HTTPS destination and redirect, pins the checked public IP while checking the original hostname's TLS certificate, bounds responses, extracts text and up to two image units, and imports raw HTML plus parsed units into the owner's research collection. Job IDs, errors and source/revision IDs survive API restart.
- When every selected job completes, Playground calls the idempotent Agent answer endpoint. It sends a bounded set of exact revision units to the model, requires at least one `[unit_id]` citation and records only cited units with the answer. Partial source failures are passed to the answer as gaps. Provider candidates alone cannot support an answer.

## Deployment gate

An administrator must review and merge the code, apply `knowledge/schema_v3.sql` through the existing `store.migrate()` path, and deploy a separately supervised worker sharing PostgreSQL and private COS with the API. Do not enable `IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER` until the selected provider's availability, access terms, rate limits and response format pass a documented live smoke test. `IFRAME_KNOWLEDGE_CAPTURE_HOSTS` must be an exact comma-separated list of reviewed HTTPS publisher hosts; it is empty by default. Worker and API need the same host policy and scoped database/COS credentials. Migration rollback, joint PostgreSQL/COS restore, worker restart, and source-rights review remain deployment checks. This PR does not execute any migration or deploy services.

## Known limits

- GDELT is only a candidate source, not a financial-facts provider. Its documented precise date parameters cover the last three months, so an older request such as March 2026 at the current 2026-10-11 date must fail with `provider_date_window_unsupported` or use another approved adapter. The adapter is coded against a fixture response; shared-environment availability and terms are not yet verified. Stock prices and fiscal metrics still need official/typed source adapters.
- HTML extraction uses the standard parser and can miss dynamic text, figures beyond the first two, tables, non-UTF-8 encodings, and publication dates. It stores unknown rights and imports to the current owner's private research collection only. No public publication or ongoing refresh is created.
- The model may return a plausible but wrong entity or date despite schema validation. Before using this for company-specific financial assertions, evaluate intent accuracy and require a verified ticker/issuer resolver. Citation syntax validation proves a referenced unit was supplied to the model; it does not prove the quoted unit supports every sentence.
- The answer is triggered by the open Playground client when jobs become ready. The durable run remains inspectable after a client restart, and the client resumes answer generation on reopen; an unattended worker does not invoke the user's model credentials.

## Verification

- Local backend tests cover planner ambiguity/date rejection, owner-scoped API handoff, provider metadata, private-host rejection, redirect recheck, pinned TLS hostname, capture import, cited and idempotent answer.
- Disposable PostgreSQL 18 test applies v1-v3 migrations and runs the candidate selection, job claim, import, completion and owner A/B read boundary in one rollback-only transaction. Production is PostgreSQL 16; this local test does not establish production migration safety.
- Frontend tests cover the live toggle, request flag, candidate selection and answer trigger. Typecheck and static build run in CI.
