# NSFW instance: New API node and pricing models

Status: implementation preparation. Date: 2026-10-12.

## Observed

- The NSFW iFrame instance runs GitHub `main` at `12160b32` in `/srv/iframe-nsfw/repo`.
- `GET https://srv2021949.hstgr.cloud/api/pricing` lists five enabled models: `seedream_5.0Pro_nsfw`, `sd_2.5_special`, `wan3.0`, `wan3.0-Prime`, and `deepseek-v4-flash`.
- The New API database has one enabled OpenAI-type channel advertising these five models. The `task_plugins` and `models` tables have no rows. The pricing response advertises `/v1/chat/completions`; `/v1/models` requires a token.
- iFrame's image adapter uses `/v1/images/generations` or `/v1/images/edits`, its video adapter uses `/v1/videos`, and its text adapter uses OpenAI-compatible chat. The current owner credential path defaults to `https://uniart.fun/v1` even when `UNIART_BASE_URL` is set.
- The NSFW iFrame deployment has no New API token. The existing site is reached over HTTP by IP, so browser entry of a secret would cross an unencrypted connection.
- Generated assets and uploaded material live on the NSFW host in `/srv/iframe-nsfw/output`, bind-mounted as `/app/output`. COS is not available for this deployment.

## Direct implications

- The node origin for OpenAI-compatible clients is `https://srv2021949.hstgr.cloud/v1`, not the `/pricing` page URL.
- Changing only the container environment would leave users with a saved personal key on the old node. The owner-scoped default and UI display need to honor the deployment URL.
- Listing a model on `/pricing` or in a channel does not establish the image/video request and polling contracts. Those routes must be checked before they are presented as working iFrame generation choices.

## Not yet proven

- Whether the four media models accept iFrame's existing image/video payloads, and which result/polling format they return.
- Whether New API's `/v1/models` includes media capability metadata or only model IDs.
- Which New API account and token the iFrame deployment should use.
- Whether the upstream model fetcher accepts short-lived HTTP media URLs from the NSFW host.

## Intended slices

1. Set the NSFW deployment's default node to `https://srv2021949.hstgr.cloud/v1`; make owner-scoped credentials and the settings UI show that default. Allow `deepseek-v4-flash` in the chat selector only when the authenticated node catalog contains it.
2. Deliver references through short-lived signed URLs backed by the NSFW host's `output/users/` files, and download generated results into the same mounted output tree. Do not configure COS.
3. Validate each media model's actual endpoint and parameters using a scoped token and non-billable requests or a controlled test. Add catalog entries and any required adapter changes only for verified contracts. Keep unsupported models out of generation selectors.
4. Build and validate the catalog, run focused backend/frontend tests and a production build, then release to the NSFW instance and verify its public APIs and node routing. Preserve the current container images for rollback.

## Boundaries and success criteria

- Source changes are isolated in this worktree. Production-only secrets remain under `/srv/iframe-nsfw/runtime.env` with mode `0600`; neither keys nor database credentials enter the repository or test output.
- A model shown as selectable must route to the declared endpoint with supported parameters. Text, image, and video capabilities are assessed separately.
- The public iFrame page and `/health` remain available, and `https://srv2021949.hstgr.cloud/` continues to serve New API after deployment.
- Verification commands include `python scripts/build_model_catalog.py`, `python scripts/validate_model_catalog.py`, focused `pytest`, frontend typecheck/tests/build when frontend changes, and HTTP smoke checks against the NSFW instance.

## Source handling

The New API `/api/pricing` response on 2026-10-12 and the deployed New API source/database are the current local evidence. This repository contains only a staged account of that evidence; no raw vendor archive or Context Hub promotion is claimed.
