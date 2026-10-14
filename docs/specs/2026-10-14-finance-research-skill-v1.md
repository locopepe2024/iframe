# Company finance research guidance v1

## Observed

- Company research currently uses generic planning and answer prompts. The installed creative skill catalog has no finance package and does not run on the live research answer path.
- An unspecified company operating analysis defaults to 30 days. CNINFO listed the 2026 half-year report for 002183 on August 28, outside the October 14 default window. The full report is above the current 4 MiB PDF capture limit; its four-page official summary is within that limit.
- CNINFO discovery currently returns the first five announcements, and research evidence is bounded to 20 content units. A finance prompt alone cannot make an undiscovered report available.

## Scope and assumptions

- Add a repository-owned finance research `SKILL.md`, loaded by the server only for CNINFO company research planning and cited answers. It is automatic domain guidance, not an owner-installed creative skill and grants no source access.
- For an undated company operating or financial analysis, use the current calendar year to date. Respect explicit dates, recent-news requests and the existing 366-day maximum.
- Within a bounded CNINFO result page, prioritize the latest official periodic-report summary for operating analysis, then recent announcements. The candidate remains subject to exact issuer, URL, date, capture and citation checks. Do not claim complete coverage of all filings.
- Keep source limits visible: captured summaries are condensed disclosures; claims about business causes, segment trends or investment action need their own cited evidence.

## Success criteria

- A generic 002183 operating request plans a year-to-date window and includes the official half-year report summary candidate when present on the bounded page.
- The finance guidance appears in company research planning and answering, but not video trend research or ordinary chat.
- Financial claims require period, unit, comparison basis and citation; unsupported causal explanations and investment recommendations are labeled or omitted.
- The answer closes with at most one evidence-grounded next question when it helps the user continue the original research goal; it does not default to soliciting holdings or buy/sell preferences.
- Focused backend tests and existing research regression tests pass. Production capture and answer remain a separate post-deployment validation.

## Affected paths and commands

- `config/research_skills/company-finance/SKILL.md`, `src/apps/agent_api.py`, `src/apps/knowledge/discovery.py`, related tests.
- `pytest -q tests/test_agent_chat.py tests/test_knowledge_research.py --disable-warnings` and `git diff --check`.
