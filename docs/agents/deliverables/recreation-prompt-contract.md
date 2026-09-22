# Recreation prompt contract

Observed: the reference plan used prose instead of Ref2VA sections, hardcoded silence, and compiled H3 labels even on its Seedance branch. The verified H3 recreation path now persists and submits per-shot provider tasks; Seedance and AI polish remain out of scope.

Changes: consume the same catalog source used by storyboard commit 6a3b79e; record instructions/package IDs/hash in the plan for later polishing. Build H3's six sections and reuse check_h3_prompt for media bounds, silence and single-shot structure. Explicit per-shot generated durations follow the current repository catalog (4-15 integer seconds), separate from rational assembly targets. Generated sound requires user requirements. Preserve-source audio is blocked until assembly exists. Unverified models including Seedance are rejected rather than mislabeled as ready.

Boundary: the catalog snapshot is not evidence of LLM skill execution. No vision inspection, AI polishing, or visual fidelity is implemented/claimed here. Native validation occurs at preflight; provider submission reuses the immutable task snapshot. The existing checker is a repository contract, not proof of provider acceptance. Model controls and audio settings are transient planning inputs.

Verification: focused recreation service/native contract tests: 40 passed, 1 skipped. Related recreation UI tests: 16 passed. Frontend typecheck passed. Storyboard skill tests are on the separate 6a3b79e branch and were not executed here. Review and deployment via administrator PR.
