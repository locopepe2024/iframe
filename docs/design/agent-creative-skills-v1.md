# Creative Skills v1

## Scope and evidence

GitHub research on 2026-09-16 found:

| Source | License | Evidence and decision |
| --- | --- | --- |
| https://github.com/LeoYeAI/seedance-skills | MIT | Reviewed camera, style, prompt-short, sequence SKILL.md and directing-engine.md. Adapt into four self-contained creative instruction packs. Pin 797e16efaa3c5ac01c0e391d0b8466a87cc5aadc. |
| https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director | Apache-2.0 | Reviewed README at 5a8e380b86ccbff20d29edae8e32037348adf47d. This is a ComfyUI plugin, not an Agent Skill. Adapt only shared direction, per-clip planning, reference roles and continuity into an explicitly labeled LumenX adaptation. Do not import sampler/code/API rules. |
| https://github.com/MiniMax-AI/skills | MIT | At 60aaae52bb2af8162732751a4332f62a5fef518b, video guide and toolkit name Hailuo 2.3/02, not H3. Retain as research; do not label old camera command syntax as verified H3 guidance. |
| https://github.com/runapi-ai/hailuo | Apache-2.0 | SKILL.md is a RunAPI CLI/SDK recipe, not director or prompt guidance. Excluded from creative catalog. |
| https://github.com/timkoda/seedance-skill | No license returned by GitHub | Six-layer prompting candidate; not copied into catalog pending license clarification. |

Source existence does not prove model output quality. Current scope verifies installation and instruction delivery, not generated video fidelity or every model-version-specific capability.

## Architecture and boundaries

- Curated, versioned instruction packages in config/agent_skills/catalog.json with attribution and license files. These are LumenX adaptations, not verbatim upstream packages; no unresolved external reference dependencies.
- Settings > Skills > Get Skill opens a searchable catalog. Preview instructions and provenance, install/update explicitly, enable/disable, uninstall. No automatic installation for all users.
- Authenticated /agent/skills endpoints persist installed package snapshots in the existing agent SQLite database, keyed by owner_profile_id and skill id. No arbitrary repository URLs, downloads or scripts execute during installation.
- Agent includes enabled snapshots as bounded creative guidance in its existing system message. Scope applies only when relevant; current user request has priority. No tool permissions, routing, SKU capability or quality adaptation changes.
- Skills have no execution capability and cannot claim to generate media. H3-specific provider syntax remains outside scope.
- Unknown ids, outdated catalog revision and attempts to enable an uninstalled skill are explicit errors. Installation is idempotent and update preserves enable state. Total active guidance budget is 16000 characters; enabling beyond budget is rejected rather than silently omitting skills.

## Verification and release

- Tests: owner isolation, install/update/disable/remove persistence, bad revision/id, actual enabled guidance passed to completion, disabled guidance absent, catalog provenance/license presence, frontend install/enable/remove and failures.
- Commands: pytest tests/test_agent_skills.py tests/test_agent_chat.py; frontend typecheck, relevant UI tests, production build.
- Deploy immutable committed backend and frontend; sync local/GitHub/server commit and verify release manifest against actual runtime files. Existing user data and credentials are preserved. Browser MCP verification requires separate active-scope approval under workspace rules.
