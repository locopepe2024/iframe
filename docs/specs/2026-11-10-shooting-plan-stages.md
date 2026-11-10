# Bounded shooting-plan generation

The former 4,500-character source batch could request an entire scene/beat/shot
document in one response. A 2,159-character screenplay produced over 16,000
response characters before the provider emitted an SSE error at approximately
154 seconds. The application timeout was 1,800 seconds; this change reduces
response size rather than assuming a particular provider error cause.

## Generation

1. Plan scenes and beats for each existing source batch. The structure has no
   shots. Numbered source units preserve the complete original text, each at
   most 240 characters. Beats reference one or two units. Validate that unit
   references cover the source exactly once and in order, and that event IDs
   belong to the confirmed Director story map.
   A missing scene heading reuses its existing source label or location, or
   remains empty. This display metadata does not invalidate a covered structure.
   A correction request reports up to six field errors together, without
   including response text or validation input values in ordinary logs.
2. Expand one beat per request, with at most three shots and a 6,000-character
   JSON envelope. Use only that beat's original text, relevant confirmed events
   and scene summaries, global execution/canon constraints, entities, visual
   style, selected Skills, and a short continuity handoff. Return shots and the
   actual outgoing state, without repeating scene/beat metadata. The existing
   shot/lighting/information-design contracts still apply.
3. Assemble shots under the validated structure, then run existing plan lineage,
   event, entity, and continuity checks. Generating a draft does not confirm a
   plan, change existing frames, or launch media generation.

Both stages use the captured account screenplay model and existing provider
routing. Each malformed model response permits one correction of that stage
only. Provider failures stop the job; they do not automatically retry completed
work or switch accounts/models. Requests remain streamed with the existing
1,800-second application timeout. The per-beat bound is not a cap on the full
episode's duration or total shots.

## Durability and progress

The existing owner/project/fingerprint/source batch stores a checkpoint after
structure planning and after each validated beat. A checkpoint hashes all
generation inputs, including model, style, Skills, and incoming continuity.
Retries reuse matching checkpoints. Completed batch results retain their
checkpoint so progress remains consistent. The algorithm version participates
in the job fingerprint; existing confirmed plans are not rewritten.

Progress counts structure and shot expansion steps. Totals grow as remaining
source batches acquire their structure. Errors identify the source batch and
current scene/beat, retain safe provider diagnostics, and report actual saved
steps. Raw exception bodies, screenplay text, and credentials are not included
in public failure messages.

## Verification

Mock-backed tests cover exact source coverage, bounded detail correction,
model propagation, relevant context, persistence/reload after provider failure,
resumption without repeating completed calls, expired-worker rejection, and
existing plan/API/Director/Skills/account routing behavior. Live model quality
and upstream reliability require a subsequent user generation test.
