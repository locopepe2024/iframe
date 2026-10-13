"""Probe whether the configured UniArt route can parse the s09 video with Kimi."""

import base64
import json
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values

import qiangfa2_gray_full as base


VIDEO = base.WORK / "s09-motion.mp4"
RECORD = base.WORK / "s09-kimi-k3-video-probe-gzip-encoding.json"
MODEL = "kimi-k3-video"
ENDPOINT = "https://uniart.fun/v1/chat/completions"
PROMPT = (
    "只分析本条4秒视频画面。输出JSON，包含："
    "visible_frames（按0.0、0.7、1.3、2.2、2.7、3.3、3.8秒记录可见人物姿态、长枪方向、红缨位置、遮挡/模糊）；"
    "action_candidates（候选动作名称、证据时间段、置信限制）；"
    "cut_candidates（可能的硬切时间及前后视角证据）；"
    "unresolved（不能由视频证实的握点、枪尖路径和动作边界）。"
    "只能写可见证据；不要据武术常识补全，也不要把候选动作当作已确认标注。"
)


def main():
    if RECORD.exists():
        raise RuntimeError("Probe record exists; do not submit a duplicate")
    if base.sha256(VIDEO) != "2e4324bd6284878954323fbe9a6c86edd4c178c43cecc168385d44aad3dd2a3c":
        raise RuntimeError("s09 source video changed")
    token = dotenv_values(base.ROOT.parents[3] / ".env").get("UNIART_API_KEY")
    if not token:
        raise RuntimeError("UNIART_API_KEY is not configured")
    video_b64 = base64.b64encode(VIDEO.read_bytes()).decode("ascii")
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "你是谨慎的视频动作观察员。只报告画面证据和不确定性。"},
            {"role": "user", "content": [
                {"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{video_b64}"}},
                {"type": "text", "text": PROMPT},
            ]},
        ],
        "stream": False,
    }
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "endpoint": ENDPOINT,
        "source_sha256": base.sha256(VIDEO),
        "source_frames": 120,
        "source_fps": 30,
        "input_format": "video_url data:video/mp4;base64",
        "prompt": PROMPT,
        "status": "request_started",
    }
    base.write_json(RECORD, record)
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.post(ENDPOINT, headers={"Authorization": f"Bearer {token}",
                                                   "Accept-Encoding": "gzip, deflate"},
                                json=body, timeout=(20, 300))
        record["http_status"] = response.status_code
        record["content_type"] = response.headers.get("Content-Type")
        record["content_encoding"] = response.headers.get("Content-Encoding")
        try:
            payload = response.json()
        except ValueError:
            record["status"] = "non_json_response"
            record["response_excerpt"] = response.text[:500]
        else:
            if response.ok:
                record["status"] = "completed"
                record["response_model"] = payload.get("model")
                record["usage"] = payload.get("usage")
                record["content"] = payload.get("choices", [{}])[0].get("message", {}).get("content")
            else:
                record["status"] = "rejected"
                record["error"] = payload.get("error") or payload.get("message") or str(payload)[:500]
    except requests.RequestException as exc:
        record["status"] = "request_uncertain"
        record["error"] = str(exc)[:500]
    base.write_json(RECORD, record)
    print(record["status"], record.get("http_status", "no_http_status"))


if __name__ == "__main__":
    main()
