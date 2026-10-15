# Agent material intent gate

Observed: the Agent hook submits every selected Playground reference, even when
its input contains no `@`. The server unconditionally attaches current-turn media.
Historical media already requires an explicit named reference in the current input.

Contract: when current message content contains no `@`, submit and persist empty
`input_media` and `asset_names`. Enforce this in the frontend and at the server entry
before material validation, reference resolution, research gates, or H3 dispatch.
Keep selected Playground references available for subsequent edits; do not clear
or rewrite the user's draft text. Retain existing attachment order and numeric/name
binding when `@` is present. Per-reference selection within an `@` turn is outside
this slice; do not renumber existing `@2` bindings by filtering its candidate list.

Verify no-mention sends with selected/missing/duplicate media, historical references,
H3 requests, and frontend state retention. Verify existing explicit name/numeric
reference behavior. No provider calls, main deployment, or DNS changes in this PR.
