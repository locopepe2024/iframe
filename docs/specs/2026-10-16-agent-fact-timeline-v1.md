# Agent fact timeline v1

## Scope

Store owner-scoped, source-backed statements extracted from user chat. This is a
derived fact layer, not a diary, skill, diagnosis, or verified account of the
outside world. Existing confirmed `agent_memories` remain unchanged.

## Assumptions and boundaries

- The SQLite Agent session is the source of truth for user message existence.
- Only an exact substring of a saved user message can support an extracted event.
- A statement's recorded time and its claimed effective time are separate.
- Vague time is retained as text with `imprecise` precision; the system does not
  invent a calendar date.
- New statements append events. Correction and retraction link to earlier events
  and never rewrite their original quote.
- Extraction is best effort after a completed turn. A failed extraction does not
  fail the chat request; the owner can retry extraction for a saved message.
- No extracted event is injected into Chat prompts in this slice.
- Category settings are owner-wide even though their UI entry is on each
  session's overflow menu. The UI must state this scope.
- `current` is the latest original statement per category, subject and predicate,
  with a later correction or retraction applied to that specific statement.
  It is not a verified current condition; `recent` uses recorded time (default 30
  days), and `history` returns the bounded recorded timeline.

## Data

`agent_fact_events` holds owner, source session/message, quote, category, subject,
predicate, value, recorded time, claimed time text, optional exact date bounds,
time precision, event relation, target event, and creation time. Exact source
and quote are unique per owner. A source deletion removes its derived events and
events that depend on them. Reads check source existence and quote again.

## API

- `GET /agent/facts`: owner-scoped timeline, optional recorded-time interval.
- `POST /agent/facts/extract`: retry extraction for one saved user message.
- `POST /agent/facts/{id}/correct`: create a correction or retraction event from
  a later saved user message, with an exact supporting quote.
- `POST /agent/facts/query`: request `current`, `recent`, or `history` view;
  response names its `recorded_at` time basis and interpretation. Corrections
  require their replacement value to occur in the quoted user message.
- `GET/PATCH /agent/fact-categories`: inspect and update owner-wide capture
  and future recall preferences. Recall is not enabled in this release.

## Verification

- Reject fabricated quotes and assistant-source messages.
- Idempotent extraction and owner isolation.
- Preserve imprecise time and historical events after a state change.
- Deleting a source message or session prevents derived facts from being recalled.
- Test correction and retraction links without mutating the earlier quote.
- Reject a replacement value invented outside the correcting message.
- Reject exact date boundaries absent from the quoted user text.
- Apply a retraction to its target, without hiding a newer independent statement.
- Distinguish latest user report from verified current state.

Affected paths: `src/apps/agent_api.py`, `src/apps/agent_facts.py`,
`tests/test_agent_facts.py`.
