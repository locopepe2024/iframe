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
