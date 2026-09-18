# Recreation prompt contract

Observed: the reference plan used prose instead of Ref2VA sections, hardcoded silence, and compiled H3 labels even on its Seedance branch. No recreation provider submit or AI polish endpoint exists.

Changes: consume the same catalog source used by storyboard commit 6a3b79e; record instructions/package IDs/hash in the plan for later polishing. Build H3's six sections and reuse check_h3_prompt for media bounds, silence and single-shot structure. Explicit per-shot generated durations follow the current repository catalog (4-15 integer seconds), separate from rational assembly targets. Generated sound requires user requirements. Preserve-source audio is blocked until assembly exists. Unverified models including Seedance are rejected rather than mislabeled as ready.

Boundary: the catalog snapshot is not evidence of LLM skill execution. No vision inspection, AI polishing, paid submission, source-audio assembly or visual fidelity is implemented/claimed here. Native validation currently occurs at preflight; future submission must revalidate the same immutable manifest. The existing checker is a repository contract, not proof of provider acceptance. Model controls and audio settings are transient planning inputs.

Verification: recreation service, native contract and H3 checker: 40 passed, 1 skipped. Related UI tests: 10 passed. Typecheck and production build passed. Storyboard skill tests are on the separate 6a3b79e branch and were not executed here. Review and deployment via administrator PR.
