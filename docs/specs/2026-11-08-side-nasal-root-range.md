# Nasal-root adjustment range

## Problem

After fitting, the panel restricts every slider to 90–110. The nasal-root control uses a local deformation with a maximum of 0.032 source-space units per 25 control units. This combination permits only small radix changes and makes low versus prominent roots difficult to compare.

## Change

- Expand only `noseRootHeight` to 50–150 for both fitted and unfitted faces. Its available displacement is five times the former fitted range.
- Preserve the deformation function, calibration baseline, saved values, landmark mapping, measurement units, review requirement and output verification gates. Existing control values retain identical geometry.
- Explain low versus prominent roots on the slider and show the forehead-to-bridge transition in the nose comparison instructions.
- Keep other fitted sliders at their existing ranges. Use anatomical descriptions without assigning fixed nose shapes to populations.

## Validation

- Verify a fitted character can save and restore both new endpoints while preserving all other shape and calibration fields.
- Check both endpoints move the root independently of the bridge midpoint and tip, including mirrored profiles.
- Track warped source texture at both endpoints, rejecting unchanged pixels.
- Run measurement, guide and workbench regressions, typecheck and production build.

Actual output remains dependent on the selected photo and existing detection/texture checks; no pose or pixel gate is relaxed for the expanded range.
