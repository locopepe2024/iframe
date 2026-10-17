# H3 storyboard polish contract by generation mode

## Observed

Production returned `model_contract_mismatch` for several H3
`/video/polish_prompt` calls. The backend discarded those model results and
returned HTTP 502. Raw model text was not retained, so the exact returned
headings are unknown.

The non-reference polish contract currently demands six H3 headings, while
its validator accepts only the three base headings. The H3-specific final
instruction also leaks into Seedance requests when a skill is selected.

MiniMax's published H3 prompt-writing skill at revision
`d21241f0a4b3acbb34c97dae47fa417b7065e438` specifies the three base
fields for T2VA and keyframe modes and six fields for full-reference Ref2VA.
Source: <https://github.com/MiniMax-AI/MiniMax-H3/blob/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing/SKILL.md>.

## Boundary and success criteria

- T2V, first-frame I2V and first/last-frame requests through
  `/video/polish_prompt` require the three base H3 headings in each bilingual
  prompt: `integrated_multimodal_description`, `overall_soundscape`,
  `non_diegetic_music`.
- Full-reference requests through `/video/polish_r2v_prompt` request the six
  reference headings. Retain the existing allowance for a valid three-field
  MiniMax IR response on that path. Keep Context-IR's existing instruction
  path so local skill formatting rules do not override its provider-native
  output contract.
- The final H3 instruction applies only when the target model is H3.
- Keep rejecting prose or missing fields without applying the draft. Record
  only mode, language and missing heading names when validation fails; never
  log model text, attached images, prompts or credentials.
- Tests compare prompt instructions and validation for both modes, including
  the non-H3 path.
