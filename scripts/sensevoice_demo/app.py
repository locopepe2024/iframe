"""Isolated CPU experiment. Never persists recordings or updates user memory."""
import asyncio
import io
import os
import re
import threading
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from speech_gate import SpeechGate
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MAX_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 20
TAG = re.compile(r"<\|([^|<>]+)\|>")
EMOTIONS = {"HAPPY", "SAD", "ANGRY", "NEUTRAL", "FEARFUL", "DISGUSTED", "SURPRISED"}
LOCK = threading.Lock()


def read_wav(body: bytes):
    try:
        with wave.open(io.BytesIO(body), "rb") as source:
            channels, width, rate, count = (source.getnchannels(), source.getsampwidth(),
                                            source.getframerate(), source.getnframes())
            if channels not in (1, 2) or width != 2 or not 8000 <= rate <= 48000:
                raise ValueError("需要 16-bit PCM WAV，单声道或双声道，8–48 kHz。")
            duration = count / rate
            if not 0.3 <= duration <= MAX_SECONDS:
                raise ValueError("请提供 0.3–20 秒的录音。")
            pcm = source.readframes(count)
            if len(pcm) != count * channels * width:
                raise ValueError("WAV 音频数据不完整。")
    except (wave.Error, EOFError) as exc:
        raise ValueError("请提供有效的 PCM WAV 文件。") from exc
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(axis=1)
    return samples, rate, duration


def describe(result):
    """Preserve model labels; do not invent probability or infer from text."""
    raw_text = result.text
    tokens = list(getattr(result, "tokens", []))
    tags = list(dict.fromkeys(TAG.findall(raw_text) + [
        match for token in tokens for match in TAG.findall(token)
    ]))
    emotion_raw = getattr(result, "emotion", "") or next((tag for tag in tags if tag.upper() in EMOTIONS), "")
    emotion = emotion_raw.replace("<|", "").replace("|>", "").upper()
    event = getattr(result, "event", "") or ""
    language = getattr(result, "lang", "") or ""
    tags = list(dict.fromkeys(tags + TAG.findall(emotion_raw + event + language)))
    return {
        "text": TAG.sub("", raw_text).strip(),
        "raw_text": raw_text,
        "raw_tags": tags,
        "raw_emotion": emotion_raw or None,
        "emotion_hint": emotion.lower() if emotion in EMOTIONS else "unknown",
        "confidence": None,
        "raw_event": event or None,
        "language": language or None,
    }


@asynccontextmanager
async def lifespan(app):
    import sherpa_onnx
    root = Path(os.getenv("SENSEVOICE_MODEL_DIR", "/srv/lumenx/sensevoice-demo/models/" + MODEL_NAME))
    started = time.perf_counter()
    app.state.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(root / "model.int8.onnx"), tokens=str(root / "tokens.txt"),
        num_threads=2, use_itn=True, debug=False, provider="cpu",
    )
    app.state.speech_gate = SpeechGate(os.getenv("SENSEVOICE_VAD_MODEL", str(root.parent / "silero_vad.onnx")))
    app.state.load_ms = round((time.perf_counter() - started) * 1000, 1)
    yield
    app.state.recognizer = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/")
def page():
    return FileResponse(Path(__file__).with_name("index.html"), headers={"Cache-Control": "no-store"})


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "device": "cpu", "threads": 2,
            "model_load_ms": app.state.load_ms, "max_audio_seconds": MAX_SECONDS,
            "stores_audio": False, "speech_detector": "silero_vad", "connected_to_chat": True}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    started = time.perf_counter()
    try:
        body = await file.read(MAX_BYTES + 1)
    finally:
        await file.close()
    if len(body) > MAX_BYTES:
        raise HTTPException(413, "录音文件不能超过 4 MB。")
    try:
        samples, rate, duration = read_wav(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not LOCK.acquire(blocking=False):
        raise HTTPException(429, "正在分析上一段录音，请稍后再试。")

    def infer():
        try:
            evidence = app.state.speech_gate.inspect(samples, rate)
            if not evidence['speech_detected']:
                return {"text": "", "raw_text": "", "raw_tags": [], "raw_emotion": None,
                        "emotion_hint": "unknown", "confidence": None, "raw_event": None,
                        "language": None, "status": "no_speech", "speech_evidence": evidence,
                        "model": MODEL_NAME, "duration_seconds": round(duration, 3),
                        "inference_ms": 0, "total_ms": round((time.perf_counter()-started)*1000, 1)}
            stream = app.state.recognizer.create_stream()
            stream.accept_waveform(rate, samples)
            tick = time.perf_counter()
            app.state.recognizer.decode_stream(stream)
            inference_ms = (time.perf_counter() - tick) * 1000
            result = describe(stream.result)
            # Silence can produce model labels; those are not useful emotion evidence.
            rms = float(np.sqrt(np.mean(samples * samples)))
            if rms < 0.0001:
                result.update(text="", emotion_hint="unknown", status="insufficient_audio")
            else:
                result["status"] = "ok" if result["text"] else "no_text"
            return {**result, "speech_evidence": evidence, "model": MODEL_NAME, "duration_seconds": round(duration, 3),
                    "inference_ms": round(inference_ms, 1),
                    "total_ms": round((time.perf_counter() - started) * 1000, 1),
                    "real_time_factor": round(inference_ms / 1000 / duration, 3)}
        finally:
            # Held by the worker until inference finishes, even if HTTP is cancelled.
            LOCK.release()

    try:
        return await asyncio.to_thread(infer)
    except Exception as exc:
        raise HTTPException(503, "本次分析未完成，请稍后重试。") from exc
