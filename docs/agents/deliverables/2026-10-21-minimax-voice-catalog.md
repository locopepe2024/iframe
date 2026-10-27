# MiniMax system voice expansion — 2026-10-21

Scope: iFrame voice metadata and picker only; UniArt owner credentials, allowed speech-2.8-hd/turbo models, binding IDs and audio transport remain unchanged. No user binding migration.

Code fact: the previous 16 options were eight voices repeated under two models. Public official source https://platform.minimaxi.com/docs/faq/system-voice-id (retrieved 2026-10-21) lists 327 unique IDs across 24 language groups, including 58 Mandarin and six Cantonese voices. Store a versioned metadata snapshot in src/audio/minimax_system_voices.json; trim surrounding table whitespace only, preserve case, spaces and punctuation inside IDs. Gender Unknown unless an explicit male/female ID token or the existing eight entries identifies it. Do not infer age/gender from stylistic names. Language filter labels are localized in the UI.

Direct implication: catalog listing and synthesis validation must share the same snapshot. Frontend syntactic compatibility must accept documented spaces, parentheses, underscores and uppercase letters; backend membership and current model permission remain authoritative.

UI: search names/IDs/languages; language selector; distinct voice count separate from model options; render at most 48 cards per model initially, expand explicitly. Keep current selection when filtering. No new voice cloning or external provider fallback.

Success: backend exposes unique complete snapshot per authorized model, rejects unknown IDs before transport, forwards documented IDs unchanged. UI filters/expands without changing selection, saves and previews exact binding. Verify owner HTTP /voices and sample new voices through /voice/preview and protected media after deployment. Official listing is not proof that every voice succeeds on every model; runtime samples establish only tested combinations. No full paid sweep is planned.

Repo-only evidence capture: official table metadata is checked in; promotion to an external vendor archive / Context Hub is deferred. No model catalog YAML changes or routing changes.

Validation: 27 backend tests and 101 related UI tests passed; production build and typecheck passed. Real UniArt samples returned HTTP 200 valid MP3 for HD Chinese (Mandarin)_Gentleman (48,372 bytes), Turbo Cantonese_ProfessionalHost（F) (23,604 bytes), and HD clever_boy (54,132 bytes). These are sample observations, not a full 654-option sweep.
