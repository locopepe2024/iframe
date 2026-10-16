# Pipeline media-root propagation

## Evidence and contract

Pipeline persistence and more than forty media operations still name output/
directly. Root-aware generators are not sufficient to enable a global setting.
This slice introduces keyword-only output_root="output" on ComicGenPipeline
and ExportManager and carries it into generators, project/series/library JSON,
owner directories, registry, reference resolution, legacy owner migration,
cache paths and existing video/render/export paths. It changes path selection,
not timeline, trimming, audio or rendering features.

The owner mixin has an immutable legacy default root for existing subclasses;
a pipeline instance overrides it at construction. No process-global environment
switch is introduced. Old output/ and outputs/ locators resolve against the
selected root. Absolute physical paths must be within that root. Persisted media
keys remain relative to the root. Explicit existing output_dir overrides retain
their legacy semantics. Static migration APIs retain a default root argument.

## Implementation and boundaries

Use ManagedMediaRoot for common local reads and preserve owner checks before
resolving owner references. Registry calls use the same instance root. Owner
migration copies only within the selected root, preserving the previous tree.
The legacy ExportManager writes mock bytes; path tests do not prove video export.
Actual assembly compiler behavior is checked with the existing FFmpeg suite.

HTTP factories, remaining API/library consumers and provider-internal publishing
remain subsequent audits. Explicit Local/COS/OSS selection, user-facing root
configuration and revision-pinned deployment are not enabled by this PR. Voice,
editing and composition enhancements remain deferred. No production deployment.

## Verification

Use isolated roots with fake generators/processors and no Demucs warmup/provider
requests. Test persistence/reload, instance isolation, generator injection, owner
registry, aliases, wrong-owner/path escapes and migration. Parameterize existing
assembly contract/real-FFmpeg tests over default and custom roots so render,
source ordering and source audio retain their behavior. Run backend CI selection
and relevant source-local tests. No local Go or paid model calls.

Local verification: backend CI selection passed 1346 tests (5 skipped,
2 deselected); affected source-local index/owner migration and new root tests
passed 17 tests. The focused assembly/path/routing suite passed 49 tests,
including real FFmpeg source ordering and source-audio checks under both roots.
