"""Neural speech gate before recognition; never decides intent from recognized words."""
from pathlib import Path

import numpy as np


class SpeechGate:
    def __init__(self, model_path):
        import sherpa_onnx
        if not Path(model_path).is_file():
            raise RuntimeError('Silero VAD model is required')
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = str(model_path)
        config.silero_vad.threshold = .5
        config.silero_vad.min_silence_duration = .25
        config.silero_vad.min_speech_duration = .25
        config.silero_vad.max_speech_duration = 20
        config.sample_rate = 16000
        config.num_threads = 1
        self.window = config.silero_vad.window_size
        self.vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)

    def inspect(self, samples, rate):
        # VAD uses 16kHz mono; ASR retains the original waveform. Linear
        # interpolation is deliberately limited to this detection branch.
        if rate != 16000:
            samples = np.interp(np.arange(round(len(samples) * 16000 / rate)) * rate / 16000,
                                np.arange(len(samples)), samples).astype(np.float32)
        self.vad.reset()
        speech_samples = 0
        try:
            for start in range(0, len(samples), self.window):
                frame = samples[start:start + self.window]
                if len(frame) < self.window:
                    frame = np.pad(frame, (0, self.window - len(frame)))
                self.vad.accept_waveform(frame)
                while not self.vad.empty():
                    speech_samples += len(self.vad.front.samples)
                    self.vad.pop()
            self.vad.flush()
            while not self.vad.empty():
                speech_samples += len(self.vad.front.samples)
                self.vad.pop()
            seconds = speech_samples / 16000
            return dict(detector='silero_vad', speech_detected=seconds >= .25,
                        speech_seconds=round(seconds, 3))
        finally:
            self.vad.reset()
