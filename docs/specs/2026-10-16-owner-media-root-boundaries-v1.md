# Explicit media root at owner storage and delivery boundaries

## Scope

After #133, migrate the owner storage/delivery primitives by dependency injection. Studio owner directories, upstream signing and verification, Studio signed/owner reference resolution, PlaygroundStorage and media registry accept an explicit output_root keyword. Default remains output, preserving existing callers. No global environment selector is introduced until all generation writers, library services, assembly/export and upload guards migrate. This is not application-wide custom-root readiness.

## Contract

A caller must use the same root for writes, signing and resolution. The root is deployment/internal input, never accepted from an HTTP request body. Public URL paths, owner hashes, signatures and stable storage keys remain independent of the physical root. A signature is still authorized by its existing owner/path/expiry tuple, not by deployment root. Do not search old roots or fall back to arbitrary existing files. Validate managed owner paths against symlink escapes before use. Missing files remain rejected where required by existing APIs. Legacy output/ locators resolve under the supplied root. No auto-copy of data between roots.

Registry records remain per-owner SQLite files below the chosen root. Playground history/session/template files and uploaded inputs use the same chosen root; unrelated owner data must remain inaccessible. Wider PlaygroundService and HTTP factories retain the default until migrated; per-instance root propagation must not depend on process-global mutation or context leaking across worker threads.

## Verification

Use a real temporary custom root and a separate working directory; write owner assets/input bytes, sign and verify provider/Studio references, renew expired owner references, persist/reload history and registry. Check wrong owner, wrong root, tampered signature, traversal and escaping symlinks. Run existing ownership, media route, preview and storage tests plus backend CI selection. No production deployment or provider generation.

## Validation checkpoint

Eight custom-root cases pass, including actual byte writes/reads, session and generation-history reload, registry round trip, expired Studio reference renewal, preview verification, relative custom roots and escaping symlinks. Full backend CI selection: 1284 passed, 5 skipped, 2 deselected. Existing default-root ownership/routes and writer tests remain passing in that selection. These tests exercise storage/delivery primitives; HTTP application factories and generator end-to-end custom-root support are not yet migrated. Existing browser URL signatures and owner hashes remain unchanged.
