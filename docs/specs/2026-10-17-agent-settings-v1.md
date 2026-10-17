# Agent settings v1

## Scope and assumptions

- Add a user-wide Agent tab to the main settings page. Existing owner-scoped APIs remain the source of truth.
- Show the existing cross-session memory switch, per-category automatic capture and recall switches, and a path to confirmed memory management.
- Keep the session menu shortcuts for now. Both surfaces read and write the same owner settings.
- The former companion `memory` choice was one prompt and confirmed-memory feature, not a collection of profile skills. The remaining companion skills are listening, schedule, and cognition.

## Boundaries

- Fact recall budgets (500 raw rows, 100 reports, five model records) are server safety limits, not user settings and not conversation-summary limits.
- Conversation summarization and time-of-day summaries have no settings or runtime implementation in this slice. Do not present inactive controls.
- No API, storage schema, or per-session setting change.

## Acceptance

1. Settings has an Agent tab that loads the owner memory and fact category settings.
2. A user can change auto capture and auto recall independently per category; a failed save restores the previous state and shows an error.
3. Memory enable and confirmed-memory management use the existing API surface.
4. Existing session-menu controls remain functional.

## Affected paths and verification

- `frontend/src/components/settings/SettingsPage.tsx`, new `AgentSettings.tsx`, related frontend test.
- `npm run typecheck` and focused UI tests in `frontend/`.
