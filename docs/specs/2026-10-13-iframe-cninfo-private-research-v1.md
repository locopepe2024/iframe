# iFrame private CNINFO research slice

Date: 2026-10-13. Scope: owner-private research of the SZSE issuer 美盈森 / 002303. This is not a general market-data provider.

## Evidence and assumptions

- A read-only CNINFO query with `stock=002303,9900008616` and March 2026 dates returned three matching announcements. Their HTTPS links on `static.cninfo.com.cn` responded as PDF. This is one runtime observation, not an availability or licensing guarantee.
- The user authorized storage in their private knowledge collection and enabling an exact capture-host allowlist. No public sharing or refresh is intended.
- Current discovery has no CNINFO provider, capture accepts only HTML, and answer evidence takes the first 20 units. A host setting alone cannot complete the requested flow.

## Slice contract

1. Add a `cninfo` provider for the exact issuer identity `002303` / `美盈森`. Reject other subjects and invalid date windows. Query one page with bounded response, verify each result's code, org ID, date, PDF path and size, and return at most five candidate links. Treat metadata as candidates, never answer evidence.
2. Permit PDF capture only on the exact `static.cninfo.com.cn` host and `/finalpage/YYYY-MM-DD/id.PDF` path. Reuse DNS/public-IP, TLS, redirect, status and response-size checks. Extract text into bounded page-located units; reject encrypted, empty, malformed or excessive PDFs. No OCR or automatic table fidelity claim.
3. Preserve owner scope and existing user source selection. A private import records rights status `unknown`. Never publish source bytes or text to a public collection.
4. Keep discovery and capture rate limited. All authenticated owners may use the `cninfo` provider; owner-private collections and source selection remain enforced. Deploy API and worker at the same commit with `IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER=cninfo` and `IFRAME_KNOWLEDGE_CAPTURE_HOSTS=static.cninfo.com.cn`. `IFRAME_KNOWLEDGE_CNINFO_OWNERS` is retired. This replaces the existing single `fed_rss` provider while active; rollback restores prior values.

## Verification and release gate

- Unit tests cover issuer/date rejection, result filtering, rate/error handling, PDF path restrictions, page locators, malformed/empty PDF, and existing HTML behavior.
- Local test uses a fixed March 2026 CNINFO response and a small PDF fixture. Real read-only smoke checks 002303/March 2026 and a single selected PDF without storing source bytes in the repo.
- Production smoke uses the existing test owner, selects one announcement, checks job completion, private source/revision/unit readback, exact page locator and answer support. Inspect API/worker versions and host configuration, health and restart count. All authenticated owners have access, but discovery remains limited to the implemented issuer identity.
- Stop on 403/429, unstable responses, failed extraction, an unexpected redirect/host, or unsupported citation. Document retained private objects and restore prior provider/hosts if the smoke fails.

## Limitations

CNINFO's published access/retention terms and any commercial licensing conditions are not yet confirmed. The owner's private-use authorization determines this smoke scope only; it does not establish rights for broader deployment. PDF text extraction does not guarantee correct table interpretation, OCR or semantic citation support. Interface stability remains unproven by a single query.

## Production owner API import observation

On 2026-10-13, before enabling the provider, one reviewed [March 19 announcement](https://static.cninfo.com.cn/finalpage/2026-03-19/1225016378.PDF) was imported through the existing loopback owner API using the `/opt/.iframe` key's derived owner identity. The API stored a private `finance` collection `8caefd4a-2062-46d1-b169-d2bc7f2c0c76`, source `91687709-ebb3-4cdb-9739-2e2ca2d0f39d`, and revision `e229d734-ff52-45a9-9370-03ad78f77520`. All three page-located text units were read back with matching body hashes; owner search returned three hits. A repeat import returned `created=false`. The PDF bytes were not submitted to the API: the stored raw object is the owner API's JSON import payload, with the PDF kept as `source_uri`.

This verifies a one-time private text import and readback only. It does not validate the new discovery provider, worker PDF capture, answer generation, cross-owner access or production allowlist. The collection persists; the current API has no deletion endpoint. Production source/backend/static remained `349ab1214b68deb7d7296292bb76af6ff97f4ee9` at the start of this work.
