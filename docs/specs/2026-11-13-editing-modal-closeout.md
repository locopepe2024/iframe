# Editing modal interaction closeout

Finish the remaining F3 modal behavior using the existing native
`EditingProjectDialog`: navigation confirmation, voiceover and transcription
must move focus into the dialog, keep keyboard focus inside the modal, and
restore focus to a connected trigger when closed. Preserve existing labels,
manual-save semantics, draft state and each dialog's width.

Escape or backdrop dismissal closes an idle dialog. Voiceover generation and
transcription keep their dialogs open while requests are running. Dismissing
the navigation confirmation means Stay, including while an unrelated save is
running; it must not cancel the save. The voice picker remains usable inside
the voiceover modal; Escape closes the picker before its parent.

Verify initial focus, native cancel events, focus return, draft preservation,
busy-state dismissal, and existing editing tests. Native focus containment and
desktop/narrow-screen interaction require browser acceptance separately from
component tests. No external URL import, provider-key changes or paid TTS calls
are part of this slice.
