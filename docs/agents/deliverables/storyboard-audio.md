# Storyboard video audio control

Scope: expose the existing catalog `params.audio` capability in both storyboard parameter surfaces and pass the selected boolean through all four video submission paths. This controls generated video sound, independently of dialogue TTS. Keep the existing default (off) and local videoConfig persistence.

Code evidence: StoryboardR2V currently submits false in all four createVideoTask calls; pipeline forwards task.generate_audio to UniArtVideoModel, which serializes generate_audio. No provider contract change is needed. Unsupported models must never inherit an enabled audio flag.

Acceptance: supported models expose an accessible switch, unsupported models hide it, explicit false survives serialization, and single/batch I2V/R2V submissions use capability-checked settings. Verify UI tests, request tests, typecheck and production build. No paid generation.

Separate follow-up: first-frame I2V exists; reference-video selection/classification and first/last-frame storyboard persistence/request plumbing need dedicated implementation. Adapter support alone does not establish storyboard support. No new capability is declared here.
