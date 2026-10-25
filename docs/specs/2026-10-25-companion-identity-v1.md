# 陪伴助手身份设置 v1

Demo settings under 更多 → 陪伴助手: name, preset avatar, TTS voice. Browser localStorage is the demo persistence boundary; no account sync or private avatar upload in this slice. Default identity is 小安 / 🌿 / longanhuan_v3.6.

The identity is rendered in the chat header and assistant bubbles. Speech playback sends the selected voice through the existing authenticated UniArt speech route; backend accepts an allowlisted voice only and keeps the default for omitted voice. Browser avatar choices are deliberately visual presets, not evidence of a generated or uploaded character.

Tests cover malformed storage fallback, atomic identity updates, assistant rendering integration, and both supported TTS voice payloads. Future account persistence, custom uploaded avatar, voice preview/catalog, and caregiver voiceprint are separate work.
