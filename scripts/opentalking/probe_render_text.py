"""Run inside the CPU Mock container; synthetic text only, no credentials printed."""
import asyncio
import json
import os
import time
import uuid

import httpx
import numpy as np
from aioice.ice import TransportPolicy
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer, RTCBundlePolicy


async def main():
    base = os.environ.get("MOCK_TEST_BASE", "http://127.0.0.1:18083")
    public = base.startswith("https:")
    relay = os.environ.get("MOCK_TEST_RELAY") == "1"
    servers = [RTCIceServer(urls="stun:stun.cloudflare.com:3478")] if public else []
    if relay:
        async with httpx.AsyncClient(timeout=20) as config_client:
            config_response = await config_client.get(base.rstrip('/') + '/sessions/webrtc/ice-config')
            config_response.raise_for_status()
            servers = [RTCIceServer(**entry) for entry in config_response.json()['iceServers']
                       if any(url.startswith('turn:') for url in
                              (entry['urls'] if isinstance(entry['urls'], list) else [entry['urls']]))]
            assert servers, 'TURN missing in runtime config'
            transport = os.environ.get('MOCK_TEST_TURN_TRANSPORT', 'tcp')
            for server in servers:
                urls = server.urls if isinstance(server.urls, list) else [server.urls]
                server.urls = [url for url in urls if f'transport={transport}' in url]
            servers = [server for server in servers if server.urls]
            assert servers, 'requested TURN transport missing'
    pc = RTCPeerConnection(RTCConfiguration(iceServers=servers,
        bundlePolicy=RTCBundlePolicy.MAX_BUNDLE if os.environ.get('MOCK_TEST_MAX_BUNDLE') == '1'
        else RTCBundlePolicy.BALANCED))
    counts = {"video": 0, "audio": 0, "audible": 0}
    samples = []
    tasks = []
    sid = None

    @pc.on("track")
    def on_track(track):
        async def consume():
            while True:
                frame = await track.recv()
                counts[track.kind] += 1
                if track.kind == "audio":
                    peak = int(np.abs(frame.to_ndarray().astype(np.int32)).max())
                    samples.append((time.monotonic(), peak))
                    if peak > 100:
                        counts["audible"] += 1
        tasks.append(asyncio.create_task(consume()))

    # Keep a subpath base: httpx discards it when request paths start with '/'.
    async with httpx.AsyncClient(timeout=120) as client:
        async def request(method, path, **kwargs):
            return await client.request(method, base.rstrip('/') + path, **kwargs)
        async def post(path, data=None):
            response = await request("POST", path, json=data)
            response.raise_for_status()
            return response.json()

        try:
            created = await post("/sessions", {"avatar_id": "office-woman", "model": "mock",
                "agent_enabled": False, "memory_enabled": False, "knowledge_enabled": False})
            sid = created["session_id"]
            await post(f"/sessions/{sid}/start")
            pc.addTransceiver("video", direction="recvonly")
            pc.addTransceiver("audio", direction="recvonly")
            if relay:
                # aiortc lacks browser iceTransportPolicy; force aioice gathering
                # to relay-only and assert the SDP contains no direct candidates.
                for transceiver in pc.getTransceivers():
                    connection = transceiver.sender.transport.transport.iceGatherer._connection
                    connection._transport_policy = TransportPolicy.RELAY
            await pc.setLocalDescription(await pc.createOffer())
            if relay:
                candidates = [line for line in pc.localDescription.sdp.splitlines()
                              if line.startswith('a=candidate:')]
                assert candidates and all(' typ relay' in line for line in candidates), 'not relay-only'
            answer = await post(f"/sessions/{sid}/webrtc/offer", {
                "sdp": pc.localDescription.sdp, "type": "offer"})
            await pc.setRemoteDescription(RTCSessionDescription(**answer))
            early_hold = int(os.environ.get('MOCK_TEST_EARLY_HOLD', '0'))
            if early_hold:
                await asyncio.sleep(early_hold)
                assert pc.connectionState == 'connected', f'idle connection lost: {pc.connectionState}'
            await post(f"/sessions/{sid}/speak", {"text": "第一轮语音测试，我是小安，很高兴见到您。",
                "render_text": True, "command_id": str(uuid.uuid4())})
            deadline = time.monotonic() + 100
            while counts["audible"] < 30 and time.monotonic() < deadline:
                await asyncio.sleep(.1)
            assert counts["video"] > 0, "no decoded video"
            assert counts["audible"] >= 30, f"no sustained audible audio: {counts}"
            hold = int(os.environ.get('MOCK_TEST_HOLD_SECONDS', '0'))
            if hold:
                await asyncio.sleep(hold)
                assert pc.connectionState == 'connected', f'connection lost during hold: {pc.connectionState}'
                previous = counts['audible']
                await post(f'/sessions/{sid}/speak', {'text': '第二轮连接测试成功，语音连接保持不变。',
                    'render_text': True, 'command_id': str(uuid.uuid4())})
                deadline = time.monotonic() + 100
                while counts['audible'] < previous + 30 and time.monotonic() < deadline:
                    await asyncio.sleep(.1)
                assert counts['audible'] >= previous + 30, 'no second-round audio after hold'
            interrupted = time.monotonic()
            await post(f"/sessions/{sid}/interrupt")
            await asyncio.sleep(3)
            tail = [peak for at, peak in samples if at > interrupted + 1.5]
            assert pc.connectionState == "connected", pc.connectionState
            assert not tail or max(tail) <= 100, f"audio persisted after interrupt: {max(tail)}"
            response = await request("DELETE", f"/sessions/{sid}")
            response.raise_for_status()
            await asyncio.sleep(2)
            state = await request("GET", f"/sessions/{sid}")
            payload = state.json()
            assert state.status_code == 404 or payload.get("state") == "closed", payload
            print(json.dumps({"decoded_frames": counts, "interrupt_tail_peak": max(tail, default=0),
                "interrupt_tail_frames": len(tail),
                "hold_seconds": hold,
                "destroy_http": state.status_code, "destroy_state": payload.get("state"),
                "scope": "public relay-only WebRTC " + transport if relay else
                         "public WebRTC" if public else "same-host WebRTC"}))
        finally:
            if sid:
                await request("DELETE", f"/sessions/{sid}")
            await pc.close()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


asyncio.run(main())
