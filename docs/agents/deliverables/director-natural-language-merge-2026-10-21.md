# Natural-language static scene assistance merge

Merged daa39681 and its reference-export dependencies into the character/scene workbench branch. Resolved the library dialog conflicts by retaining current platform publication and dictionary validation; structured reference import already matched the current branch.

## Verification

- 65 director/reference/library UI tests passed; typecheck and production build passed.
- 64 backend tests passed with IFRAME_TEST_MEDIA_SSH_TARGET=media and local Blender test explicitly deselected. Real remote Blender 4.5.9 returned completed depth, a PNG preview and meter data. Preview center depth matched the synthetic two-meter plane; packageChecksum survived task and output manifest. Execution host asserted media. Remote failure remains fail-closed.
- Earlier local Blender trial is not the accepted runtime. All further validation uses media; no residual local Blender processes remained.

## Behavior and boundaries

Natural language -> typed proposal -> browser geometry compilation -> preview -> atomic apply/undo. Supports existing actor placement/facing, labeled box proxies and selected static camera framing/dolly. Occupancy/reference exports carry the shot package checksum; Blender on media renders depth. This commit does not invoke Blender to interpret language, generate detailed assets, or automatically insert references into the scene design workbench.

Model API tests use fixed responses; live model interpretation and WebGL pixel acceptance remain unverified. Browser tools were not used. User direction: use media Blender, never local Blender for subsequent work.
