# Storyboard optimization provider and skills v1

## Observed

- Storyboard polish currently receives `target_video_model` and automatically loads all catalog guidance targeting that model.
- `polish_model` selects the underlying chat LLM; it is not a creative optimization skill.
- MiniMax IR is an official MiniMax Context-IR optimizer and already has a separate submit/poll adapter used by Agent.

## Decision

The optimization request has three independent controls:

1. `optimizer_provider`: `minimax_context_ir`, `gpt`, `qwen`, `deepseek`, or `glm` (with `local_llm` retained for older callers).
2. `optimization_skills`: explicit catalog skill ids, such as `minimax-h3-director`, `seedance-prompt`, `seedance-camera`, `sequence-continuity`, `director-style`.
3. `target_video_model`: the generation model contract (H3, Seedance, or another model).

The target model determines output contract and hard provider constraints. It does not implicitly select creative skills when `optimization_skills` is present. The old automatic mapping remains only for requests that omit the new field, to keep existing callers buildable during this cutover.

MiniMax Context-IR is an optimizer provider, not a skill. Its returned native prompt is accepted as the optimized prompt; the storyboard response maps it to both display languages until a bilingual IR contract is available. GPT/Qwen/DeepSeek/GLM use the local polish pipeline with the `minimax-h3-director` skill selected by default. Additional catalog skills remain independently composable.

## Boundaries

- This slice changes polish request routing and selection UI only.
- It does not change video generation routing.
- It does not infer action or emotion skills from prompt text.
- Skills must be installed/available in the catalog; unknown ids are rejected.

## Success criteria

- UI can choose Local LLM or MiniMax IR and one or more installed optimization skills.
- Backend receives and preserves both choices independently from target model.
- Selected skill guidance is composed deterministically and only once.
- Existing requests without `optimization_skills` retain legacy target guidance.
- MiniMax IR base three-field H3 output remains valid, including R2V polish.

## Verification

- `pytest -q tests/test_storyboard_skill_contract.py`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run test -- --run src/components/modules/storyboard-r2v/PolishPanel.test.tsx`
