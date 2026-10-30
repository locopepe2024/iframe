"""Synthetic upstream timing; run in CPU Mock with its dotenv loaded. No audio saved."""
import asyncio
import json
import os
import time

import httpx


async def main():
    for fmt in ("wav", "pcm"):
        start = time.monotonic()
        parts = []
        prefix = b""
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", os.environ["OPENTALKING_TTS_OPENAI_BASE_URL"].rstrip("/") + "/audio/speech",
                headers={"Authorization": "Bearer " + os.environ["OPENTALKING_TTS_OPENAI_API_KEY"]},
                json={"model": os.environ["OPENTALKING_TTS_OPENAI_MODEL"],
                      "voice": os.environ["OPENTALKING_TTS_OPENAI_VOICE"], "response_format": fmt,
                      "input": "您好，我是小安。今天我们可以一起整理相册，也可以慢慢聊聊您想记录的事情。"}) as response:
                headers_ms = round((time.monotonic() - start) * 1000)
                if response.status_code != 200:
                    print(json.dumps({"format": fmt, "status": response.status_code, "headers_ms": headers_ms}))
                    continue
                async for data in response.aiter_bytes():
                    if data:
                        prefix = (prefix + data)[:44]
                        parts.append((round((time.monotonic() - start) * 1000), len(data)))
                print(json.dumps({"format": fmt, "status": response.status_code,
                    "content_type": response.headers.get("content-type"), "headers_ms": headers_ms,
                    "first_byte_ms": parts[0][0] if parts else None,
                    "eof_ms": round((time.monotonic() - start) * 1000),
                    "network_parts": len(parts), "bytes": sum(n for _, n in parts),
                    "wav_container": prefix.startswith(b"RIFF") and prefix[8:12] == b"WAVE"}))


if __name__ == "__main__":
    asyncio.run(main())
