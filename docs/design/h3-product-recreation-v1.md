# H3 product recreation v1

Scope: Chat writes a reference-generation prompt from a source video, replacement product images, and optional replacement spoken names. It does not modify source pixels or splice audio. Model/SKU contracts and execution remain unchanged.

Evidence: official H3 ref-en at d21241f0a4b3acbb34c97dae47fa417b7065e438 distinguishes reference generation from video editing and audio reference from signal reuse. Existing LumenX skills are owner-scoped instruction snapshots; installing FFmpeg on media does not expose an execution tool to Chat.

Implementation: add a self-contained h3-product-recreation package to config/agent_skills/catalog.json; use the existing install/enable/update endpoints and Settings UI. Include it for H3 or model-unspecified requests; its precise trigger excludes unrelated tasks. Explicit Seedance requests exclude all H3 skills. Existing users' installations are not silently changed.

Success criteria: new package installs alone and with the H3 director within guidance budget; enabled instructions reach Chat, disabled/uninstalled and foreign-owner instructions do not; explicit model switching excludes this skill. Behavioral evaluation must distinguish source analysis from unavailable media and reference-generated audio from exact copied audio.

Paths: config/agent_skills/h3-product-recreation/SKILL.md, catalog.json, src/apps/agent_skills.py, tests/test_agent_skills.py. Verification: skill-creator quick_validate, pytest tests/test_agent_skills.py tests/test_agent_chat.py; review evaluation cases for video + product image, silent video, unavailable audio, multiple products and shape/action mismatch. Passing mocked delivery tests does not establish generated video quality.

Rollout: curated catalog entry, explicit per-user installation. Media-host FFmpeg preprocessing/transcription integration is deferred; do not claim automatic extraction or ASR in this release.
