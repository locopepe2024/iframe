# Playground delivery/index root propagation

## Observed

PlaygroundStorage already accepts a media root, but its Studio browser-reference
signing and API reference renewal omit that root. Upload registry keys and the
registry location still use output/. Service archive and first-input lookup also
use literal output/. These are code facts; no production browser failure is
claimed reproduced by this audit.

## Contract

Use storage.media_root for browser reference signing/renewal, upload registry
location and stable keys. Validate an upload target against the managed root
before creating directories or writing bytes. Resolve service local reads against
the selected root, including legacy output/outputs aliases and existing relative
physical paths. Alias reads must not select a cwd legacy copy. Leave remote URL
and object-key inputs unchanged. Archive writes remain in storage.asset_dir;
reject a category that would escape that directory (including symlinks).

This slice uses the injected PlaygroundStorage as the root owner. HTTP factories
still construct the default root; global root activation, other HTTP/library
consumers, provider internal publishing and pipeline root migration remain open.
It does not add timeline or rendering features. Existing generation signatures,
provider selection and owner metadata remain unchanged.

## Verification

Reproduce custom-root upload registry and expired Studio-reference renewal bugs
with actual temporary files, fake upload streams and local signing. Verify alias
reads select the configured root, archive bytes and invalid archive categories,
root-contained upload targets and default compatibility. No paid provider calls
or production deployment. Run focused tests and backend CI selection.

## Verified behavior and limitations

Local service reads now reject filesystem locators outside the managed root;
this does not establish cross-owner validation for every stored-path consumer.
Upload validation resolves symlinks before writing but is not race-proof against
concurrent symlink replacement. Other delivery routes still require their own
containment audit before global custom-root activation.

11 new tests pass. Backend CI selection: 1322 passed, 5 skipped, 2 deselected.
Source-local Playground session suite: 7 passed. Its legacy fixtures now use
explicit storage roots where mocked, real resolved-reference expectations, and
an explicit @ in the foreign-reference rejection case (otherwise materials are
correctly omitted by the previously merged submission policy). No live-provider
or production-browser fix is claimed from these local tests.
