# Current cninfo research follow-up

## Scope and assumptions

- An explicit request for news, announcements, or analysis through "截至目前"/"截止目前"/"至今"/"到今天" uses the authenticated live-research capability when available. Explicitly disabled providers remain disabled.
- The planner interprets the user's start date and uses the cninfo local date (UTC+8) for "today". Without a start date, the existing 30-day default applies.
- A text search hit does not establish complete coverage through today. Current requests always check the configured discovery provider. Discovery candidates are leads, never citations.
- Automatic capture is limited to the configured cninfo provider, its existing exact issuer adapter, publicly accessible candidates, and the existing five-source limit. Other providers retain manual selection.
- The independent knowledge worker captures and imports owner-scoped source units. The existing answer endpoint creates one cited assistant message when a run becomes ready; the conversation polls for that message. Failures remain visible in the task.

## Success criteria

1. At the UTC/CN midnight boundary, both planning and cninfo discovery use the same CN-local day.
2. A current cninfo request queues only approved discovered URLs; a non-cninfo or historical request still requires selection.
3. A completed run produces one cited answer in the same conversation; no-results and capture failures are shown without a fabricated answer.
4. Backend and frontend tests cover date boundary, automatic selection, and the user request flag.

## Affected paths and verification

- `src/apps/agent_api.py`, `src/apps/knowledge/{api,discovery}.py`
- `frontend/src/components/modules/playground/useAgentConversation.ts`
- `tests/test_{agent_chat,knowledge_research}.py`, related frontend tests
- Run focused pytest, Vitest, and TypeScript checks. Production network and worker E2E require deployed code and configured credentials; local tests do not prove that runtime behavior.
