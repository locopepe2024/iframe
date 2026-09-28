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
- The plan inputs were corrected to use the replacement image as both the
  reference and replacement role, with a 5-second generation duration.
- Direct calls to the same `UniArtVideoModel` adapter were then made with the
  same source path, image path, prompt, model (`minimax-h3-vip`), mode
  (`reference2video`), duration (5), ratio (`16:9`), and audio policy. Only
  `resolution` differed.

## Runtime observations

| request | result | provider response |
|---|---|---|
| `720p` | failed before task creation | HTTP 401 `Invalid token` |
| `768p` | failed before task creation | HTTP 401 `Invalid token` |

The provider returned distinct request IDs, which are intentionally not
recorded here. Both failures occurred within one second and no output media
was written.

## Direct implication

This run does not establish whether H3/UniArt accepts `720p` or `768p`. It
establishes only that the shared provider credential available in the deployed
container was invalid at the time of the comparison. No paid generation task
reached provider acceptance.

## Not yet proven

- Provider acceptance of either resolution for this exact Ref2V request.
- Whether `768p` is an alias for `720p`, a distinct output tier, or only
  accepted on another UniArt route.
- Output dimensions or visual differences between the two values.

## What would verify it

Repeat the exact comparison after installing a valid, authorized UniArt
credential in the production runtime or an isolated provider sandbox. Capture
the redacted request shape, provider task ID, terminal status, output probe,
and checksum for each resolution. Keep catalog declarations and any alias
mapping in the same test record.
