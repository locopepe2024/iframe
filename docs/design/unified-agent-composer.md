# Unified composer

Agent is a type in the existing image/video popover, not a second input panel.
Keep PromptInput, references, templates, history, and session rail mounted.
Keep image/video drafts intact while switching types. Agent model selection is scoped to
its linked Playground session and validated against live chat capabilities; no fabricated IDs.
Hide generation parameters in Agent mode. Use the existing submit action for chat.
References must become actual image content after owner verification, not names alone.
Reject unsupported media rather than silently dropping it. Existing saved chat sessions remain readable.
Verify type selection, hidden parameters, unchanged templates/history and multi-turn image context.

## Shared timeline

Chat messages load independently of model catalog and active composer type. Chat and
media merge by persisted timestamps. Legacy undated chat retains source order before
dated entries. Each new message stores model, timestamp and references. Assistant
references are display/restore metadata only, not assistant multimodal API content.
Delete uses an owner-scoped API, rejects deletion during a pending turn, and persists.
Copy and restore reuse the existing prompt and reference state.

## Multimodal attachments

Local UniArt production-v277 DTO openai_request.go defines image_url,
video_url (string), input_audio ({data,format}) and text. Agent emits these
blocks for owner-validated files; model-channel support is NOT established by
DTO presence. Images/videos use managed URLs; MP3/WAV bytes are encoded only
on the backend and never persisted in history or returned to the browser.
UTF-8 txt/md/csv/json/srt/vtt attachments become text. Limits: video 100 MB,
audio 10 MB, text 256 KB per file. Other document/audio formats remain unsupported.
Actual video/audio support on each of the four model channels needs runtime tests.
