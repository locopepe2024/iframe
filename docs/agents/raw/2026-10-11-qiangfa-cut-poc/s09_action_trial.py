"""Submit and collect isolated s09 trials; never resubmit an uncertain task."""

import argparse
import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import requests

import qiangfa2_gray_full as base
from scripts.check_h3_prompt import check_prompt
from src.models.uniart import _result_urls
from src.utils.cos_storage import COSImageUploader


WORK = base.WORK
PROMPT = WORK / "s09-action-v2-prompt.md"
VARIANTS = {
    "action-v2": ("s09-motion.mp4", "2e4324bd6284878954323fbe9a6c86edd4c178c43cecc168385d44aad3dd2a3c"),
    "precut-hold-v3": ("s09-precut-hold-motion.mp4", "3432559a74ca78fa37426722fecbfcdb5453f8e75541d31a330e762061afed47"),
}


def paths_for(variant):
    motion_name, motion_hash = VARIANTS[variant]
    return (WORK / f"s09-{variant}-generation.json",
            WORK / f"s09-{variant}-replacement.mp4",
            WORK / motion_name, motion_hash)


def submit(variant):
    record_path, _, motion, motion_hash = paths_for(variant)
    if record_path.exists():
        raise RuntimeError("Trial record exists; collect or inspect it before another submission")
    base.verified_sources()
    prompt = PROMPT.read_text(encoding="utf-8")
    errors = check_prompt(prompt, duration=4, pictures=1, videos=1, audios=0,
                          silent=True, cuts=[112 / 30])
    if errors:
        raise RuntimeError(f"Prompt structure failed: {errors}")
    if base.sha256(motion) != motion_hash:
        raise RuntimeError("s09 motion input changed")
    headers = base.credentials()
    uploader = COSImageUploader()
    urls = {}
    with tempfile.TemporaryDirectory() as directory:
        for role, source in (("identity", base.TARGET), ("motion", motion)):
            copy = Path(directory) / f"s09-{variant}-{role}-{base.sha256(source)[:12]}{source.suffix}"
            shutil.copyfile(source, copy)
            key = uploader.upload_file(str(copy), sub_path="image-edit-inputs/qiangfa2-s09-action-20261013")
            if not key:
                raise RuntimeError(f"COS upload failed for {role}")
            urls[role] = uploader.sign_url_for_api(key)
            if not urls[role]:
                raise RuntimeError(f"COS signing failed for {role}")
    body = {
        "model": "minimax-h3-vip", "mode": "reference2video", "duration": 4,
        "resolution": "720p", "ratio": "16:9", "generate_audio": False,
        "seed": 20261011,
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "role": "reference_image", "image_url": {"url": urls["identity"]}},
            {"type": "video_url", "role": "reference_video", "video_url": {"url": urls["motion"]}},
        ],
    }
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "status": "submission_started", "task_id": None, "segment": "s09", "variant": variant,
        "source_sha256": base.SOURCE_SHA, "target_sha256": base.TARGET_SHA,
        "motion_sha256": motion_hash, "prompt_sha256": base.sha256(PROMPT),
        "model": body["model"], "mode": body["mode"], "duration": body["duration"],
        "resolution": body["resolution"], "ratio": body["ratio"],
        "generate_audio": body["generate_audio"], "seed": body["seed"],
    }
    base.write_json(record_path, record)
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.post(base.API, headers=headers, json=body, timeout=120)
        payload = response.json()
        task_id = payload.get("task_id") or payload.get("id")
        record.update(http_status=response.status_code, task_id=task_id,
                      status="submitted" if response.ok and task_id else "submission_failed")
        if record["status"] == "submission_failed":
            record["provider_error"] = payload.get("error") or response.text[:500]
    except (requests.RequestException, ValueError) as exc:
        record.update(status="submission_uncertain", provider_error=str(exc))
    base.write_json(record_path, record)
    print(record["status"], record.get("task_id") or "none")


def collect(variant):
    record_path, output_path, _, _ = paths_for(variant)
    record = json.loads(record_path.read_text())
    task_id = record.get("task_id")
    if not task_id:
        raise RuntimeError("No task ID; inspect submission before any retry")
    headers = base.credentials()
    session = requests.Session()
    session.trust_env = False
    response = session.get(f"{base.API}/{task_id}", headers=headers, timeout=40)
    if response.status_code == 500 and "convert_to_openai_video_failed" in response.text:
        response = session.get(f"https://uniart.fun/v1/video/generations/{task_id}",
                               headers=headers, timeout=40)
        response.raise_for_status()
        envelope = response.json()
        if envelope.get("code") != "success" or not isinstance(envelope.get("data"), dict):
            raise RuntimeError("Generic task query did not return task data")
        payload = envelope["data"]
        record["query_fallback"] = "generic_video_task"
    else:
        response.raise_for_status()
        payload = response.json()
    status = str(payload.get("status") or "unknown").lower()
    status = {"success": "completed", "failure": "failed", "in_progress": "processing"}.get(status, status)
    record["status"] = status
    if status in base.FAILURE:
        record["provider_error"] = payload.get("error") or payload.get("fail_reason")
    if status in base.SUCCESS and not output_path.exists():
        last_error = None
        for url in _result_urls(payload, "video") + [f"{base.API}/{task_id}/content"]:
            try:
                with requests.get(url, headers=headers if url.startswith(base.API) else {},
                                  timeout=(20, 60), stream=True) as result:
                    result.raise_for_status()
                    if "json" in result.headers.get("Content-Type", ""):
                        raise RuntimeError("Video content endpoint returned JSON")
                    temporary = output_path.with_suffix(".mp4.part")
                    with temporary.open("wb") as stream:
                        for chunk in result.iter_content(65536):
                            if chunk:
                                stream.write(chunk)
                temporary.replace(output_path)
                record["output_path"] = output_path.name
                record["output_sha256"] = base.sha256(output_path)
                break
            except (requests.RequestException, RuntimeError) as exc:
                last_error = exc
        else:
            base.write_json(record_path, record)
            raise RuntimeError(f"Completed task output unavailable: {last_error}")
    base.write_json(record_path, record)
    print(status, record.get("output_path") or "none")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("submit", "collect"))
    parser.add_argument("--variant", choices=VARIANTS, default="action-v2")
    args = parser.parse_args()
    {"submit": submit, "collect": collect}[args.action](args.variant)
