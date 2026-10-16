# Managed media root and stable locators: foundation

## Observed and boundary

Local media resolution is centralized in media_refs.py for some adapter/upload consumers, but Studio, Playground, registries and generation writers also use independent output paths. A global environment switch before all those owners migrate would split writes from reads and signing. This slice deliberately supplies an explicit root object, not an application deployment switch. No filesystem migration occurs.

## Contract

ManagedMediaRoot holds a fixed absolute root. Resolve relative keys, legacy output/ and outputs/ locators, and absolute paths inside that root. Return durable relative keys independent of deployment directory. Reject empty/root-only values, URLs, backslashes, NUL, traversal components and symlink escapes. Missing files may resolve for future writes; this helper is a path boundary, not authorization or existence validation. User ownership checks remain required at calling boundaries. Prefix aliases are case-sensitive. Resolving a symlink entirely within the root yields its canonical target key. Existing symlink-root directories are canonicalized once; protection against concurrent symlink replacement is outside this helper's contract.

media_refs keeps its default project/output root and recognized relative prefixes. It delegates resolution to this shared object without adding an environment variable, accepting arbitrary relative paths at existing adapter boundaries, or treating every relative key as local rather than cloud. Explicit output_root arguments let consumers migrate and test custom roots. Invalid traversing/symlink-escaping references classify as unknown and never resolve. Root layout, signatures and public URLs do not change.

## Acceptance and next slice

Test custom roots, round-trip stable keys, legacy aliases, future writes, traversal, outside absolute paths, root-only paths and symlink escapes. Verify existing classification/local-provider suites. Then migrate Studio/Playground writers, registry, signing and serving as a coherent slice before exposing an administrator environment setting. COS/OSS selection and in-flight tasks remain independent. No production deployment, data moves or provider generation.
