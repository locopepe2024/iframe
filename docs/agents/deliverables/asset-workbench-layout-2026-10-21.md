# Asset workbench layout

## Scope

Unify character, scene, prop and scene lighting/camera workspaces: parameters and editable prompts on the left; main image, variants and visual previews on the right. Template/catalog expansion is deferred until this layout is established.

## Observed

Character uses reversed flex order: its preview precedes controls in DOM and narrow layouts. Scene/prop put the preview on the left and controls on the right. Scene tools render another pair of columns inside the preview half, compressing the controls and image.

## Contract

- A shared layout owns column sizing and scrolling, with controls first in DOM and preview second. Wide screens use a bounded control column and flexible preview; narrow screens stack controls then preview with one reachable scroll flow.
- Scene/prop asset name and image/video/light/camera navigation span the workbench. Scene tools fill the workbench rather than nesting inside half a screen.
- Preserve prompt sources, reference bindings, task submission/review, variant selection, generation progress and tool behavior. No persisted schema changes or new prompts in this slice.
- Preserve the character dictionary overlay in the preview workspace.
- No CSS reversal that makes keyboard and visual ordering disagree.

## Verification

Existing character, scene, tool and review behavior suites; frontend typecheck; production build. Inspect controls-before-preview DOM order for all workbench types. Browser checks require separate explicit authorization; automated UI tests do not prove pixel layout on devices.

95 existing UI checks passed (character 63, asset workbench 27, scene tools 5). TypeScript typecheck passed. No browser automation or paid generation used.
