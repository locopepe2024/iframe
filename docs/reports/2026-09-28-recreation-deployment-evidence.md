# Recreation deployment evidence — 2026-09-28

## Observed

- Current branch: `feature/iframe-3d-director-v1`.
- `f72be051` was originally on `fix/recreation-optimization-v1`; it is now carried into this branch as `8f639bc4`.
- `f91d051c` (`feat(recreation): expose generation attempt checkpoints`) is not an ancestor of this branch.
- The current branch therefore does not contain the generation-attempt checkpoint UI or its provider task ID presentation.
- `iframe.recreation.workspace.v1` exists in the source component `frontend/src/components/modules/recreation/RecreationPage.tsx` and its tests, but source/test presence is not evidence that a production static bundle was published.
- The checked-in `static/` directory does not provide a reliable deployment proof for the latest frontend. A production build must be produced and published, then verified through the deployed asset response.

## Direct implication

The statement that the latest frontend has not been deployed is consistent with the repository evidence. The recreation checkpoint feature requires both the feature commit (`f91d051c` or an equivalent change) and a subsequent frontend build/deployment. The workspace key alone cannot establish deployment.

## Not yet proven

- Which exact commit is currently serving `https://garage.uniart.fun`.
- Whether the host is serving a static export, a container image, or a different deployment branch.
- Whether the production backend already contains the provider task ID persistence changes.

## Verification required before claiming deployment

1. Build the frontend from the intended release commit with the production API URL.
2. Publish the generated static assets and backend together.
3. Record the served commit/build identifier.
4. Open the deployed recreation page and verify the checkpoint row, provider task ID/pending state, control revision, and update time after refresh.
5. Verify `iframe.recreation.workspace.v1` recovery and invalid-project cleanup in the deployed browser session.
