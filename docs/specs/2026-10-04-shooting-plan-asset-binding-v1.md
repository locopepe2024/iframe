# Shooting plan asset binding v1

## Boundary

- Director interpretation establishes global and episode context.
- Assets define the executable look for a character, scene, or prop at a
  specific episode/scene time: era, season, interior/exterior, weather,
  wardrobe, layout, and continuity state.
- The shooting plan binds a scene asset and character look IDs, then carries
  only the prop references that matter to story, identity, period, season, or
  continuity.

The plan must not list the entire asset inventory. A school bag, winter coat,
letter, or other story-bearing object may be a key prop; background objects
remain part of the scene asset description unless a shot makes them narratively
relevant.

## Display and identity

Asset IDs remain authoritative for persistence and downstream binding. User
facing location text uses the scene asset name. If a model returns a known scene
ID in `location`, the adapter resolves it to the scene name instead of exposing
the UUID. Unknown IDs remain unresolved and do not become invented locations.

## Continuity

When a key prop is selected for a scene, its shot-level binding carries the
state (`present`, `carried`, `worn`, `opened`, etc.). The same scene asset and
time/season context are inherited by shots unless the user explicitly overrides
them. This keeps a winter exterior coat or student bag consistent across the
scene without forcing every asset into every shot.
