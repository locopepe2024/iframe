# Side-profile nasal-root landmark

## Goal

Expose the existing MediaPipe nasal-root landmark (168) as the fourth saved side-photo fitting mark, so a user can review and correct the radix position used by the profile guide.

## Behavior

- Detect and display sideEye, sideNoseRoot, sideNose, and sideChin in the side-photo correction list.
- Permit manual correction of sideNoseRoot on the original photo and persist it with the calibration landmarks.
- Map the corrected source-image root into the side guide's normalized manual landmarks.
- Keep the new landmark optional for old calibration records. Restored legacy photos still show the freshly detected root position and profile guides use it unless a saved manual correction exists.
- Correcting only sideNoseRoot must not invalidate the 3D fitted baseline or reset any existing bone controls; it changes the profile-pixel guide anchor only.
- Validate the manually corrected root against image bounds and nose landmark order before using it.

## Acceptance

- Automatic points identify landmark 168 for either profile direction.
- A restored side photo with three saved legacy points displays an automatic fourth root point; selecting and clicking it produces a manual, persisted root point.
- Root-only correction survives save/reopen and is consumed by profile geometry while old saves continue to use detected coordinates.
- Existing front fitting, profile eye/nose/chin marks, and saved bone numbers remain unchanged.
- Focused tests, frontend typecheck, build, CI and production version/health checks pass.

## Implementation detail

The side-root landmark is an optional addition to the saved landmarks record, independent from the 3D fit metrics. This keeps older saves valid and allows a root-only correction to be saved without repeating the fit or resetting any bone controls.
