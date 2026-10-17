# Agent fact recall v1

## Goal and success criteria

When the owner enables memory in the recent session menu, a normal Chat
answer may use relevant, source-backed fact events from earlier sessions.
The prompt must distinguish a user's past statement from an independently
verified current condition. A retraction must not resurrect the targeted
statement. Turning off a category's recall setting must exclude its facts.

## Assumptions and boundaries

- Existing fact events are model-derived statements backed by an exact user
  quote. Their normalized values are not externally verified.
- This slice does not change extraction, add semantic embeddings, or recall
  facts during live research or H3 prompt optimization.
- Recall requires an owner-wide memory setting, default off. The owner-wide
  `auto_recall_enabled` setting further restricts fact categories. Memory
  management moves from the companion panel to the recent session menu.
- Turning off memory stops cross-session prompt injection but does not delete
  saved facts or confirmed memories. Automatic fact capture remains controlled
  by the separate category capture switches.
- Only statements from other sessions are candidates; the current session's
  recent messages already appear in Chat history.
- Candidate selection uses bounded lexical overlap and may miss paraphrases.
  It considers at most the 100 most recent distinct reports, then passes up
  to five matches. No match means no fact context. The API's explicit timeline
  query remains available for owner review in pages of up to 100 events.
- Source quotes are untrusted data. The prompt must forbid treating them as
  instructions, diagnosis, or proof of an external event.

## Implementation

1. Query the latest user report per category, subject and predicate, applying
   corrections and retractions to their targeted original statement.
2. Check the owner's recall setting and source existence, exclude events from
   the current session, and rank lexical matches against the current question.
3. Pass at most five small, source-labelled records to the normal Chat model.
   The current user message wins on conflict. Confirmed memories use the same
   owner-wide memory gate.
4. Put the memory enable switch and confirmed memory controls in the recent
   session overflow menu. Remove memory from companion skills. An old client
   may still send `memory` as a legacy skill ID, but it no longer enables
   recall or a companion style.

Affected paths: `src/apps/agent_facts.py`, `src/apps/agent_api.py`,
`tests/test_agent_facts.py`, `tests/test_agent_chat.py`, and Playground UI.

## Verification

- Relevant earlier statement appears only when owner memory and category
  recall are both enabled.
- Memory controls work from the session menu, and no memory choice appears in
  companion skills. Owner settings apply across sessions.
- Unrelated questions, deleted sources, and retracted statements do not appear.
- The prompt labels recalled material as past user reports, not verified facts.
