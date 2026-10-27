# H3 V2 storyboard frame modes

User scope: expose first/last-frame generation in the creation workspace and complete storyboard I2V (first frame), first/last frame and omni reference paths. Preserve the generated-audio switch.

Observed code: the shared adapter supports all four modes, but Studio creation rejects f2v and its dispatcher lacks f2v. The storyboard UI has first-frame and reference tabs only. Playground has an f2v selector, filtered by runtime capabilities, so an older three-mode H3 catalog hides it.

Implementation: keep the storyboard's existing two workflow tabs. Within H3's frame workflow expose first-frame / first-and-last-frame selection and an explicit tail image chosen from existing first-frame candidates or uploaded separately. Persist choice/tail on the frame, carry tail into each immutable generation task, validate ownership and incompatible media before creation, and submit dedicated first_frame/last_frame roles. Frame ratios follow input geometry. Reference workflow remains separate.

Compatibility: add f2v to already-published H3 video entries when installing older runtime snapshots, based on the verified V2 adapter contract; do not invent SKUs, availability or routes, and exclude H3 IR. Recognize provider mode aliases in catalog normalization. Accepted V1/V2 tasks recover through their saved protocol.

Success checks: reproduce missing Studio f2v and older H3 catalog visibility using tests; verify missing/mixed/foreign tail rejection, exact frame wire roles, audio values, saved frame state, UI selection/upload and Playground mode selection. Run targeted Python/UI checks, typecheck and build. No paid generation or deployment.


Implemented: both single and batch storyboard generation use the same validated request path; tail is saved on frame drafts and task records and forwarded through the public Studio API. First-frame and reference workflows retain their existing inputs/audio choices. H3 frame workflows display automatic ratio guidance.

Validation: the initial Studio regression reproduced with an unsupported last_frame_url argument. After changes, 160 targeted backend checks passed, 1 skipped. 18 targeted UI checks passed (older three-mode H3 catalog selection, frame mode/selection/upload/error states, and audio preservation). Python compilation, frontend typecheck and production build passed. Full backend: 873 passed / 78 failed / 2 skipped; same failing IDs as before this slice. Full UI: 315 passed / 43 failed / 25 errors; same failing cases as the recorded baseline. Full unit: 234 passed, 4 existing import failures caused by axios mocks missing interceptors.request. The final full run includes API forwarding and canonical first/last-frame prompt reference checks. No paid/live generation or deployment.

## Integration into the deployed feature branch

The release branch already owns a richer storyboard first/last-frame workflow: `video_generation_mode=first_last_frame`, separate tail candidate history/selection, asset media IDs and preview-before-generation. Keep those fields and controls as the sole UI/persistence owner. Do not introduce a second H3-only frame selector or duplicate workbench frame fields. Accept H3 `f2v` at task creation as an alias and normalize it to the existing mode before storing the immutable task. Existing Seedance first/last-frame behavior remains available under its canonical mode.

Apply dependencies 3294477c and a33b1152 first: new H3 jobs use the dedicated V2 endpoint; saved jobs recover via their persisted API version. Carry both frame roles to V2 without also sending a generic input image. Canonical reference binding counts two frames, one I2V image, or the ordered reference list. Keep managed-root/ownership validation and existing tail media identity. Reject tails on unrelated modes and audio references on frame modes. Recreation keeps its existing 720p route default because this branch does not own the separate task-resolution migration.

Integration validation: 281 related backend checks passed, 1 skipped; 21 related UI checks passed with one unrelated companion-checkbox expectation failing, reproduced with the pre-integration fixture. Catalog regeneration/validation passed. Eight relevant frontend unit checks, TypeScript typecheck and production build passed. Runtime release verification follows deployment. No paid generation performed; audio false is verified at the request boundary, not through a newly generated video.
