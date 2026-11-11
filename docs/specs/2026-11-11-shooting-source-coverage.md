# Shooting structure source coverage

Observed: the live 807-character source was split into four units. Both structure responses failed the existing exact coverage contract. Rejected assignments were not retained, so the specific missing/duplicated/reordered/out-of-range IDs cannot be recovered for that request. Existing retries only repeated a generic error.

Keep the admission boundary: flattening all scenes/beats must equal the zero-based input IDs in order, once each. Do not guess, renumber, sort, drop or add assignments locally. Structures with invalid coverage must never be checkpointed or trigger shot generation.

Send the expected ID sequence and allowed ID enum on the initial request, with an explicit zero-based indexing rule. Each validation failure computes a bounded diagnostic containing missing, duplicate, out-of-range IDs and ordering errors. The single existing correction attempt receives the actual rejected scene/beat assignments and differences; this is an actionable correction, not a new unbounded retry chain. Logs contain only counts and bounded numeric differences, never source text or credentials. Update the shooting prompt version to invalidate prior checkpoints under the changed protocol.

Tests first reproduce missing, duplicate, reordered and invented IDs, then verify precise correction input, successful corrected coverage, and rejection without saving/shot generation after two invalid returns. Provider responses are mocked; no paid requests are needed. Live model adherence remains unverified until the user submits another request.
