# Recreation generation plan

Scope: add explicit shot descriptions and a revision-checked, read-only generation preflight. Actual provider submission and assembly remain separate. No model parameters or routing configuration changes.

Each confirmed shot requires a corrected reference media ID and a description of composition, subject action and camera motion. A replacement image also requires explicit replacement instructions. Preflight checks source/media fingerprints, owner access and current timeline revision. It returns exact rational target durations, ordered image IDs/hashes, a single consistent Picture reference syntax and per-shot prompts. Missing inputs are blockers, not inferred from filenames or frame timestamps.

The plan is reconstructed from current durable bindings; signed URLs and user input are not used as identity. The first image is the corrected frame; the second optional image is the replacement product. Timeline lengths are assembly targets, not an assertion that H3 accepts arbitrary fractional durations. Generated prompts state silent output for this initial slice; no original-audio preservation is claimed.

UI clears a preview when the project revision changes and blocks inspection while timeline changes are unconfirmed. No paid request is issued by preflight. Tests cover missing descriptions, missing instructions, ordering, exact duration, foreign-owner/stale input checks inherited from media binding, and fingerprint changes.
