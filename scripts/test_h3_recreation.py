"""Preview or submit one H3 recreation request without deploying iframe.

The script is intentionally URL based: references must be public HTTP(S) URLs
(the same signed URLs used by the iframe worker). By default it only prints the
compiled prompt and request contract. Pass --submit to create one provider task.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.apps.recreation.prompt_contract import compile_h3
from src.models.uniart import UniArtVideoModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--description", required=True)
    parser.add_argument("--instruction", required=True)
    parser.add_argument("--reference-image-url", action="append", required=True)
    parser.add_argument("--replacement-image-url", required=True)
    parser.add_argument("--video-url", required=True)
    parser.add_argument("--duration", type=int, default=5)
    parser.add_argument("--resolution", default="720p", choices=("720p", "2k"))
    parser.add_argument("--ratio", default="16:9")
    parser.add_argument("--model", default="uniart/minimax-h3-vip")
    parser.add_argument("--submit", action="store_true")
    parser.add_argument("--output", default="h3-recreation-test.mp4")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    images = [*args.reference_image_url, args.replacement_image_url]
    prompt, errors = compile_h3(
        args.description,
        args.instruction,
        replacement=True,
        duration=args.duration,
        audio_policy="silent",
        soundscape="",
        source_video=True,
    )
    if errors:
        raise SystemExit("prompt contract errors: " + ", ".join(errors))
    contract = {
        "model": args.model.removeprefix("uniart/"),
        "mode": "reference2video",
        "duration": args.duration,
        "resolution": args.resolution,
        "ratio": args.ratio,
        "reference_images": images,
        "reference_videos": [args.video_url],
        "reference_audios": [],
    }
    print(json.dumps({"contract": contract, "prompt": prompt}, ensure_ascii=False, indent=2))
    if not args.submit:
        return 0
    key = os.getenv("UNIART_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        raise SystemExit("set UNIART_API_KEY before --submit")
    config = {"api_key": key, "base_url": os.getenv("UNIART_BASE_URL", "https://uniart.fun/v1")}
    UniArtVideoModel(config).generate(
        prompt,
        str(Path(args.output)),
        model=args.model,
        mode="reference2video",
        duration=args.duration,
        resolution=args.resolution,
        ratio=args.ratio,
        generate_audio=False,
        ref_image_urls=images,
        ref_video_urls=[args.video_url],
    )
    print(json.dumps({"status": "completed", "output": str(Path(args.output).resolve())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
