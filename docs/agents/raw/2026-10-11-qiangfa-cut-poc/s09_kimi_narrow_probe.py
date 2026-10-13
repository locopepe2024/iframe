"""Probe Kimi video understanding on the s09 deep-bend window."""

import base64
import json
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values

import qiangfa2_gray_full as base


VIDEO = base.WORK / "s09-kimi-deep-bend-frames-30-89.mp4"
RECORD = base.WORK / "s09-kimi-k3-video-narrow-probe.json"
MODEL = "kimi-k3-video"
ENDPOINT = "https://uniart.fun/v1/chat/completions"
PROMPT = (
    "这是原片局部窗口：原始帧30到89（原片30fps），局部视频时间0.0秒对应原始帧30。"
    "只根据这2秒视频输出JSON：按局部时间0.0、0.5、1.0、1.5、1.9秒记录人物姿态、"
    "枪杆方向、红缨位置和模糊；列出动作候选及对应原始帧区间；说明是否看见硬切。"
    "每个判断都写证据帧和不确定性。不要使用武术常识补全，不要把候选名称当成已确认标注。"
)


def main():
    if RECORD.exists():
        raise RuntimeError("Narrow probe record exists; do not submit a duplicate")
    expected = "b1912bff1e173c82930ddae69b416b94ded3e3ba36005dd4d707d9db6cb048b6"
    if base.sha256(VIDEO) != expected:
        raise RuntimeError("narrow s09 video changed")
    token = dotenv_values(base.ROOT.parents[3] / ".env").get("UNIART_API_KEY")
    if not token:
        raise RuntimeError("UNIART_API_KEY is not configured")
    video_b64 = base64.b64encode(VIDEO.read_bytes()).decode("ascii")
    body = {"model": MODEL, "messages": [
        {"role": "system", "content": "你是谨慎的视频动作观察员，只报告可见证据。"},
        {"role": "user", "content": [
            {"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{video_b64}"}},
            {"type": "text", "text": PROMPT},
        ]},
    ], "stream": False}
    record = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "model": MODEL,
              "endpoint": ENDPOINT, "source_sha256": base.sha256(VIDEO),
              "source_frames": 60, "source_fps": 30, "source_original_frame_range": [30, 90],
              "input_format": "video_url data:video/mp4;base64", "prompt": PROMPT,
              "status": "request_started"}
    base.write_json(RECORD, record)
    session = requests.Session(); session.trust_env = False
    try:
        response = session.post(ENDPOINT, headers={"Authorization": f"Bearer {token}",
                                                   "Accept-Encoding": "gzip, deflate"},
                                json=body, timeout=(20, 300))
        record.update(http_status=response.status_code,
                      content_type=response.headers.get("Content-Type"),
                      content_encoding=response.headers.get("Content-Encoding"))
        try:
            payload = response.json()
        except ValueError:
            record.update(status="non_json_response", response_excerpt=response.text[:500])
        else:
            if response.ok:
                message = payload.get("choices", [{}])[0].get("message", {})
                record.update(status="completed", response_model=payload.get("model"),
                              usage=payload.get("usage"), content=message.get("content"))
            else:
                record.update(status="rejected", error=payload.get("error") or str(payload)[:500])
    except requests.RequestException as exc:
        record.update(status="request_uncertain", error=str(exc)[:500])
    base.write_json(RECORD, record)
    print(record["status"], record.get("http_status", "no_http_status"))


if __name__ == "__main__":
    main()
