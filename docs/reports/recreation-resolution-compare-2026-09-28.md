# H3 resolution comparison attempt

Date: 2026-09-28

## Scope

Controlled comparison of the same iFrame recreation input against the same
UniArt H3 route, changing only the `resolution` request field between `720p`
and `768p`.

## Observed

- A 4.008699-second, 1394×792 source clip was registered on the deployed iframe
  host with a replacement PNG.
- Source analysis, timeline confirmation, image upload, and H3 generation-plan
  construction completed through the production recreation API.
- The first plan attempt was correctly blocked because the requested 4-second
  generation was shorter than the measured source duration and because the
  replacement image had not yet been bound to the reference role.
- The comparison then used direct adapter calls with a 5-second duration and
  the uploaded image as a reference. It did not submit a paid task through the
  blocked recreation plan or change that project's saved shot binding.
- Direct calls to the same `UniArtVideoModel` adapter were made with the
  same source path, image path, prompt, model (`minimax-h3-vip`), mode
  (`reference2video`), duration (5), ratio (`16:9`), and audio policy. Only
  `resolution` differed.
- An initial pair of calls used the container's `OPENAI_API_KEY` and both
  returned HTTP 401 before task creation. That key was selected incorrectly
  for this experiment; the result does not establish that the production
  Agent's owner credential is invalid. The valid comparison below used the
  previously authorized UniArt credential without recording its value.

## Runtime observations

| request | result | provider response |
|---|---|---|
| `720p` | completed | output `1344×768`, 24 fps, 124 frames, 5.167 s; SHA-256 `dcb221f729eb9bcb5cb119aac13bc79f1440dd0e50eb6c63b34c750f59e683d5` |
| `768p` | rejected at submission | HTTP 400 `invalid_request`: `selected Seedance resolution conflicts with task metadata` |

The two requests used the same adapter, model, mode, duration, ratio, source
video, replacement image, and prompt. Only `resolution` differed. The 720p
request reached asynchronous generation and produced an output. The 768p
request was rejected before a video output was written.

## Direct implication

For this exact deployed UniArt H3 Ref2V route and request shape, `720p` is
accepted and `768p` is rejected by provider task metadata validation. This is
runtime evidence for this route, not a claim about every UniArt endpoint or
every model family.

## Not yet proven

- Whether `768p` is accepted on another UniArt route, model family, or request
  mode.
- Whether the provider's `768p` compatibility statement refers to a different
  task metadata schema or alias normalization layer.
- Visual differences beyond the successful 720p output's media probe.

## What would verify it

Repeat the comparison only if the upstream route documents a distinct 768p
metadata mapping. Otherwise keep the recreation H3 route at the catalog-
declared `720p` value and record any 768p support under its actual route or
alias contract.
