# Compact voice controls

- Stop reply interrupts only current/queued playback, keeps WebRTC alive and microphone listening; mute immediately while server clears buffered media. Next explicit reply unmutes.
- Microphone remains the single capture toggle. Starting a new chat capture run resets the OpenTalking connection without replaying old replies; next new reply opens a fresh session. Stopping capture flushes pending ASR, and stops current playback.
- Show capture/processing/playback/connection feedback inside the composer. Keep typed drafts intact; never put status text in submitted value.
- Remove always-visible sound diagnostics and media retry controls. Keep the browser-required play permission action only when blocked. Show stop-reply icon in composer only while playback is active.
- Preserve failed ASR audio and its explicit retry/discard actions; reconnect must not silently discard it.
- Verify interruption keeps peer alive, mic restart disposes old peer without repeating old speech, inline status preserves draft, and regression/typecheck/build.
