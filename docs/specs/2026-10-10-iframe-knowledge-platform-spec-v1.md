# iFrame Knowledge Platform: Product And Data Spec v1

Status: proposed behavior, partially implemented (initial PostgreSQL schema and owner collection API). Date: 2026-10-10. This document specifies behavior; [architecture](2026-10-10-iframe-knowledge-platform-design-v1.md) assigns owners and [plan](2026-10-10-iframe-knowledge-platform-development-plan-v1.md) orders delivery. It refines [the domain knowledge requirements](2026-10-10-iframe-domain-knowledge-platform-v1.md).

## Goal and scope

One shared-deployment iFrame knowledge platform stores and retrieves source-backed material for screenwriting, directing, art, editing, video-quality analysis, and later financial research or other domains. The Playground conversation Agent remains the user entry. It proposes research, invokes registered knowledge tools, and returns cited suggestions. Ingestion and indexing are deterministic services; their summaries and extracted claims are reviewable derivatives, not source authority.

The first demonstrable path is: the Agent discovers a candidate or the user supplies a URL for an allowed illustrated article, and the user supplies a legally usable paper; iFrame captures text, images and paper figures/tables with source locations, indexes revisions, then answers distinct screenwriting and director/art questions with relevant citations and scope. A later research task can use the same lifecycle with financial source adapters and financial-specific normalization. The demo must not imply that all five creative domains or every website are supported at production depth.

## Observed code facts

- `src/apps/agent_api.py` accepts Playground Agent messages, calls a selected UniArt chat model, and attaches user-supplied media. It has no registered knowledge-tool loop or retrieval call.
- `src/apps/agent_skills.py` stores curated instruction snapshots per owner; skills do not grant execution or ingestion permission.
- `src/apps/comic_gen/pipeline.py` assembles storyboard context from the script, entities, confirmed Director context, and lineage. `structured_evidence.py` queries literal/structured script evidence. Neither is a general external-knowledge store.
- `src/apps/comic_gen/extraction_jobs.py` persists job status, while its callable runs in-process and interrupted jobs are marked failed on restart. It is unsuitable as the durable source-subscription worker without a separate design.
- `src/apps/studio_access.py` supplies owner-aware storage paths and signed Studio media delivery. Existing public `/files` mounts are not an authorization contract for knowledge originals.

## User and Agent contract

1. User asks the Agent to find, save, or use knowledge. The Agent distinguishes a quick search from durable import. Ordinary retrieval combines the curated public base with that user's private library and, when the task names an accessible project, its project library. Import defaults to the user's private library; publishing to the public base requires a separate platform-curator action. The Agent asks for missing scope only when ambiguity changes what can be accessed or saved.
2. Web discovery returns candidates with title, publisher, date, URL, media hints, and access status; library retrieval searches already imported units. A web search snippet is discovery metadata, never citation evidence. Import is a distinct action, recorded with initiating user/session and the selected source.
3. Ingestion returns a task ID and status. The user can inspect source identity, captured revision, text, figures, tables, extraction warnings, rights metadata, and generated summary before reusing derived claims as reviewed knowledge.
4. During a domain task, the Agent calls `knowledge.search` with domain, task, server-resolved owner/project scope, query, and current artifact context. Results combine authorized layers and include each hit's collection scope, bounded source excerpt, locator, and revision. If public and private sources disagree, both remain visible; a private correction does not rewrite a public source or silently become globally authoritative. The Agent may suggest how a source applies, but labels source fact, paper claim, case observation, and its own creative interpretation separately.
5. The user can accept, edit, dismiss, or pin a suggestion. Acceptance changes only the target domain draft through its existing review boundary. Knowledge never silently modifies script source, confirmed Director state, an edit plan, or a video-quality result.
6. If no source directly supports a proposed statement, the Agent reports the gap. A later source revision can produce a review notification, but does not rewrite historical output.

## Shared data contract

| Record | Required identity and state |
|---|---|
| `Collection` | ID, scope (`public_reference`, `owner`, `project`), owner/project IDs when applicable, curator/publisher for public scope, domain allowlist, created/updated times, revision and publication status |
| `Source` | ID, collection ID, canonical URI or upload ID, source type, title, publisher/author, published/updated dates when known, access/usage rights, discovery metadata, status |
| `SourceRevision` | ID, source ID, raw SHA-256, immutable raw-object locator, captured time, parser profile/version, extraction status, supersedes revision ID, optional ETag/Last-Modified |
| `ContentUnit` | ID, source-revision ID, kind (`text`, `image`, `table`, `video_segment`), exact page/section/character range or time range, parent/adjacent unit IDs, extracted content or asset ID, extraction confidence and method |
| `DerivedArtifact` | ID, input unit IDs/revisions, kind (`summary`, `caption`, `OCR`, `claim`, `embedding`), output, model/rule version, status (`candidate`, `reviewed`, `rejected`), reviewer/time if applicable |
| `ClaimAssessment` | claim ID, support unit IDs, contradictory unit IDs, source identity status, support strength, study/method status, applicability, freshness, rights status, review status; each field has a reason |
| `PersonalOverlay` | ID, owner/private collection ID, optional referenced public source/unit revision, added text/asset or claim ID, author, provenance type, created/revised time and status |
| `RetrievalRun` | request ID, owner/project/domain/task, query, filters, index revision, returned unit IDs/ranks, created time, truncation and failures |
| `KnowledgeUse` | consumer artifact ID/revision, exact source/claim revision IDs, use type, suggestion text, decision (`suggested`, `accepted`, `edited`, `dismissed`), decision time |

`ContentUnit` does not become a verified `ClaimAssessment` because it was parsed or semantically similar. Unknown author, date, license, page, figure association, or study method stays explicitly unknown. A reparse creates a new derived revision when extraction meaning changes; raw revisions remain immutable. Exact units and financial periods are mandatory for financial numerical claims and must be represented in the finance domain extension, never inferred from prose alone.

