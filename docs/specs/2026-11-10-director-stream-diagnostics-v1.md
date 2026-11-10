# Director stream failure diagnostics

The production Director job received an SSE `api_error` about 153 seconds after dispatch. Its failure audit incorrectly retained the preceding request's 3,936-character response. JSON shape alone cannot establish provider success, and a failed stream must remain failed.

Use request-context-local Director raw-response and source-audit state. Clear it before each analysis; attach current source, raw-response availability and failure stage to exceptions. Keep provider failures distinct from JSON parsing and profile admission. Preserve exception-local evidence when the pipeline handles a failure.

Record content-free stream diagnostics on the adapter error: elapsed time, response character/chunk counts, finish reason and HTTP request ID when available. Log iteration failure before closing the stream. Do not add `max_tokens`, change provider credentials, ignore error events, retry partial generations or recover incomplete output.

Verify sequential and concurrent audit isolation, preservation of failed SSE responses (including syntactically complete JSON), response cleanup, provider-vs-admission classification and existing routing behavior. A single wire-level replay records event ordering/counts without persisting screenplay text or credentials. Gateway accounting is evidence of billing, not proof that the client received a successful stream.
