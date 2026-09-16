# Multimodal reference upload v2

Scope: Agent and video full-reference mode accept image, video, common audio and UTF-8 text files. Preserve uploaded originals and names. Image-only/first-last-frame modes retain their semantics.

Observed code: Agent only accepts MP3/WAV; R2V file picker hides video/audio when catalog limits are absent and never accepts text; backend media_kind rejects text and R2V requires an image even with a video reference. Upload acceptance and upstream model capability are distinct.

Protocol evidence: local UniArt source relay/common/relay_info.go NormalizeContent accepts exactly one text item plus image_url/video_url/audio_url reference parts. dto/openai_request.go has input_audio.data/format and no enabled audio_url Chat type. These are source facts, not a production model acceptance test.

Implementation: broaden the Agent and R2V upload picker, keep per-model validation upstream; normalize unsupported Chat audio containers through installed FFmpeg into MP3 without truncating duration; retain request-size guard until a verified URL Chat contract exists. Text files are read as bounded UTF-8 and appended to the single prompt text block, never uploaded as image/video URLs. Canonical image/video/audio order requires remapping both named and numeric references; text references get separate document labels and do not consume media slots.

Validation: mixed upload tests, M4A conversion with real FFmpeg, submission capture for video+image+audio+text, numeric remapping, invalid encoding, unsupported documents, reference-only video, and existing Chat/video suites. No paid media generation during automated validation. Success is correct attachments and protocol payload, not evidence every selected model can understand every modality.
