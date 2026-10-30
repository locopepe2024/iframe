"""Run inside OpenTalking: two adapters must reuse TCP without sharing auth/cookies."""
import asyncio
import io
import wave
from opentalking.providers.tts.openai_compatible import adapter


async def main():
    connections = 0
    headers_seen = []
    writers = set()
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b'\0\0' * 320)
    body = audio.getvalue()

    async def serve(reader, writer):
        nonlocal connections
        connections += 1
        writers.add(writer)
        try:
            while True:
                header = await reader.readuntil(b'\r\n\r\n')
                fields = dict(line.split(':', 1) for line in header.decode().split('\r\n')[1:] if ':' in line)
                fields = {key.lower(): value.strip() for key, value in fields.items()}
                headers_seen.append(fields)
                await reader.readexactly(int(fields.get('content-length', '0')))
                writer.write(f'HTTP/1.1 200 OK\r\nContent-Length: {len(body)}\r\nContent-Type: audio/wav\r\nSet-Cookie: demo=private\r\n\r\n'.encode() + body)
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writers.discard(writer)
            writer.close()

    server = await asyncio.start_server(serve, '127.0.0.1', 0)
    port = server.sockets[0].getsockname()[1]
    try:
        for key in ('first-test-key', 'second-test-key'):
            tts = adapter.OpenAICompatibleTTSAdapter(api_key=key, base_url=f'http://127.0.0.1:{port}', model='test', default_voice='test')
            chunks = [chunk async for chunk in tts.synthesize_stream('test')]
            assert chunks
        assert connections == 1, f'expected pooled TCP, got {connections} connections'
        assert [h['authorization'] for h in headers_seen] == ['Bearer first-test-key', 'Bearer second-test-key']
        assert all('cookie' not in h for h in headers_seen)
        client = adapter._http_client()
        await adapter.close_http_pool()
        assert client.is_closed
        print('PASS: cross-adapter TCP reuse, per-request authorization, no cookies, explicit shutdown')
    finally:
        if hasattr(adapter, 'close_http_pool'):
            await adapter.close_http_pool()
        for writer in list(writers):
            writer.close()
        server.close()
        await server.wait_closed()


asyncio.run(main())
