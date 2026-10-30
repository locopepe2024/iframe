"""Verify the shipped adapter with UniArt realtime, synthetic audio discarded."""
import asyncio
import json
import os
import time
from urllib.parse import urlsplit, urlunsplit


async def main():
    if os.getenv("MOCK_TEST_TTS_EVENTS") == "1":
        from dashscope.audio.qwen_tts_realtime import QwenTtsRealtime
        connect = QwenTtsRealtime.connect
        def traced_connect(client):
            callback = client.callback
            original = callback.on_event
            def on_event(event):
                if isinstance(event, dict) and event.get("type") != "response.audio.delta":
                    error = event.get("error") or {}
                    print(json.dumps({"event_type":event.get("type"),
                        "error_code":error.get("code") if isinstance(error, dict) else None}), flush=True)
                original(event)
            callback.on_event = on_event
            return connect(client)
        QwenTtsRealtime.connect = traced_connect
    from opentalking.providers.tts.dashscope_qwen.adapter import DashScopeQwenTTSAdapter

    base = urlsplit(os.environ["OPENTALKING_TTS_OPENAI_BASE_URL"])
    url = urlunsplit(("wss", base.netloc, base.path.rstrip("/") + "/realtime", "", ""))
    os.environ["OPENTALKING_TTS_DASHSCOPE_API_KEY"] = os.environ["OPENTALKING_TTS_OPENAI_API_KEY"]
    if os.getenv("MOCK_TEST_TTS_FACTORY") == "1":
        from opentalking.providers.tts.factory import create_tts_adapter
        adapter = create_tts_adapter(default_voice="longanhuan_v3.6", sample_rate=16000, chunk_ms=400)
        assert isinstance(adapter, DashScopeQwenTTSAdapter), type(adapter).__name__
        assert adapter._ws_url == url
    else:
        adapter = DashScopeQwenTTSAdapter(default_voice="Cherry", sample_rate=16000,
            chunk_ms=400, model="qwen3-tts-flash-realtime", service_url=url)
    try:
        for voice, text in (("longanhuan_v3.6", "您好，我是小安。今天我们可以一起整理相册，也可以慢慢聊聊您想记录的事情。"), ("longanyang_v3.6", "好的，我们接着聊。")):
            if voice == "longanyang_v3.6":
                # Production creates a new adapter when the selected voice changes.
                await adapter.aclose()
                adapter = DashScopeQwenTTSAdapter(default_voice=voice, sample_rate=16000,
                    chunk_ms=400, model="qwen3-tts-flash-realtime", service_url=url)
            start = time.monotonic()
            first = None
            count = 0
            duration = 0
            async with asyncio.timeout(45):
                async for chunk in adapter.synthesize_stream(text, voice=voice):
                    first = first or round((time.monotonic()-start)*1000)
                    count += 1
                    duration += chunk.duration_ms
            assert count and duration > 0, "no decoded audio"
            print(json.dumps({"model":"qwen3-tts-flash-realtime", "voice_choice":voice,"first_pcm_ms":first,
                "done_ms": round((time.monotonic()-start)*1000), "chunks":count,
                "audio_ms":round(duration)}), flush=True)
    finally:
        await adapter.aclose()


if __name__ == "__main__":
    asyncio.run(main())
