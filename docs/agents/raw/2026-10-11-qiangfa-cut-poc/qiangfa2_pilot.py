"""Validate, submit, and collect the single prepared Qiangfa 2 H3 pilot."""

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
MANIFEST = ROOT / "qiangfa2-24p167-28p167-preparation.json"
RECORD = ROOT / "qiangfa2-24p167-28p167-h3-generation.json"
OUTPUT = ROOT / "qiangfa2-24p167-28p167-h3-replacement.mp4"
API = "https://uniart.fun/v1/videos"
SUCCESS = {"completed", "succeeded", "success"}
FAILURE = {"failed", "error", "cancelled", "canceled"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_record(record):
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")


def prepared_inputs():
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get("schema") != "recreation-pilot-preparation.v1":
        raise ValueError("Unexpected pilot manifest schema")
    source = Path(manifest["source"]["path"])
    identity = Path(manifest["target"]["path"])
    motion = ROOT / manifest["motion_reference"]["path"]
    for label, path, expected in (
        ("source", source, manifest["source"]["sha256"]),
        ("identity", identity, manifest["target"]["sha256"]),
        ("motion", motion, manifest["motion_reference"]["sha256"]),
    ):
        if not path.is_file() or sha256(path) != expected:
            raise RuntimeError(f"{label} input is missing or changed")
    plan = manifest["trial_plan"]
    if (manifest["source"]["frame_interval"] != [725, 845]
            or manifest["motion_reference"]["frame_count"] != 120
            or plan["mode"] != "reference2video"
            or plan["requested_duration_seconds"] != 4
            or plan["ratio"] != "16:9"
            or plan["generate_audio"] is not False):
        raise ValueError("Pilot plan differs from the reviewed four-second window")
    prompt = (ROOT / plan["prompt_path"]).read_text(encoding="utf-8").strip()
    cuts = [round(value, 3) for value in manifest["edit_review"]["confirmed_cut_local_seconds"]]
    errors = check_prompt(prompt, duration=4, pictures=1, videos=1, audios=0,
                          silent=True, cuts=cuts)
    if errors:
        raise ValueError(f"H3 prompt contract failed: {', '.join(errors)}")
    return manifest, identity, motion, prompt


def credentials():
    load_dotenv(ROOT.parents[3] / ".env")
    load_dotenv(ROOT.parents[3] / ".env.local")
    token = os.environ.get("UNIART_API_KEY")
    if not token:
        raise RuntimeError("UNIART_API_KEY is not configured")
    return {"Authorization": "Bearer " + token, "Accept-Encoding": "identity"}


def submit():
    if RECORD.exists():
        raise RuntimeError("A pilot generation record already exists; inspect it before retrying")
    manifest, identity, motion, prompt = prepared_inputs()
    headers = credentials()
    uploader = COSImageUploader()
    urls = {}
    with tempfile.TemporaryDirectory() as directory:
        for role, source in (("identity", identity), ("motion", motion)):
            temporary = Path(directory) / f"qiangfa2-{role}-{sha256(source)[:12]}{source.suffix}"
            shutil.copyfile(source, temporary)
            key = uploader.upload_file(str(temporary), sub_path="image-edit-inputs/qiangfa2-pilot-20261011")
            if not key:
                raise RuntimeError(f"COS upload failed for {role}")
            urls[role] = uploader.sign_url_for_api(key)
            if not urls[role]:
                raise RuntimeError(f"COS signing failed for {role}")
    plan = manifest["trial_plan"]
    body = {
        "model": plan["model"], "mode": plan["mode"],
        "duration": plan["requested_duration_seconds"], "resolution": plan["resolution"],
        "ratio": plan["ratio"], "generate_audio": False, "seed": 20261011,
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "role": "reference_image", "image_url": {"url": urls["identity"]}},
            {"type": "video_url", "role": "reference_video", "video_url": {"url": urls["motion"]}},
        ],
    }
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "status": "submission_started", "task_id": None,
        "source_sha256": manifest["source"]["sha256"],
        "target_sha256": manifest["target"]["sha256"],
        "motion_sha256": manifest["motion_reference"]["sha256"],
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "model": body["model"], "mode": body["mode"],
        "duration": body["duration"], "resolution": body["resolution"],
        "ratio": body["ratio"], "generate_audio": False, "seed": body["seed"],
    }
    save_record(record)
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
    save_record(record)
    print("status", record["status"], "task_id", record.get("task_id") or "none")


def collect():
    if not RECORD.exists():
        raise RuntimeError("No pilot generation record")
    record = json.loads(RECORD.read_text())
    task_id = record.get("task_id")
    if not task_id:
        raise RuntimeError("No provider task ID; do not submit a duplicate")
    headers = credentials()
    session = requests.Session()
    session.trust_env = False
    response = session.get(f"{API}/{task_id}", headers=headers, timeout=40)
    response.raise_for_status()
    payload = response.json()
    status = str(payload.get("status") or "unknown").lower()
    record["status"] = status
    if status in FAILURE:
        record["provider_error"] = payload.get("error")
    if status in SUCCESS and not OUTPUT.exists():
        urls = _result_urls(payload, "video") or [f"{API}/{task_id}/content"]
        last_error = None
        for url in urls:
            try:
                download_headers = headers if url.startswith(API) else {}
                with session.get(url, headers=download_headers, timeout=180, stream=True) as result:
                    result.raise_for_status()
                    temporary = OUTPUT.with_suffix(".mp4.part")
                    with temporary.open("wb") as stream:
                        for chunk in result.iter_content(65536):
                            if chunk:
                                stream.write(chunk)
                temporary.replace(OUTPUT)
                record["output_path"] = OUTPUT.name
                record["output_sha256"] = sha256(OUTPUT)
                break
            except requests.RequestException as exc:
                last_error = exc
        else:
            save_record(record)
            raise RuntimeError(f"Task completed but download failed: {last_error}")
    save_record(record)
    print("status", status, "output", record.get("output_path", "none"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "submit", "collect"))
    action = parser.parse_args().action
    if action == "validate":
        prepared_inputs()
        print("Pilot prompt and input hashes valid")
    elif action == "submit":
        submit()
    else:
        collect()


if __name__ == "__main__":
    main()
