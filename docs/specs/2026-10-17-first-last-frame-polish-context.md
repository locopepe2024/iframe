# First/last frame storyboard polish context

## Observed

- Studio submits two selected images with `generation_mode=first_last_frame`; the UniArt adapter sends `mode=frames2video` with `first_frame` and `last_frame` roles.
- The polish surface currently calls the I2V endpoint without the shot's video mode and attaches only the first image. An accepted optimized body is submitted verbatim, so the generation endpoint cannot correct an I2V-only description.

## Boundary and assumptions

- The selected first and last image variants are the only visual authorities for the opening and ending. The polish model may describe visible states and a plausible continuous transition, but must not invent unseen intermediate events as observed facts.
- H3 keeps its three existing body fields. First/last alignment belongs in the text composed by the optimizer, before those fields; no context is appended after the returned prompt.
- Existing I2V, T2V, and R2V requests retain their current behavior. A first/last polish request requires both images and their order.

## Success criteria

1. Studio sends `generation_mode=first_last_frame` plus the active first and last images in order to the polish endpoint.
2. Both standard LLM and MiniMax Context-IR optimization receive labeled first/last images and the target duration.
3. The optimizer contract asks for an opening state, a continuous transition, and a final state matching the last image, including still people visible in that image.
4. Missing/duplicate images fail before model submission; existing H3 three-field validation and image owner checks remain active.
5. Frontend and backend behavior tests pass; no provider prompt is modified after optimization.
