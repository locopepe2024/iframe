# Low-poly face base v1

## Observed

- The current browser white face is assembled from separate spheres, cones, and strips.
- Saved face parameters and prompt text already have a stable JSON shape.
- The current preview is therefore useful for checking values but poor for judging a human face.

## Direct implication

The browser preview needs a continuous low-poly facial shell with a small set of neutral base presets. This slice does not need FLAME or DECA model files.

## Scope

- Replace the disconnected head parts with a continuous low-poly face shell and attached feature meshes.
- Add base presets for neutral young adult, masculine young adult, feminine young adult, middle-aged, and older faces.
- Presets provide initial proportions only; existing sliders remain the source of saved geometry values.
- Keep front and side views driven by the same normalized shape.

## Boundaries

- No external face model weights or downloaded assets.
- No claim of anatomical reconstruction or identity matching.
- No change to generation reference semantics or saved asset contracts.

## Success criteria

- The preview reads as one connected human head at default values.
- Switching a base preset changes the initial proportions without changing the asset type or prompt contract.
- Existing face shape fields still round-trip and affect the preview.
- Existing white face and character workbench tests remain green.

## Geometry refinement

The head shell now uses one indexed surface with a tapered chin, jaw, cheek and forehead profile. Its front surface has bounded relief for the eye sockets, cheekbones, nose bridge, nose tip, nose wings and chin. The same mesh drives front and side views; small ear, eye and lip meshes remain visual landmarks. Preset changes restart from the selected preset's neutral baseline, so values from a previous preset cannot silently carry over. This is a proportion preview, not an anatomical reconstruction or a guarantee of identity preservation in generated images.

The preview camera backs away on narrow canvases so the front and profile heads remain fully visible together. Desktop and 390px mobile browser captures are the visual acceptance check for this first low-poly version.
