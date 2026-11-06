# Character face prompt structure

## Observed and scope

The supplied portrait combines authored appearance, legacy white-model percentages and composition in a flat paragraph. Uncalibrated white-model saves also write six controls into identity fields, while the panel prompt assumes those fields are present and emits only the remaining controls. The reference scaffold demands unchanged facial features while requesting changed geometry. Calibrated controls already retain exact values, but have no explicit anatomical direction.

Keep saved control values, geometry, reference selection, authored prose and provider routing unchanged. Do not infer physical percentages from control values or claim image-generation adherence without generation evidence.

## Intended behavior

- Default portraits use labelled subject, reference baseline, appearance and composition paragraphs. Reference images establish identity, hair and skin; explicit anatomy adjustments override the original contour ratios.
- A single bone-adjustment block covers the measured changes. Each line defines the anatomical interval, reference baseline and measured image-editing target. The current numeric contract is defined in [face-measurement-targets](2026-11-06-face-measurement-targets.md); raw white-model controls stay in saved editor state.
- Stop synthesizing identity fields on face save. Existing exact machine-generated percentage fields are suppressed when a white-face shape exists; preserve authored features, prose and saved source data.
- Build the same default portrait scaffold in frontend and backend. Existing manually edited image prompts are not automatically rewritten.

## Validation

Reproduce supplied legacy values through the workbench and test one bone instruction per control, preservation of authored facial/skin/hair details, and save without mutating identity input. Exercise fitted/non-fitted and panel/AI prompt paths. Run component tests, math/prompt tests, backend prompt-language tests and TypeScript validation. Publish/deploy via the existing checked release workflow after validation.
