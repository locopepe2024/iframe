# Cloud upload media-root boundary

## Scope and code facts

Owner media storage/signing accepts an explicit root after PR #136. COS and
OSS upload guards still accept only cwd/output and system temporary files.
The upload adapters are singletons; storing a root on either instance would
allow one caller's configuration to change another caller's trust boundary.

## Contract

Add keyword-only `output_root="output"` to both `upload_file` methods. Resolve
physical upload paths against cwd as before (these are file paths, not stored
media locators). Permit regular files strictly within the canonical explicit
root or the system temporary directory. Resolve symlinks before containment
checks; reject directories, missing files, and escaping symlinks. Preserve cloud
object keys, existing return-None rejection behavior, and temporary upload policy.
Do not store root configuration on singleton instances. Upload image/video
aliases must share the same contract.

## Success criteria and verification

Use fake cloud clients to verify bytes uploaded from a custom root, default
output and temporary compatibility, wrong-root and symlink rejection, and no
root leakage between consecutive calls. No provider or cloud network calls.
Run focused tests then the backend suite used in CI.

Affected paths: src/utils/{upload_paths,cos_storage,oss_utils}.py and tests.

## Boundaries and remaining work

This is a prerequisite API, not application-wide root activation. Writers,
HTTP factories, pipeline assembly/export, and library readers must still pass
the configured root before exposing a global setting. Temporary-directory
permission remains intentionally broader than the media root for existing
upload workflows. Containment is not race-proof against concurrent symlink
replacement; this change does not claim to solve that existing limitation.
