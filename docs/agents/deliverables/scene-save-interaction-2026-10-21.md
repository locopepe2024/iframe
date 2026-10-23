# Scene save interaction parity

Match character design: source-specific save/use actions, saved-source status, and restore-last-successful-save. Both authored and AI editors persist independently. An empty active source cannot be saved; saving/AI submission disables conflicting actions. Reopening selects the last saved source. Restoring returns to the authored design tab while restoring both saved source editors, settings, modes and references.

Persist optional `active_source` in the scene prompt workspace. Confirmed revisions expose the selected prompt as visual notes while keeping editor workspace out of downstream revisions. Legacy designs without this field keep their existing confirmed notes. Reject empty explicitly selected sources before mutation. No automatic AI call, generation, or source overwrite on save.

Verify UI save/restore, failures, source-specific confirmation and reload; targeted scene persistence/snapshot tests, typecheck and production build. Browser and paid-generation acceptance remain separate from code tests.

Verification: 28 scene/vault UI tests and 34 targeted backend tests passed. TypeScript typecheck and production export passed. AI submission controls live on the authored scene design tab; a successful result opens AI optimization. No browser or paid generation verification performed.
