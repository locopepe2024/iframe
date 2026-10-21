# H3 V2 storyboard frame modes

User scope: expose first/last-frame generation in the creation workspace and complete storyboard I2V (first frame), first/last frame and omni reference paths. Preserve the generated-audio switch.

Observed code: the shared adapter supports all four modes, but Studio creation rejects f2v and its dispatcher lacks f2v. The storyboard UI has first-frame and reference tabs only. Playground has an f2v selector, filtered by runtime capabilities, so an older three-mode H3 catalog hides it.

Implementation: keep the storyboard's existing two workflow tabs. Within H3's frame workflow expose first-frame / first-and-last-frame selection and an explicit tail image chosen from existing first-frame candidates or uploaded separately. Persist choice/tail on the frame, carry tail into each immutable generation task, validate ownership and incompatible media before creation, and submit dedicated first_frame/last_frame roles. Frame ratios follow input geometry. Reference workflow remains separate.

Compatibility: add f2v to already-published H3 video entries when installing older runtime snapshots, based on the verified V2 adapter contract; do not invent SKUs, availability or routes, and exclude H3 IR. Recognize provider mode aliases in catalog normalization. Accepted V1/V2 tasks recover through their saved protocol.

Success checks: reproduce missing Studio f2v and older H3 catalog visibility using tests; verify missing/mixed/foreign tail rejection, exact frame wire roles, audio values, saved frame state, UI selection/upload and Playground mode selection. Run targeted Python/UI checks, typecheck and build. No paid generation or deployment.


Implemented: both single and batch storyboard generation use the same validated request path; tail is saved on frame drafts and task records and forwarded through the public Studio API. First-frame and reference workflows retain their existing inputs/audio choices. H3 frame workflows display automatic ratio guidance.

Validation: the initial Studio regression reproduced with an unsupported last_frame_url argument. After changes, 160 targeted backend checks passed, 1 skipped. 18 targeted UI checks passed (older three-mode H3 catalog selection, frame mode/selection/upload/error states, and audio preservation). Python compilation, frontend typecheck and production build passed. Full backend: 873 passed / 78 failed / 2 skipped; same failing IDs as before this slice. Full UI: 315 passed / 43 failed / 25 errors; same failing cases as the recorded baseline. Full unit: 234 passed, 4 existing import failures caused by axios mocks missing interceptors.request. The final full run includes API forwarding and canonical first/last-frame prompt reference checks. No paid/live generation or deployment.
