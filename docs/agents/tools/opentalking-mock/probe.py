"""Run inside the CPU Mock container; synthetic text only, no credentials printed."""
import asyncio
import json
import os
import time
import uuid

import httpx
import numpy as np
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer


async def main():
    base = os.environ.get("MOCK_TEST_BASE", "http://127.0.0.1:18083")
    public = base.startswith("https:")
    pc = RTCPeerConnection(RTCConfiguration(iceServers=[
        RTCIceServer(urls="stun:stun.cloudflare.com:3478")] if public else []))
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
            await pc.setLocalDescription(await pc.createOffer())
            answer = await post(f"/sessions/{sid}/webrtc/offer", {
                "sdp": pc.localDescription.sdp, "type": "offer"})
            await pc.setRemoteDescription(RTCSessionDescription(**answer))
            await post(f"/sessions/{sid}/speak", {"text": "请用中文介绍春夏秋冬，每个季节说两句话。",
                "command_id": str(uuid.uuid4())})
            deadline = time.monotonic() + 100
            while counts["audible"] < 30 and time.monotonic() < deadline:
                await asyncio.sleep(.1)
            assert counts["video"] > 0, "no decoded video"
            assert counts["audible"] >= 30, f"no sustained audible audio: {counts}"
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
                "destroy_http": state.status_code, "destroy_state": payload.get("state"),
                "scope": "public WebRTC" if public else "same-host WebRTC"}))
        finally:
            if sid:
                await request("DELETE", f"/sessions/{sid}")
            await pc.close()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


asyncio.run(main())
