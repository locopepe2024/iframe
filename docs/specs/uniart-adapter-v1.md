# UniArt Adapter v1

## Evidence

- `GET https://uniart.fun/v1/models` lists `gpt-5.6-sol`, `gpt-image-2`, and Seedance models.
- `POST /v1/images/generations` accepts `model: gpt-image-2` and returns an async task object with `task_id`.
- `POST /v1/videos` accepts a Seedance model field and validates video metadata before generation.
- `GET /v1/images/{task_id}` returns image task status and `data[].url` metadata.
- `GET /v1/videos/{task_id}` returns video task status and `result_url`/`content` metadata.
- MuleRouter's generic submit/retry/poll/download shape is reusable; MuleRouter vendor paths and CLI are not.

## Decision

Add a dedicated UniArt HTTP adapter. Keep it separate from MuleRouter and use model prefixes (`uniart/`) to select it. The adapter reads `UNIART_API_KEY` and `UNIART_BASE_URL`, with deployment fallback to the existing OpenAI-compatible key/base URL where appropriate.

## Scope

- text: existing OpenAI-compatible LLM adapter
- image: `uniart/gpt-image-2` generation
- video: `uniart/seedance-2.5-vip` and compatible `uniart/seedance-*` models
- async task submit/status/result download

Image edit request shape and advanced video reference modes remain deferred until a real request is validated.

## 2026-09-15 image contract correction

Verified against deployed UniArt image `unitoken-5c9aaddd72c229964f7f3f36223018953a81aa1d`, specifically `dto/openai_image.go`, `relay/channel/openai/adaptor.go`, and `docs/openai-image-async-task-contract-v1.md` at that commit.

- Generation: POST /v1/images/generations. JSON edit: POST /v1/images/edits with `images: [HTTP(S) URL]`; mask is a URL string. Do not send local file bytes as base64 in the request.
- Local references are uploaded through managed COS/OSS and signed for provider access; upload/sign failure stops submission. Existing HTTP(S) references remain URLs.
- Mask adapter submissions request async=true. Public async responses carry task_id/id and poll GET /v1/images/{task_id}; sync responses may contain b64_json or image URLs and do not require a task ID. Provider routing, not mask presence alone, determines async behavior.
- This patch does not add a mask drawing/upload UI or accept unvalidated local mask paths from Playground parameters.
- Existing semantic resolution/aspect_ratio mapping remains; resolution and concrete size are mutually exclusive.
- 22 adapter regression checks passed. No paid image generation has been rerun. Nginx configuration was not changed.

## GPT Image 2.5 reference capacity

Verified deployed UniArt commit 5c9aaddd72c229964f7f3f36223018953a81aa1d, docs/atlascloud-gpt-image-2-5-edit-mask-v1.md and relay/channel/openai/adaptor.go: Flare/Sunburst expose image_capability.max_input_images=16. Preserve this value in LumenX catalog projection and consume it in the image material picker. Regression checks cover appending the sixteenth reference and disabling additions at capacity. This does not add a third image endpoint or a mask editor UI.


## GPT Image route aliases

Some UniArt GPT Image route aliases publish generic model metadata without an `image_capability` block. The stable `gpt-image-*` model prefix is an image API contract; Catalog preserves both `t2i` and `i2i` for these aliases so enabled Flare/Special/Discount SKUs remain available in the image model selector.

## 2026-09-17 Studio GPT image dimensions

Observed: Studio GPT Image 2 reference generation forwarded its legacy portrait size `576*1024` and UniArt rejected the size (HTTP 400). Project aspect is 9:16. UniArt `service/imageroute/contract.go` at previously verified deployment commit `5c9aaddd72c229964f7f3f36223018953a81aa1d` supports mutually exclusive concrete size versus resolution + aspect_ratio; its resolution tiers are 1k/2k/4k.

At the UniArt GPT image adapter boundary, legacy W*H dimensions now become a resolution tier plus reduced aspect ratio. For example 576*1024 becomes resolution=1k, aspect_ratio=9:16. Explicit WxH requests remain explicit. This preserves the selected ratio instead of changing portrait output to 2:3. Tests cover outbound payload and Studio pipeline → AssetGenerator → UniArt adapter → saved variant, using a simulated provider response.
