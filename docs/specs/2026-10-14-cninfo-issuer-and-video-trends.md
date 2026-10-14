# Issuer and video-trend discovery routing

## Observed

- Production `cninfo` currently recognizes only 美盈森 / 002303. The public CNINFO issuer search returned 怡亚通 / 002183 / orgId 9900003828, and a read-only announcement query returned an exact matching candidate dated 2026-10-14.
- `start_research()` reserves provider budget before calling the cninfo adapter. An unsupported subject consumes the 60-second provider cooldown; an immediate retry reports `rate_budget` without a network request.
- Video-model trend queries currently route into cninfo and fail `unsupported_subject`. GDELT was previously observed at 429 and its precise date window is 90 days. Google AI RSS exposes only recent weeks in the observed response; OpenAI news article capture returned 403. DeepMind exposes a public sitemap and allowed HTML pages, but sitemap `lastmod` is not publication date.

## Change boundary

- Resolve a user-supplied securities code or planned company name through CNINFO's public securities directory during the budgeted discovery request. Select exactly one active `A股` record and use its returned `(code, orgId, name)` for the announcement query. When both code and company name are supplied, require both directory searches to resolve to the same code. Debt securities and ambiguous matches cannot silently become the company identity. Shenzhen and Shanghai listings use their respective CNINFO announcement columns.
- "今年" is the calendar year through the current CN-local day. A year-to-date request is not silently narrowed to the default recent 30 days.
- Add a narrowly scoped `video_trends` discovery route for explicit video-generation model trend requests. It reads a bounded official DeepMind sitemap, returns only exact allowlisted article/model URLs, and labels publication time unknown. Candidates require user selection and worker capture before citations.
- Keep CNINFO capture auto-selection restricted to the exact official PDF candidates. A trend answer must disclose source and date coverage limits; no candidate title or sitemap modification time may be treated as proof of a trend.

## Verification

- Fixture tests for issuer routing, `002183` exact code/orgId filtering, conflicting identity rejection, video candidate URL filtering, and failure codes. The existing provider cooldown still applies to discovery requests; there is no pre-discovery company allowlist.
- Existing research/backend tests, relevant frontend tests, and typecheck. Production discovery/capture remains a deployment validation step.

## Remaining evidence limits

- CNINFO currently returns at most five recent matching announcements from one bounded page. This supports cited analysis of captured filings, but does not establish a complete year-to-date operating history. Annual or quarterly conclusions require relevant report coverage.
- The video route returns official DeepMind candidates with unknown publication dates. It neither proves that a candidate falls inside the requested year nor represents the whole industry. DeepMind capture requires a separately reviewed host allowlist change. Until captured and dated sources from more publishers exist, a full-year industry trend conclusion remains unverified.
