# Research planning failure in conversation history

## Evidence and boundary

- `send()` calls `plan_research()` before appending the user turn. `plan_research()` calls the selected chat model before validating JSON, dates, and the 366-day limit. A validation failure currently returns HTTP 502, so the user turn is not stored.
- The frontend clears the composer when sending and only adds messages after a successful response. Its periodic reload cannot display a turn that the backend never saved.
- The exact model response in the reported production turn was not captured here. Code establishes that the displayed parsing error followed a successful `complete()` return, but does not identify which validation check failed.

## Behavior

- A request for unbounded company history receives a durable explanation that the current single-run discovery window is at most one year and asks for a bounded period. It does not silently narrow the request or claim full historical coverage.
- A live-research planning or discovery error is recorded as a user turn plus an assistant failure turn with a stage marker. Planner validation errors say the model returned a plan that failed validation; model transport errors remain distinguishable.
- No research run or citation is created for failed planning. A successful answer remains unchanged.

## Verification

- Reproduce the invalid-plan and transport paths with mocked model responses; verify persisted conversation messages after reload.
- Verify unbounded history does not call the model or discovery and produces a bounded-scope explanation.
- Verify the frontend marks saved research failures as incomplete and keeps the user message visible.
