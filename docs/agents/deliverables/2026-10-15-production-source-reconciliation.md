# Production source reconciliation — 2026-10-15

## Verified source facts

Compared SHA-256 contents for 724 candidate code/config/test files from the union of the local production-compatible tree and main. Scope: `src/`, `frontend/src/`, `frontend/messages/`, `tests/`, `config/`, `scripts/`, `docker/`, root Dockerfiles and selected build/dependency manifests. Excludes credentials, generated media, runtime databases, dependencies, Git internals and docs. Missing files are represented as absent, not as empty content.

- Local production-compatible tree: `iframe-nsfw-node`, branch `feature/nsfw-new-api-models`, HEAD `b4a037c1` plus uncommitted changes. The old HEAD alone does not identify its effective source.
- Remote build context: malysis `/srv/iframe-nsfw/source`.
- Main reference: `41953a0eace482ea78b10d7c48f2b76ff31c928b` (PR #115 merged).
- All 724 compared paths have identical local and remote presence/content.
- 612 paths also match main; 101 paths differ between production and main; 11 main files are absent from production.
- The 101 differing paths include both deployed edits and upstream/main changes missing in the older deployment. A file-level mismatch does not establish which side should replace the other.

## Runtime observations and limits

Both backend and frontend containers were running at audit time. Image content IDs:

- Backend: `sha256:cf182769f20ed06c0bd5fb25586ac313dfd5d977af8c6bc7ab6116d45197986c`
- Frontend: `sha256:b5a3dfef0b45c02a057aa694e91bb455107bc8217f7ee266185e9a6500ffdb62`

The comparison verifies source in the build context, not every file inside these images or runtime behavior for all paths. Current image tags are reused and do not identify a Git revision. Previous assembly checks established source/reference consistency and audio on the affected production project; they are not evidence for every historical preview/download/polish flow.

## Review and cutover sequence

1. Port source-audio preservation as an independent fix with real FFmpeg reproduction and gain/trim/silence verification. Existing production already contains the base fix. Submit PR for administrator review; do not auto-merge or replace production.
2. Reconcile owned-media previews/downloads and stale reference refresh as one bounded slice. Review routing and ownership together; reproduce the exact Playground Failed to fetch operation before claiming it fixed.
3. Reconcile shot prompt/style/lighting persistence and uploaded-asset reference selection with their regression tests. Keep the paused bilingual-polish output problem separate.
4. Reconcile provider adapters, catalog and LLM routing against already-merged independent profiles/GreenA naming. Preserve existing model IDs, owner identity and active-task polling. Then add the provider settings/catalog UI and task configuration snapshots; deploy after integration validation.
5. Complete local media-root/locator and Local/COS/OSS configuration. Separately introduce commit/image-pinned deployment manifests and build identity/rollback verification.

Assembly timeline interaction work remains a later feature, not part of source reconciliation. Unrelated knowledge/finance/agent changes visible in the diff require their own owner review and must not be copied over as part of this repair.

Latest authorization: Codex may prepare and push PRs. Administrator reviews and merges to main. Do not merge PRs directly. Keep credentials, output and user databases outside Git.

## Main files not yet present in production

| Path | Action |
| --- | --- |
| `config/research_skills/company-finance/SKILL.md` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `frontend/src/components/modules/RenderPromptPreviewDialog.tsx` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `scripts/verify_finance_owner_api.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `src/models/greena.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `src/utils/provider_catalog.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `tests/fixtures/finance_sec_aapl_2025_10k_source.json` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `tests/test_greena_provider_name.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `tests/test_provider_catalog.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `tests/test_provider_profiles.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `tests/test_storyboard_render_preview_api.py` | Integrate only with its owning feature; do not copy individually without dependencies. |
| `tests/test_verify_finance_owner_api.py` | Integrate only with its owning feature; do not copy individually without dependencies. |

## Differing production/main files

Hashes below are abbreviated SHA-256 values to locate the audited content. These are file-content identifiers, not deployed commit identifiers. Resolve changes per hunk; do not overwrite entire files.

| Path | Local = remote | Main |
| --- | --- | --- |
| `config/agent_skills/character-identity-design.md` | 60bc19dedff6 | 39ea7c754b8b |
| `frontend/messages/en.json` | 9e6c868a554f | afbc992b1dae |
| `frontend/messages/zh.json` | 65882fcdae59 | 971a0f7c6fe2 |
| `frontend/src/__tests__/directorShotPromptRouting.test.ts` | db9bbcc415ff | 46693b3cb280 |
| `frontend/src/__tests__/studio-editor-media.test.ts` | 35bcffa2e776 | absent |
| `frontend/src/components/modules/CharacterWorkbench.tsx` | e3d6438b3447 | 9f8173e8589a |
| `frontend/src/components/modules/ConsistencyVault.test.tsx` | b6c6e1e7b8ab | 2ac7c4002cb8 |
| `frontend/src/components/modules/ConsistencyVault.tsx` | 5ef18bd66454 | fb05162ef594 |
| `frontend/src/components/modules/StoryboardComposer.tsx` | 815a0b8ad6d5 | 1aad08599e6a |
| `frontend/src/components/modules/StoryboardFrameEditor.tsx` | 3d634f0e0027 | 21dad7ea5b09 |
| `frontend/src/components/modules/StoryboardR2V.tsx` | 6e521901c12d | c31414d06aa3 |
| `frontend/src/components/modules/VideoCreator.tsx` | 1b4c4afac71a | 3ac7ddc923c3 |
| `frontend/src/components/modules/assemblyEditPlan.test.tsx` | 3d49fd606821 | 393de4c56632 |
| `frontend/src/components/modules/assemblyEditPlan.ts` | 0cab24612b70 | 3b21d908c4f8 |
| `frontend/src/components/modules/playground/ResultCard.tsx` | 061628a91bee | 80a1100a2ead |
| `frontend/src/components/modules/playground/SessionTimeline.test.tsx` | 12e997389f49 | ceffa9e2123b |
| `frontend/src/components/modules/playground/SessionTimeline.tsx` | c7ca65c00eda | 4d40d44ab029 |
| `frontend/src/components/modules/playground/playgroundModels.ts` | a827c6e2cd5c | 65df480cc7b1 |
| `frontend/src/components/modules/playground/reeditGeneration.ts` | 0d0351aaa753 | absent |
| `frontend/src/components/modules/playground/referenceMedia.ts` | dbdc427f0d48 | 7a79f343eb29 |
| `frontend/src/components/modules/playground/useAgentConversation.test.tsx` | 4bad8318a89f | 9e49fd094bdb |
| `frontend/src/components/modules/playground/useAgentConversation.ts` | 65df44fa0b90 | 3774b6ae9e69 |
| `frontend/src/components/modules/storyboard-r2v/AssetChipBar.tsx` | efa7df3b8c09 | e0587d43c0b8 |
| `frontend/src/components/modules/storyboard-r2v/AssetDrawer.test.tsx` | ec9b3e9300bd | 710aa147bcb3 |
| `frontend/src/components/modules/storyboard-r2v/AssetDrawer.tsx` | 2940d3d567bd | aabea19c71b0 |
| `frontend/src/components/modules/storyboard-r2v/OptimizerSelector.test.tsx` | 829572500e5a | absent |
| `frontend/src/components/modules/storyboard-r2v/OptimizerSelector.tsx` | 9405df9e8087 | dd3ba21de651 |
| `frontend/src/components/modules/storyboard-r2v/PolishPanel.test.tsx` | 64ee50ac54c3 | 7b018f5a28d4 |
| `frontend/src/components/modules/storyboard-r2v/PolishPanel.tsx` | a3e792a9b56c | 8be0e2ecc0da |
| `frontend/src/components/modules/storyboard-r2v/ShotCard.polish.test.tsx` | b582738d6d00 | 5b52c3b3e2d6 |
| `frontend/src/components/modules/storyboard-r2v/ShotCard.tsx` | f489aa81d809 | 28e76ffde97f |
| `frontend/src/components/modules/storyboard-r2v/buildAssembledPrompt.test.tsx` | 4b68dc59ab05 | e9a698e5e4a1 |
| `frontend/src/components/modules/storyboard-r2v/buildAssembledPrompt.ts` | 7990d56fc3ac | 6d5f5bca1983 |
| `frontend/src/components/modules/storyboard-r2v/referenceAssets.test.tsx` | 4fdd62a7ee78 | 03f14013ff28 |
| `frontend/src/components/modules/storyboard-r2v/referenceAssets.ts` | 2669dcbfa696 | 600239e1029a |
| `frontend/src/components/modules/storyboard-r2v/shotNodeHelpers.test.tsx` | b4342549bb7c | absent |
| `frontend/src/components/modules/storyboard-r2v/shotNodeHelpers.ts` | 09131181501a | 7c7d1755bc65 |
| `frontend/src/components/project/PromptConfigModal.tsx` | 36479b27fba6 | 8c8ed47f5ac0 |
| `frontend/src/components/shared/AssetIndexPreview.tsx` | 5f771cf88b0a | 83bc35a6f154 |
| `frontend/src/components/shared/PolishModelSelect.test.tsx` | c529f854c44c | absent |
| `frontend/src/components/shared/PolishModelSelect.tsx` | ab8f7d7de6e0 | a11617094e5e |
| `frontend/src/components/shared/preview/PreviewVideo.tsx` | c2c04e1b74b3 | 723738d296fd |
| `frontend/src/lib/api.ts` | 752048c308f8 | a5d663c5311d |
| `frontend/src/lib/modelCatalog.ts` | 105e38bcc49d | 6d5942fd7c9b |
| `frontend/src/lib/storyboardStyle.ts` | 9c895a03a4d7 | 04a27b7d4e15 |
| `frontend/src/lib/utils.ts` | 9e6e89e636ca | 65e8879080a8 |
| `requirements.txt` | a1639bc32920 | 07c74965839d |
| `src/apps/agent_api.py` | e2951bdf1d5c | a5e9924c07e6 |
| `src/apps/comic_gen/api.py` | 85366ce98c72 | 620df8ae2806 |
| `src/apps/comic_gen/assets.py` | 26650cd1864e | 14577e7858a3 |
| `src/apps/comic_gen/llm.py` | 6436555ba53e | ac1d437e9fdc |
| `src/apps/comic_gen/llm_adapter.py` | 8c6326d671fc | 7548efa07ae9 |
| `src/apps/comic_gen/models.py` | 0e9734ebdd80 | 36daf3834c21 |
| `src/apps/comic_gen/pipeline.py` | 5a20a71705e8 | 9a09d02f84bc |
| `src/apps/comic_gen/prompt_assembly.py` | af2c42055f7c | 096708b61100 |
| `src/apps/comic_gen/storyboard.py` | de29c8d7f923 | 41df8369c949 |
| `src/apps/comic_gen/test_polish_model_catalog_endpoint.py` | 5367a5af2839 | absent |
| `src/apps/comic_gen/test_studio_reference_resolution.py` | 5a0472ee1082 | absent |
| `src/apps/knowledge/api.py` | ff7b47bb7c08 | 06b95578e3ce |
| `src/apps/knowledge/capture.py` | 3dc8d6f8c94a | 605789a988d6 |
| `src/apps/knowledge/discovery.py` | 797820a464cf | f833d356190b |
| `src/apps/knowledge/store.py` | f066b23c04f2 | 6371fa7932db |
| `src/apps/knowledge/worker.py` | d1d9b193af96 | 0dcf6196b23b |
| `src/apps/playground/api.py` | 954938877b6e | 3ab770461b14 |
| `src/apps/playground/models.py` | 4f4c4014a8a1 | aeaaa636be57 |
| `src/apps/playground/service.py` | 590252794447 | d82fb54d49a2 |
| `src/apps/studio_access.py` | 84664bccd15e | 5505b67f50b0 |
| `src/apps/test_nsfw_llm_catalog.py` | fbada75dc0ab | 4d5c0390d037 |
| `src/apps/user_config.py` | 83a051e9a092 | 14d1b52c9d4e |
| `src/models/nsfw_new_one.py` | bae3019ce44d | 7ede42b67c9d |
| `src/models/uniart.py` | a14672ac7916 | 0529392c80ab |
| `src/utils/llm_request_diagnostics.py` | 44e6350ff6f6 | absent |
| `src/utils/media_thumbnails.py` | f0f00b3d8e38 | 59e733aa9919 |
| `src/utils/nsfw_llm_catalog.py` | 0d4589cffa07 | absent |
| `src/utils/test_nsfw_llm_catalog.py` | 8160f50a569c | absent |
| `src/utils/uniart_catalog.py` | 0b857b29bf47 | 2d323bbf58a1 |
| `tests/test_agent_chat.py` | c4b42c6f97d2 | 1e97b21a6482 |
| `tests/test_agent_skills.py` | 04d40eb2ba2a | a09a13677fcc |
| `tests/test_assembly_render_compiler.py` | b2cb89a1fe9e | 7b6b2dc41fb6 |
| `tests/test_asset_prompt_binding.py` | f9f8dccc6cb2 | 072f2924aa9a |
| `tests/test_director_shooting_plan.py` | 952ea0148ffb | 5ab0c997bf49 |
| `tests/test_knowledge_research.py` | d75df7948948 | b1de681d826b |
| `tests/test_knowledge_research_postgres.py` | d02d6c5aa51b | fe02f43ad092 |
| `tests/test_llm_adapter_user_config.py` | 288eca34bca5 | 3dfa1fbce00f |
| `tests/test_llm_request_diagnostics.py` | eaae85ba459e | absent |
| `tests/test_multi_user_boundary.py` | 6c45cc007536 | a9e171a0f85e |
| `tests/test_nsfw_new_one_image.py` | 5b0d1a38acdc | 70e92f164535 |
| `tests/test_nsfw_new_one_video.py` | e8dff656d3e2 | 62ab400c7a43 |
| `tests/test_owned_studio_media.py` | 938b4676af85 | a4abd1fa6213 |
| `tests/test_playground_nsfw_image_recovery.py` | 8d39c66a2de3 | absent |
| `tests/test_playground_preview_refresh.py` | f246fbb5ab4f | 615bde687101 |
| `tests/test_polish_error.py` | 312d38dc0264 | eb044af10326 |
| `tests/test_polish_reference_diagnostics.py` | 1a07ae9f7060 | absent |
| `tests/test_series.py` | e6bd1e835392 | 59b903a1206d |
| `tests/test_storyboard_analysis_jobs.py` | 28f02745a75a | 714498bb6000 |
| `tests/test_storyboard_model_routing.py` | 45576eb3d063 | 9a8cd3c06a46 |
| `tests/test_storyboard_skill_contract.py` | 7c93f9b34693 | 3f6ae7f4afca |
| `tests/test_studio_editor_previews.py` | 9c578951a243 | absent |
| `tests/test_uniart_image_controls.py` | 00bcd9ca85fe | c28cd245199e |
| `tests/test_uniart_polling.py` | 44f6e98f1875 | 855c235e2065 |
| `tests/test_video_task_recovery.py` | 7d22158370b2 | 042325e118ad |
