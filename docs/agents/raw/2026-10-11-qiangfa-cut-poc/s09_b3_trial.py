"""Validate, submit once, and collect the s09 B3 frame-anchor comparison."""

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

from scripts.check_h3_prompt import check_prompt
from src.models.uniart import _result_urls
from src.utils.cos_storage import COSImageUploader


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[3]
LABEL = "B3"
SOURCE = ROOT / "qiangfa2-gray-full/s09-motion.mp4"
IDENTITY = Path("/Users/owen/Downloads/白模/枪法.png")
PROMPT = ROOT / "qiangfa2-gray-full/s09-label-ab-video-editing-frame-anchors-b3.md"
MANIFEST = ROOT / "s09-label-ab-manifest.json"
RECORD = ROOT / "s09-label-ab-B3-generation.json"
OUTPUT = ROOT / "s09-label-ab-B3-replacement.mp4"
API = "https://uniart.fun/v1/videos"
IDENTITY_SHA256 = "43c2a7db056c523024c916423f13ad32c093c8410abbbee9c3cef8e0d12aefb8"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_record(record):
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")


def preflight():
    manifest = json.loads(MANIFEST.read_text())
    group = manifest["groups"][LABEL]
    if group["status"] not in {"offline_draft_not_submitted", "submitted", "completed",
                               "completed_failed_visual_review_wrong_identity_input"}:
        raise RuntimeError(f"Unexpected {LABEL} manifest status")
    if sha256(SOURCE) != manifest["source_sha256"]:
        raise RuntimeError("Source hash changed")
    if sha256(IDENTITY) != IDENTITY_SHA256:
        raise RuntimeError("Identity hash changed")
    if sha256(PROMPT) != group["prompt_sha256"]:
        raise RuntimeError("Prompt hash changed")
    prompt = PROMPT.read_text().strip()
    errors = check_prompt(prompt, duration=4, pictures=1, videos=1, audios=0,
                          silent=True, cuts=[112 / 30])
    if errors:
        raise RuntimeError(f"Prompt contract failed: {errors}")
    return prompt


def credentials():
    load_dotenv(PROJECT / ".env")
    load_dotenv(PROJECT / ".env.local")
    token = os.environ.get("UNIART_API_KEY")
    if not token:
        raise RuntimeError("UNIART_API_KEY is not configured")
    return {"Authorization": "Bearer " + token, "Accept-Encoding": "identity"}


def submit():
    prompt = preflight()
    if RECORD.exists():
        raise RuntimeError(f"{LABEL} task record already exists; refusing duplicate submission")
    headers = credentials()
    uploader = COSImageUploader()
    urls = {}
    with tempfile.TemporaryDirectory() as directory:
        for role, source in (("identity", IDENTITY), ("motion", SOURCE)):
            copy = Path(directory) / f"s09-b3-{role}-{sha256(source)[:12]}{source.suffix}"
            shutil.copyfile(source, copy)
            key = uploader.upload_file(str(copy), sub_path=f"image-edit-inputs/s09-{LABEL.lower()}-20261017")
            if not key:
                raise RuntimeError(f"COS upload failed for {role}")
            urls[role] = uploader.sign_url_for_api(key)
            if not urls[role]:
                raise RuntimeError(f"COS signing failed for {role}")
    body = {"model": "minimax-h3-vip", "mode": "reference2video", "duration": 4,
            "resolution": "720p", "ratio": "16:9", "generate_audio": False,
            "seed": 20261011,
            "content": [{"type": "text", "text": prompt},
                        {"type": "image_url", "role": "reference_image", "image_url": {"url": urls["identity"]}},
                        {"type": "video_url", "role": "reference_video", "video_url": {"url": urls["motion"]}}]}
    record = {"timestamp_utc": datetime.now(timezone.utc).isoformat(),
              "status": "submission_started", "label": LABEL,
              "prompt_sha256": sha256(PROMPT), "source_sha256": sha256(SOURCE),
              "identity_sha256": sha256(IDENTITY), "model": body["model"],
              "mode": body["mode"], "duration": body["duration"],
              "resolution": body["resolution"], "ratio": body["ratio"],
              "generate_audio": False, "seed": body["seed"], "task_id": None}
    write_record(record)
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.post(API, headers=headers, json=body, timeout=120)
        payload = response.json()
        task_id = payload.get("task_id") or payload.get("id")
        record.update(http_status=response.status_code, task_id=task_id,
                      status="submitted" if response.ok and task_id else "submission_failed")
        if record["status"] == "submission_failed":
            record["provider_error"] = payload.get("error") or response.text[:500]
    except (requests.RequestException, ValueError) as exc:
        record.update(status="submission_uncertain", provider_error=str(exc))
    write_record(record)
    print(record["status"], record.get("task_id") or "none")


def collect():
    preflight()
    record = json.loads(RECORD.read_text())
    task_id = record.get("task_id")
    if not task_id:
        raise RuntimeError(f"{LABEL} has no task ID")
    headers = credentials()
    session = requests.Session()
    session.trust_env = False
    response = session.get(f"{API}/{task_id}", headers=headers, timeout=40)
    if not response.ok and response.status_code == 500 and "convert_to_openai_video_failed" in response.text:
        response = session.get(f"https://uniart.fun/v1/video/generations/{task_id}",
                               headers=headers, timeout=40)
        response.raise_for_status()
        envelope = response.json()
        if envelope.get("code") != "success" or not isinstance(envelope.get("data"), dict):
            raise RuntimeError("Generic video task query did not return task data")
        payload = envelope["data"]
        record["query_fallback"] = "generic_video_task"
    else:
        response.raise_for_status()
        payload = response.json()
    status = str(payload.get("status") or "unknown").lower()
    status = {"success": "completed", "failure": "failed", "in_progress": "processing"}.get(status, status)
    record.update(status=status, last_query_http_status=response.status_code)
    if status == "completed" and not OUTPUT.exists():
        urls = _result_urls(payload, "video") + [f"{API}/{task_id}/content"]
        last_error = None
        for url in urls:
            try:
                with session.get(url, headers=headers if url.startswith(API) else {},
                                 timeout=(20, 300), stream=True) as result:
                    result.raise_for_status()
                    if "json" in result.headers.get("Content-Type", ""):
                        raise RuntimeError("Video content endpoint returned JSON")
                    temporary = OUTPUT.with_suffix(".mp4.part")
                    with temporary.open("wb") as stream:
                        for chunk in result.iter_content(65536):
                            if chunk:
                                stream.write(chunk)
                temporary.replace(OUTPUT)
                record.update(output_path=OUTPUT.name, output_sha256=sha256(OUTPUT))
                record.pop("download_error", None)
                break
            except (requests.RequestException, RuntimeError) as exc:
                last_error = str(exc)
        if not OUTPUT.exists():
            record["download_error"] = last_error
    elif status == "failed":
        record["provider_error"] = payload.get("error") or payload.get("fail_reason")
    write_record(record)
    print(status, task_id, record.get("output_path") or "no_output")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "submit", "collect"))
    action = parser.parse_args().action
    if action == "validate":
        preflight()
        print(f"{LABEL} inputs and prompt valid")
    elif action == "submit":
        submit()
    else:
        collect()


if __name__ == "__main__":
    main()
