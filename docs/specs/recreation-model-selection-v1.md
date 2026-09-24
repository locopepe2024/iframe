# Recreation model selection v1

## Observed

- The recreation video plan and submit path use `uniart/minimax-h3-vip` at the
  UI and API defaults.
- Corrected keyframe tasks persist and submit `uniart/gpt-image-2.5`, while the
  repository catalog contains `uniart/gpt-image-2` and not the bare 2.5 ID.
- UniArt exposes an owner-scoped `/config/uniart/models` catalog with normalized
  capability fields (`i2i` for image editing and `r2v` for reference video).

## Direct implication

The corrected-keyframe failure can be prevented by selecting an image model
from the current owner catalog and persisting that ID on the task. The video
path can expose a model control without accepting a model whose recreation
prompt contract has not been verified.

## Scope and boundaries

- Add owner-scoped model options for the recreation page.
- Default corrected keyframes to the catalog-backed `uniart/gpt-image-2`.
- Persist a requested image model on every keyframe task and pass it unchanged
  to the UniArt image adapter.
- Persist the selected video model on every generation task (already present),
  and make plan/submit use the selected value.
- Validate image models for `i2i` capability before a paid task is created.
- Keep the only verified recreation video contract as
  `uniart/minimax-h3-vip`; reject Seedance and other unverified contracts with
  422 until their prompt mapping is separately verified.
- Do not publish or mutate UniArt route/candidate configuration from iFrame.

## Success criteria

1. A corrected-keyframe task defaults to `uniart/gpt-image-2` and never emits
   the obsolete bare `gpt-image-2.5` ID.
2. A caller can choose a current `i2i` model; the task record, worker kwargs,
   and media metadata carry the same model ID.
3. An unknown/non-`i2i` model is rejected before a paid task is persisted.
4. A caller can choose the verified recreation video model through the UI/API;
   unverified video contracts remain rejected.
5. Frontend, backend, catalog, and targeted regression tests pass without a
   paid provider request.

## Verification commands

```bash
pytest -q tests/test_recreation.py tests/test_uniart_catalog.py
cd frontend && npm run typecheck && npm run test -- --run src/components/modules/recreation/ShotReferences.test.tsx
```
