"""Run with the isolated service venv: python -m unittest -v test_app."""
import io
import unittest
import wave
from types import SimpleNamespace

import numpy as np
from fastapi import HTTPException, UploadFile

import app as service


def wav(seconds=1, sample=1000):
    data = io.BytesIO()
    with wave.open(data, "wb") as source:
        source.setnchannels(1)
        source.setsampwidth(2)
        source.setframerate(16000)
        source.writeframes(np.full(int(seconds * 16000), sample, dtype="<i2").tobytes())
    return data.getvalue()


class AudioTests(unittest.TestCase):
    def test_decodes_pcm_and_duration(self):
        samples, rate, duration = service.read_wav(wav(2))
        self.assertEqual((rate, duration, len(samples)), (16000, 2, 32000))

    def test_rejects_invalid_and_overlong(self):
        for body in (b"not wav", wav(21), wav(.1)):
            with self.subTest(size=len(body)), self.assertRaises(ValueError):
                service.read_wav(body)

    def test_preserves_emotion_and_event_without_inventing_confidence(self):
        result = service.describe(SimpleNamespace(text="今天很高兴。", tokens=[],
            emotion="<|HAPPY|>", event="<|Laughter|>", lang="<|zh|>"))
        self.assertEqual(result["emotion_hint"], "happy")
        self.assertIn("HAPPY", result["raw_tags"])
        self.assertIn("Laughter", result["raw_tags"])
        self.assertIsNone(result["confidence"])

    def test_tags_are_removed_from_text_but_kept_as_metadata(self):
        result = service.describe(SimpleNamespace(text="<|zh|><|SAD|>好吧。", tokens=[]))
        self.assertEqual(result["text"], "好吧。")
        self.assertEqual(result["emotion_hint"], "sad")

    def test_missing_or_unknown_labels_are_unknown(self):
        for emotion in ("", "<|EMO_UNKNOWN|>"):
            result = service.describe(SimpleNamespace(text="我好开心。", tokens=[], emotion=emotion))
            self.assertEqual(result["emotion_hint"], "unknown")


class RequestTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        service.app.state.speech_gate = SimpleNamespace(inspect=lambda *_: dict(speech_detected=True))

    async def test_no_speech_never_calls_asr(self):
        def fail():
            raise AssertionError('ASR must not run on non-speech')
        service.app.state.speech_gate = SimpleNamespace(inspect=lambda *_: dict(speech_detected=False))
        service.app.state.recognizer = SimpleNamespace(create_stream=fail)
        result = await service.analyze(UploadFile(file=io.BytesIO(wav())))
        self.assertEqual(result['status'], 'no_speech')
        self.assertEqual(result['text'], '')
        self.assertFalse(service.LOCK.locked())

    async def test_busy_request_is_rejected_without_running_inference(self):
        service.LOCK.acquire()
        try:
            with self.assertRaises(HTTPException) as caught:
                await service.analyze(UploadFile(file=io.BytesIO(wav())))
            self.assertEqual(caught.exception.status_code, 429)
        finally:
            service.LOCK.release()

    async def test_silence_is_unknown_even_when_model_predicts_neutral(self):
        stream = SimpleNamespace(accept_waveform=lambda *_: None,
            result=SimpleNamespace(text="静音时的幻觉文字", tokens=[], emotion="<|NEUTRAL|>"))
        service.app.state.recognizer = SimpleNamespace(create_stream=lambda: stream,
                                                      decode_stream=lambda *_: None)
        result = await service.analyze(UploadFile(file=io.BytesIO(wav(sample=0))))
        self.assertEqual(result["emotion_hint"], "unknown")
        self.assertEqual(result["status"], "insufficient_audio")
        self.assertEqual(result["text"], "")
        self.assertEqual(result["raw_text"], "静音时的幻觉文字")
        self.assertEqual(result["raw_emotion"], "<|NEUTRAL|>")
        self.assertFalse(service.LOCK.locked())

    async def test_inference_failure_releases_lock(self):
        def fail():
            raise RuntimeError("fake inference failure")
        service.app.state.recognizer = SimpleNamespace(create_stream=fail)
        with self.assertRaises(HTTPException) as caught:
            await service.analyze(UploadFile(file=io.BytesIO(wav())))
        self.assertEqual(caught.exception.status_code, 503)
        self.assertFalse(service.LOCK.locked())


if __name__ == "__main__":
    unittest.main()
