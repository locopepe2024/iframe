# H3 storyboard analysis and prompt checks

## Scope and success criteria

Use the existing Chat skill mechanism. No additional model calls, automatic retries, account changes, or video submissions. Installed skill snapshots remain pinned; shared creative rules correct old H3 guidance at runtime. Update H3 director and product-recreation packages. An offline Ref2VA validator checks syntax and externally supplied media counts; it is not a visual parser or a generation acceptance guarantee.

Success: recognize overlapping contact sheets as one timeline; do not turn every sample into a shot or a sample timestamp into an exact cut; retain short product close-ups; distinguish newly designed sound from observed audio; preserve user silence constraints. Final copyable Ref2VA text uses a single native media-label syntax. A verified workflow mapping takes precedence over illustrative numbering.

## Evidence and source boundaries

- Official MiniMax H3 `d21241f0a4b3acbb34c97dae47fa417b7065e438`, skills/h3-prompt-writing/references/ref-en.txt §§2.2, 2.5, 3, 5: storyboard anchors, independent video/audio category numbering, source roles, six fields and shot grammar. base-en.txt §4.6: overall_soundscape is N/A for requested complete silence; §4.7: non_diegetic_music is N/A without score.
- Community duckyshell/ComfyUI-MiniMaxH3-Prompt-Writer `dbc71076a32457dd650d21805f63fef50fa83321`, README and backend/system_prompts.py: ordered contact-sheet observations are not target shots; its prompt models do not hear uploaded audio. These are that application's behaviors, not proof of MiniMax hosted optimizer internals.
- Community AI-KSK/aiksk-minimax-h3-local-prompt `27c0d81301616f955baccc052efd20e9602290f6`: inspect actual workflow material mapping; separate official grammar from production heuristics.
- Community babicat4242-svg/minimax-h3-prompting `b64d63d4b931b0af14248d5c4bc8e7287ed8fc06`: deterministic structural validation pattern. This change uses an independently written narrow validator and does not import third-party code or model limits.

## Private evaluation case (media excluded from repository)

The user's 0.5-second 5x7 and 1-second 4x4 contact sheets contain 31 and 16 actual frames of the same clip, with overlapping times 0.000–14.983. The blank cells are not frames. Both contain a short product close-up before the meal. Runtime FFmpeg scene>0.15 detection on the supplied 15-second silent clip found candidates at 4.016667, 9.083333, 10.400000 seconds, consistent with the existing local analysis report and the visible contact-sheet composition changes. Scene detection alone does not prove every cut.

Visual-only evaluation receives only the two sheets plus the task, not this expected answer or the exact cut times. Require overlapping-time deduplication, four composition phases including the close-up, and uncertainty intervals rather than claims of frame-accurate measurement. Video/measurement-assisted evaluation additionally receives verified cuts and should retain four shots ending at 15 seconds. The two evaluations must not be conflated.

The supplied hosted-optimizer output has three shots and omits the separate product close-up. Its 4.483 and 10.500 timestamps coincide with samples, not the verified cut candidates. This is an observed output discrepancy, not proof of its internal attention or sampling algorithm.

## Verification

- `python -m pytest tests/test_h3_prompt_check.py tests/test_agent_skills.py tests/test_agent_chat.py tests/test_reference_submission.py -q`
- `python scripts/check_h3_prompt.py prompt.txt --duration 15 --pictures 2 --videos 0 --audios 0 --silent`
- `python scripts/check_h3_prompt.py prompt.txt --duration 15 --pictures 2 --videos 0 --audios 0 --silent --cuts 4.017,9.083,10.400`

Only supply --cuts when independently known. Without it the validator cannot detect an omitted visual shot. --silent checks the two sound fields, not semantic sound claims elsewhere. Skill instructions perform the semantic review; structural PASS never proves visual comprehension, fidelity, model compliance, or upstream acceptance.
