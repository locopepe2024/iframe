# Image and video generator media-root propagation

## Observed code facts

AssetGenerator and VideoGenerator write owner media through studio_media_dir,
but do not pass a root. They also calculate keys and look up references against
literal output/. PR #137 supplies a per-upload output_root keyword; it is a
prerequisite of this slice, not an application-wide configuration switch.

## Contract and scope

Add keyword-only output_root="output" to these two constructors. Use it for
default output directories, owner directory helpers, relative stored media keys,
local reference joins and every optional upload_file call in these modules.
The same owner/key must be portable between roots without encoding the physical
root in stored keys. Remote URLs and cloud object keys keep their existing
semantics. Existing output_dir overrides and already-existing physical reference
files retain their legacy behavior; this slice does not redefine their trust
policy or claim that arbitrary overrides produce portable managed keys.
Legacy output/ and outputs/ stored locators resolve under the selected root,
even if a same-named file still exists under the process working directory.

No process-global environment switch is exposed. No provider requests, media
format changes, prompt changes or generation-mode changes are required.
Audio, storyboard, pipeline assembly/export, HTTP factories, provider-adapter
internal reference publishing and library consumers are outside this slice.
Custom-root support is therefore not yet complete across the application.

## Verification

Tests first reproduce missing constructor/root propagation. Use fake model
adapters writing real bytes under isolated roots; verify image variants and video
results resolve against that root, owner isolation for writes, root-relative and
absolute reference inputs, old output directory defaults and overrides, and
per-call root propagation to fake uploaders. Exercise character views, scenes,
props, motion-reference I2V and frame clips. Run focused tests and backend CI
selection. No cloud or paid provider calls.

Affected files: src/apps/comic_gen/{assets,video}.py and generator root tests.
Existing constructor-bypassing test fixtures explicitly initialize output_root;
production does not introduce a missing-configuration fallback for those fixtures.

## Local verification result

19 new generator tests pass, including legacy output/ and outputs/ references;
95 focused writer/reference tests pass after the review fix. The original PR head's backend
CI selection was 1308 passed, 5 skipped, 2 deselected; the updated head requires a fresh CI run. Cloud clients and model
adapters in the new tests are fake; these results are not live provider or
production deployment evidence.
