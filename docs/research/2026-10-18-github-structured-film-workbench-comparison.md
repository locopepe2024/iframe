# GitHub 影视工作台结构化设计对比

Date: 2026-10-18. Scope: public source at pinned commits; repository descriptions and design prose are not proof of production behavior.

## Observed

| Project | Verified source | Code fact | Useful boundary for iFrame |
| --- | --- | --- | --- |
| [OpenMovie](https://github.com/OpenMovieLabs/OpenMovie/tree/d0cb366e347bd4118de1551c6224c6ba74f7d7f7) | [Movie IR schema](https://github.com/OpenMovieLabs/OpenMovie/blob/d0cb366e347bd4118de1551c6224c6ba74f7d7f7/packages/movie-ir/src/schema.ts), [revision store](https://github.com/OpenMovieLabs/OpenMovie/blob/d0cb366e347bd4118de1551c6224c6ba74f7d7f7/packages/project-store/src/revision.ts), [production workflow](https://github.com/OpenMovieLabs/OpenMovie/blob/d0cb366e347bd4118de1551c6224c6ba74f7d7f7/docs/PRODUCTION_WORKFLOW.md) | Character, prop, scene, and shot have distinct validated schemas and entity revisions. Scene setting includes time, weather, spatial layout and practical lights; shot includes camera, lighting, composition, generation references and prompt bundle. Revision commits check `expectedRevisionId` and validate edited files. | Keep object schemas and task output separate; retain source revisions, typed references and conflict checks. Scene baseline and shot overrides need distinct owners. |
| [PromptKit](https://github.com/microsoft/PromptKit/tree/074dc8dc51e08f0f9890c652a9d0b17584f7ef41) | [architecture](https://github.com/microsoft/PromptKit/blob/074dc8dc51e08f0f9890c652a9d0b17584f7ef41/docs/architecture.md) | Its documented template declares persona, protocols, output format, task parameters, and input/output artifact contracts. The CLI assembly path currently omits automatic taxonomy injection; the document identifies that gap. | Separate skill/method, task template, output schema and compiler. Catalog membership alone does not prove an input was projected. |
| [AI Movie Studio](https://github.com/869413421/ai-moive-studio/tree/4e0810eab1d84ed1424883b88f6b4cd232b74724) | [movie models](https://github.com/869413421/ai-moive-studio/blob/4e0810eab1d84ed1424883b88f6b4cd232b74724/backend/src/models/movie.py), [scene generation](https://github.com/869413421/ai-moive-studio/blob/4e0810eab1d84ed1424883b88f6b4cd232b74724/backend/src/services/scene_image_service.py), [shot extraction](https://github.com/869413421/ai-moive-studio/blob/4e0810eab1d84ed1424883b88f6b4cd232b74724/backend/src/services/storyboard_service.py) | Scene and shot models primarily retain descriptions, prompt text and generated URLs. Scene image generation can build a prompt from shot descriptions; shot extraction calls an LLM with scene text and project character names. Generation history stores prompt, model, result URL and selected flag. | This gives a concrete prompt-centric comparison. iFrame should keep scene visual baseline and selected media identities explicit rather than infer all continuity from shot prose. |

## Direct implication for iFrame V1

1. The four object schemas are the confirmed design record. A task template names the requested output and its input slots; a skill guides LLM drafting. They should not become three competing owners of character or scene facts.
2. Scene master and scene coverage can use iFrame's lighting and camera controls: spatial landmarks and lighting baseline belong to the scene design revision; angle-specific camera/composition belongs to the generated variant or current shot. A camera experiment does not mutate the baseline until the user explicitly applies it.
3. Binding a reference is a user action. The task records selected `{asset_type, asset_id, variant_id}` values, then compiles a visible prompt and media list. Descriptive source-template input labels do not authorize automatic attachment or prove provider capability.
4. A submitted take should record template revision, design revisions, selected media IDs, reviewed prompt and provider mode. The current design revision changing after review should invalidate the pending submission.

## Not yet proven

- OpenMovie's production workflow document describes many gates; the files inspected here verify its schemas and revision conflict check, not that every described generation gate runs in a deployed release.
- PromptKit's architecture documents prompt composition. It does not establish iFrame-compatible media identity or image/video request validation.
- AI Movie Studio's inspected paths do not establish its entire project behavior; they only show these scene/shot persistence and generation paths.

## Hypothesis and verification

Hypothesis: combining OpenMovie-like object revisions with PromptKit-like task/output contracts will reduce prompt drift across scene and shot tasks. Verify in iFrame with two scene images from one baseline and two shot angles: compare reviewed and submitted prompt/media fingerprints, confirm consistent landmarks/light direction, and confirm that changing the scene baseline neither silently changes an existing shot nor attaches a new image reference.
