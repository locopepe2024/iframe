# Audio and storyboard writer roots

## Observed code facts

AudioGenerator writes owner files through studio_media_dir but does not pass a
root; its persisted keys use literal output/. Its TTS initialization block is
unreachable after _output_dir_for's return, leaving normal instances without a
tts attribute. TTSProcessor construction only initializes local SDK/config state;
provider requests occur at synthesis, which tests replace with a fake processor.
StoryboardGenerator also uses literal output/ for default paths, reference reads
and stored keys. Pipeline callers currently pass explicit owner output directories.

## Implementation slices

1. Restore TTS initialization to AudioGenerator.__init__. Prove the bug first
   with a failing construction/dialogue test. Retain existing initialization-error
   behavior (tts=None and failed dialogue state), with no fake success output.
2. Add keyword-only output_root="output" to audio/storyboard constructors.
   Use it for default directories, owner directories, reference resolution and
   persisted keys. Storyboard explicit output_dir remains highest priority;
   otherwise an owned frame uses its owner directory, then legacy default output.
   Explicit storyboard references preserve URL/object-key/physical-file semantics
   and resolve stored keys against the selected root. output/ and outputs/
   aliases use ManagedMediaRoot so cwd's legacy files cannot shadow the selected
   root. Retain legacy output_dir overrides and physical references, which are
   not newly claimed to be a complete sandbox boundary.

## Boundaries

No global media-root setting is enabled here. Pipeline assembly/export, HTTP
factories, library consumers and provider-internal publishing remain separate.
No prompt/reference selection policy, audio format or paid-provider behavior
is intentionally changed. Existing SFX/BGM methods remain mock implementations;
tests of their path handling do not prove real audio generation.

## Success criteria

Fake TTS writes actual bytes to the expected owner/custom-root path; persisted
keys reload from that root, voice/text/settings are preserved, and unavailable
TTS fails cleanly. Test storyboard auto/explicit references, legacy aliases,
owner/default/explicit output directories and relative roots with fake models.
Verify defaults and per-instance root isolation. Run focused tests and backend CI
selection, without network provider requests or production deployment.

Affected paths: src/apps/comic_gen/{audio,storyboard}.py, tests and this spec.
