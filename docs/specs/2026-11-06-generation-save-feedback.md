# Generation save feedback

Result cards previously relied on updated parent props to confirm a save; the detail panel swallowed save errors and used the first batch output's saved flag even when another output was focused. These failures were reproduced with UI tests before implementation.

A shared save hook persists the selected output, updates the latest generation state without overwriting concurrent output changes, and confirms success locally. Saved buttons are idempotently disabled; errors remain visible and retryable. This does not add an unsave toggle (the recycle bin owns reversible removal).

Validate video-card success without parent prop refresh, focused batch-output saving, server-error display/retry, and backend video/audio promotion idempotence and independent content reads. This is code and fixture validation; it does not establish the cause of any particular production save failure.
