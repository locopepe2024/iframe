# SenseVoice speech gate

The service requires the existing sherpa-onnx installation and a Silero VAD model:

- Official API example: https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/vad-remove-non-speech-segments-from-file.py
- Model: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
- Validated SHA256: 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6

Place it beside the SenseVoice model directory, or set SENSEVOICE_VAD_MODEL to an absolute path. Install app.py and speech_gate.py together. Startup fails if the VAD model is absent. Recordings are not persisted. Requests remain serialized by the existing lock; VAD state resets for each request.

A no_speech result has empty text, so the current continuous-capture client does not enqueue a chat turn. There is no word blacklist: real English remains eligible. Detection uses a 0.5 threshold and 0.25-second minimum speech duration; very short or quiet utterances can be missed and need microphone acceptance testing. VAD does not distinguish the user's speech from another speaker or acoustic echo. The existing playback capture gate remains necessary.

Run service unit tests using the isolated service environment:

    python -m unittest -v test_app

Official speech examples in zh/en/yue/ja/ko and a 48kHz resampled Chinese example passed VAD. Synthetic silence, white noise and 440Hz tone were rejected. These are controlled checks, not proof of real room or microphone performance.
