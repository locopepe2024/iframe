# Outbound LLM request diagnostics

## Observed

The production backend at commit `102748946` handled the character-design request near 2026-10-14 10:09 UTC and sent one successful request to `/v1/chat/completions`. It had no outbound request-body log. The user-observed UniArt entry reported 27,170 input tokens, of which 22,260 were cache reads. Cache reads are included in input tokens.

The character-design endpoint sends two complete character-design skill instructions as a system message. Its user message contains the current role profile, visual requirements, previous editable draft, confirmed design, route, age stage, style, answers, project ID and selected reference IDs. If references are selected, it also sends their image URLs as multimodal parts. A saved character named `苏砚` has a 55-character profile and no saved design draft or confirmed design; this persisted data alone cannot explain the token total. The actual front-end request body was not retained, so unsaved fields and reference-image count for the reported call remain unknown.

## Diagnostic switch

Set `IFRAME_LLM_REQUEST_DEBUG=1` in the backend runtime environment and restart the backend for a short test session. Each outbound Agent or ComicGen chat request writes one JSON line to `output/diagnostics/llm-requests.jsonl`, or `$LUMENX_OUTPUT_DIR/diagnostics/llm-requests.jsonl` when an output root is configured. The file is mode `0600`. Entries include timestamp, model, message order, text, character counts and image counts. URLs, inline media bytes and common credential fields are redacted. This records the messages iFrame sends; it cannot reveal provider-internal prompts or determine image token accounting from byte size.

The default is off and writes no file. After testing, remove the runtime flag, restart the backend and delete the diagnostic file. Prompt text may contain private user content, so keep the file restricted and do not publish it.
