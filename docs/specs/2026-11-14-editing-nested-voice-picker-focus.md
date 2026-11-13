# Editing nested voice-picker focus closeout

The authorized production browser acceptance found that opening the voice
picker from the native voiceover dialog leaves focus on Choose voice. The next
Tab reaches the voice-name input behind the picker. The picker still uses a
`div role=dialog`, so the native parent isolates only the page, not the picker
from the rest of the voiceover form.

Use a native dialog for the existing shared voice picker. Preserve the voice
catalog, selection, preview, apply, busy/save rules, labels and visual panel.
On open, move focus inside; on close, return it to the connected trigger.
Escape/backdrop may dismiss an idle picker. While applying a selection, they
must keep it open. Stop the child cancel event from reaching a native parent;
one Escape must close only the picker and retain the voiceover draft.

Verify with failing-then-passing component coverage for initial focus, focus
return, native cancellation, parent isolation, save failure/retry and busy
dismissal. Put the direct regression in the required frontend CI gate. Then
repeat actual browser keyboard checks against the released code at desktop and
narrow widths. Browser fixtures use a new isolated identity and synthetic
media. Only the client-side initial configuration-availability response is
stubbed to avoid a required first-use key setup; actual editing upload, save,
restore and media requests remain live. Do not call paid voice preview,
synthesis, cloning or transcription providers during this acceptance.
