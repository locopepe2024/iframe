# Unified workbench reference materials

Creation, character image/design, and storyboard workbenches use one reference browser: local upload, owner/project assets, platform references, and recent creation media. A persistent quick-search field searches the active source; platform search runs on the server, is paginated, and never downloads originals until selection. Loading errors have retry states and never masquerade as empty results.

Selection is explicit; closing without confirmation preserves the draft. Image-only hosts admit images only. Existing model reference limits and semantic character/scene/prop membership remain authoritative. Platform pose/depth images are ordinary visual references, not a promise of depth-control model support.

References retain stable asset IDs/revisions, or an owner media-registry ID for uploads. An authenticated resolver validates identity, ownership, revision and image bytes before returning a durable owner media URL. No API keys, arbitrary paths or external URLs are accepted as reference identity. Storyboard supplemental image selections persist on the frame and participate in image generation, R2V, preview and invalidation; they do not create project entities. I2V retains first-frame semantics.

Verification: shared browser search for 举臂交叉, selection/cancel, source failure/retry, stale query protection, upload and actual reference transport. Backend tests cover owner isolation, missing/nonimage media, platform revision, persistence, T2I/R2V supplement behavior. Run targeted UI/backend tests and typecheck; deploy GreenA through a narrow source patch with baseline comparison and idle-job guard. No paid generations are required for verification.