## Public base and personal extensions

- The platform's public collection is assembled from reviewed search/import results and approved uploads. Discovery or successful parsing alone never publishes a source. A curator records source rights, domain, review decision and publication revision before all users can retrieve it.
- A user may add private documents, citations, corrections, notes or domain-specific material, such as company disclosures, sword or fist techniques, and cuisine ingredients. Each item records who supplied it, its source and whether it is a quote, user observation, or unverified claim. User content stays private unless separately submitted and approved for public publication.
- Domain labels are extensible metadata, not a fixed list or an access-control mechanism. New subjects can use shared ingestion and retrieval immediately; specialized analysis templates and validation are added only when that domain has an explicit contract and evaluation set.
- Default retrieval is a server-authorized union of public and current-owner collections; an authorized project collection is added only in that project's context. Results show their layer and source provenance. Domain filters constrain relevance, not access; no request parameter can add another owner's collection.
- The same canonical URL can occur in public and private collections. Identical raw bytes may share a physical blob only if access checks and lifecycle accounting remain independent; source records, annotations, review decisions, revisions and citation IDs remain separate. Group duplicates in results without hiding a user's annotation or a conflicting revision.
- Personal knowledge can supplement or challenge the public base through a private overlay linked to a pinned public unit/revision, or through an independent private source; it does not overwrite public content. Ranking may prefer task-relevant owner material, while source support, currency and credibility are assessed separately. A saved answer pins the exact layer and source/claim/overlay revisions used, so later public or private updates do not rewrite it.
- Deleting a private item removes it from future retrieval and follows the applicable retention policy; historical use records keep a non-content tombstone when needed for audit. A public source is retired through a curator action, with previous citations marked unavailable or superseded rather than silently redirected.

## Ingestion and retrieval behavior

- Sources: explicit user upload or URL first; a configured public web-discovery provider may return candidate URLs for the Agent. Registered website/API adapters and subscriptions follow. Discovery never auto-imports or widens crawl scope. URL fetching permits only configured public HTTP(S) targets after DNS and redirect checks, rejects private/loopback/link-local destinations, limits size, redirects, depth, time, and media types, and respects source access terms and rate limits. Authenticated sites require a separate explicit integration contract.
- Preserve original bytes, fetch metadata and content hash before extraction. Parse HTML main text plus image URL/alt/caption/placement; parse PDF, paper figures/tables, OCR and attachments through a versioned parser. Missing images or partial parse produce partial status.
- Keep document structure: text-to-figure relationships, table units, source location, heading hierarchy, and figure order. A caption generated by a model is not an original caption. Original and generated labels must be distinguishable in API/UI.
- Index only authorized units. Keyword search with owner/project/domain/type/date/source filters is the first retrieval baseline. Add semantic/image retrieval only after domain test sets show a concrete recall gap. Results must return original IDs and locators regardless of index implementation.
- Summary generation is optional and bounded. The system should retrieve source units at answer time, not present a summary alone as evidence. Prompt-injection content remains quoted source data and cannot alter tool permissions or instructions.
- Continuous refresh belongs to a durable, pausable subscription with per-source interval, last attempt/success, next due time, cursor/validator, error and retry policy. It creates a new source revision only when bytes or source identity change. Search index publication is atomic per completed revision; old revisions remain queryable for historical uses.

## Domain boundaries and acceptance

| Domain | Required query context | Acceptance constraint |
|---|---|---|
| Screenwriting | Series/episode, scene/event, genre, source revision | Cited method or case is a suggestion, not new script fact |
| Directing | Confirmed Director/plan revision, scene/beat/shot, intended effect | Suggestion stays in editable Director/plan draft until confirmed |
| Art | Character/scene/prop identity, desired visual scope, image rights | Image is only used as generation reference when its rights and user selection permit it |
| Editing | Sequence/shot range, audio/video context, edit-plan revision | Proposed cut or transition cannot overwrite timeline silently |
| Video quality | Media ID, frame/time range, metric/model version | Objective measurement, model observation, and aesthetic judgment remain separate |
| Finance | Company/event identity, market, as-of time, periods/units/currency | Numerical assertions and directional scenarios cite exact financial evidence and preserve uncertainty |

All responses include source title, original URL/upload identity, version, locator, published/captured dates, provenance/rights state, and whether the passage directly supports the statement. Retrieval quality and source trust are independent; a high ranking does not upgrade trust. Existing script facts and confirmed Director decisions have precedence for project canon; outside knowledge may challenge them for review but cannot silently replace them.

## Success criteria and exclusions

The first vertical slice passes when a curated public source is visible to two owners, each owner can add private material, and each combined query returns public plus only that owner's evidence; identical URLs do not leak private annotations. Unchanged refresh is idempotent; changed source creates a new revision; text and image locators survive parse and index rebuild; screenwriting and director/art queries retrieve different relevant units; suggestions show source-versus-interpretation labels and do not mutate confirmed artifacts; old output remains pinned to old knowledge revisions; restart leaves queued refresh discoverable for retry.

Outside the first slice: automatic full-site crawling, unrestricted browsing, an autonomous team of agents, licensed-content redistribution, generalized graph RAG, automatic adoption of creative advice, and claims of financial prediction accuracy. These can be reconsidered against measured needs.

## Not yet proven

- Whether a given article, paper, or image permits capture, storage, quotation, export, or generation reference must be checked per source.
- Retrieval accuracy across creative and financial tasks requires separate answer sets with citation/locator grading. The schema alone does not establish quality.
- Video quality metrics and finance signal validity need task-specific runtime and statistical evidence; knowledge availability alone does not make those conclusions valid.
