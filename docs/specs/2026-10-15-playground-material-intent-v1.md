# Playground submission material intent

Extends the Agent no-`@` rule to image/video generation. Scope is the creation
workspace's Agent, image, video and image-editor generation requests; dedicated
mask editing and Studio shot bindings are separate explicit input operations.

No `@` in the current prompt means empty submitted media and names. Ignore stale
selected paths before resolving media, storing generation inputs or contacting
providers. Preserve the selected media list in the live frontend. Apply the gate
at queue snapshot time and backend GenerateRequest validation. Image-editor
candidate/panorama generation uses the same rule, including its selected source.

When `@` exists, preserve the current ordered input list and its numeric/name
bindings; filtering individual candidates within that list is a separate change.
Do not silently convert a user-selected generation mode. Required-keyframe modes
may reject missing referenced frames locally; never reuse unmentioned frames to
satisfy a requirement. Native H3 `<Picture N>` provider syntax is not a substitute
for explicit `@` intent at this creation UI boundary.

Do not rewrite persisted historical tasks or alter recovery/polling of accepted
jobs. Session draft saves may retain candidates independently of generation inputs.

Verify frontend queue normalization across modes, blank-editor and selected-editor
requests, server gate before filesystem access, f2v validation, and existing explicit
reference ordering. No provider calls. PR extends #126 and requires administrator merge.
