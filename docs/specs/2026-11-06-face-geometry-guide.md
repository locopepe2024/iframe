# Face geometry guide v1

## Observed problem

Su Yan's 2026-11-06 headshot request included the measured targets but approximately retained the full-body reference's front proportions. With reference ratios normalized to 100, target/observed length-to-cheek ratios were 84.48/101.19, jaw-to-cheek 86.22/101.21, and eye-to-cheek 92.91/100.45. The original face was only about 110 pixels high; these are diagnostic landmark estimates, not precision anatomy measurements.

## Contract and scope

Create a local pixel guide before generation, using the saved white-model measured changes and a user-selected frontal portrait. This slice supports eye-line-to-chin length, cheek width, jaw width, eye spacing, and corresponding cheek/jaw vertical shifts. Keep eye shape and texture attached to the eyes. Other front details and profile depth controls are explicitly unsupported by this guide; never claim their application. The existing complete white-model controls and normal generation path remain available.

1. Detect and crop the original face locally with the shipped MediaPipe implementation. Require one sufficiently frontal face, finite ordered marks and at least 128 original face pixels; recommend 256. Preserve source pixels rather than enlarging a thumbnail as if it gained detail.
2. Transfer measured changes to the same seven image landmarks. Build a smooth thin-plate displacement with fixed surrounding image anchors. Reject invalid/folded control layouts rather than clamping requested targets silently. Identity transforms return unchanged pixels.
3. Show original/warped images, supported targets, source quality and unimplemented controls. Source, region or saved-shape changes invalidate the guide. Preview never uploads, saves a character or submits generation.
4. An explicit Use action saves the reviewed guide through the existing owner-scoped library upload/asset APIs. It becomes the headshot panel's single visible reference. The source portrait and character variants remain unchanged. Freeze source identity, shape and supported targets in the library description for provenance.
5. Replace the headshot prompt visibly with an instruction to preserve the guide's already-adjusted front geometry while refining texture. Do not append the original reference-relative numerical block: that would apply the deformation twice. Keep existing submission review/fingerprint and model routing; no hidden provider prompt additions or paid test generation.

## Success criteria

- Exact control mapping achieves the four supported target ratios and finite height shifts. Neutral input preserves the source. Degenerate/invalid inputs fail with an explanation.
- Pixel output is independently re-detected and compared with targets; report deviations rather than treating mathematical control mapping as visual proof.
- Component tests cover source/shape invalidation, review-before-upload, failure behavior and explicit application. Workbench tests verify the single guide reference and visible non-duplicating prompt reach submission review.
- Run relevant math/UI tests, TypeScript and production build. Follow the existing PR/CI/release workflow only after local pixel and browser validation.
- Model adherence after refinement remains unproven until a separate real generation is reviewed.
