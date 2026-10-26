"""Replay synthetic scenarios through the backend; subjective quality stays unscored."""
from contextlib import ExitStack
from datetime import datetime, timezone
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit
import uuid
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from fastapi.testclient import TestClient
import requests

from scripts.companion_eval.check_cases import DEFAULT, validate
from src.apps.companion_runtime import api, model
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.identity import UserContext, require_user_context

SUPPORTED = {"P01", "P03", "D04", "M01", "M02"}
RESPONSES = ROOT / "tests/fixtures/companion_character/responses.synthetic.json"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def snapshot(store):
    with store.connection() as db:
        return {name: [dict(row) for row in db.execute(f"SELECT * FROM {name}").fetchall()]
                for name in ("companion_memories", "companion_diaries")}


def replay_case(case, *, mode, base_url, api_key, model_name, synthetic):
    record = {"case_id": case["id"], "input": case, "scope": "backend_text_only",
              "human_review": {name: "pending" for name in case["human_review"]},
              "checks": [], "model_calls": [], "model": model_name,
              "transport": "synthetic" if mode == "offline" else "live",
              "clock_application": "storage_only; model_clock_not_injected"}
    if case["requires_audio"]:
        return dict(record, status="not_run_audio", reason="Requires browser/media evidence")
    if case["id"] not in SUPPORTED:
        return dict(record, status="unsupported_state", reason="Required state is not represented by this backend adapter")

    real_post = requests.post

    def post(url, **kwargs):
        if url != base_url.rstrip("/") + "/chat/completions":
            raise RuntimeError("Unexpected model endpoint")
        body = copy.deepcopy(kwargs["json"])
        call = {"request": body, "prompt_sha256": digest(body["messages"][0]["content"])}
        record["model_calls"].append(call)
        started = time.perf_counter()
        try:
            if mode == "offline":
                current = json.loads(body["messages"][1]["content"])["current_message_id"]
                message = json.loads(json.dumps(synthetic[case["id"]]).replace("{{current_message_id}}", current))
                response = requests.Response()
                response.status_code = 200
                response._content = json.dumps({"choices": [{"message": message}]}).encode()
            else:
                response = real_post(url, **kwargs)
            call["http_status"] = response.status_code
            if response.ok:
                call["response_message"] = response.json()["choices"][0]["message"]
            return response
        finally:
            call["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 2)

    configured = SimpleNamespace(
        get_public=lambda _: {"secrets_configured": {"UNIART_API_KEY": True}},
        get_runtime_uniart=lambda _: {"base_url": base_url, "api_key": api_key})
    fixed_time = datetime.fromisoformat(case["clock"]["local_date"]).replace(
        hour=12, tzinfo=ZoneInfo(case["clock"]["timezone"])).timestamp()
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="companion-eval-") as directory, ExitStack() as stack:
        store = ChatStore(Path(directory) / "chat.db", initialize=True, clock=lambda: fixed_time)
        env = {"IFRAME_COMPANION_DB_PATH": "", "IFRAME_COMPANION_USER_CONFIG_DB": str(Path(directory) / "unused.db"),
               "IFRAME_COMPANION_QWEN_MODEL": model_name,
               "IFRAME_COMPANION_PERSONALITY": case["initial_state"].get("profile", "warm_curious")}
        stack.enter_context(patch.dict(os.environ, env))
        stack.enter_context(patch.object(model, "UserConfigStore", return_value=configured))
        stack.enter_context(patch.object(model.requests, "post", side_effect=post))
        app = FastAPI()
        app.include_router(api.router)
        app.dependency_overrides[api.get_store] = lambda: store
        app.dependency_overrides[require_user_context] = lambda: UserContext("eval-actor", "eval-owner", "", "")
        client = stack.enter_context(TestClient(app, raise_server_exceptions=False))
        session = store.session("eval-owner", "create")["session_id"]
        record["session_id"] = session
        for index, text in enumerate(case["context"]):
            store.message("eval-owner", session, f"context-{index}", text)
        record["before"] = snapshot(store)
        response = client.post(f"/companion-runtime/sessions/{session}/chat", json={
            "operation_id": "eval-turn", "text": case["user_text"], "allow_external_text": True})
        record["http_status"] = response.status_code
        # FastAPI's 500 response is deliberately not a JSON diagnostic or secret-bearing traceback.
        output = response.json() if response.headers.get("content-type", "").startswith("application/json") else None
        record["api_response"] = output
        record["turn_id"] = (output or {}).get("turn_id")
        record["after"] = snapshot(store)

        def check(name, passed, evidence):
            record["checks"].append({"name": name, "passed": bool(passed), "evidence": evidence})

        check("no_unconfirmed_persistent_write", record["before"] == record["after"], "Actual memory and diary rows before/after request")
        check("chat_completed", response.status_code == 200, f"HTTP {response.status_code}")
        calls = record["model_calls"]
        messages = json.loads(calls[0]["request"]["messages"][1]["content"]) if calls else {}
        record["utterance_id"] = messages.get("current_message_id")
        sent = [item["text"] for item in messages.get("user_messages", [])]
        check("context_delivered", sent == case["context"] + [case["user_text"]], {"sent_user_messages": sent})
        if case["id"] == "P01":
            prompt = calls[0]["request"]["messages"][0]["content"] if calls else ""
            check("requested_profile_delivered", "温和倾听" in prompt, "Actual system prompt; no assessment of model adherence")
        if case["id"] == "D04":
            check("diary_lane_has_no_memory_tools", bool(calls) and not calls[0]["request"].get("tools"),
                  "Actual tools field of backend model request; UI routing not exercised")
        if case["id"] == "M02":
            result = (output or {}).get("result", {})
            preview = result.get("preview", {})
            check("save_waits_for_confirmation", result.get("status") == "pending_confirmation",
                  "Actual pending preview response; confirmation was not submitted")
            check("preview_binds_current_quote", bool(messages.get("current_message_id")) and
                  preview.get("source_message_id") == messages["current_message_id"] and
                  bool(preview.get("quote")) and preview["quote"] in case["user_text"],
                  "Preview source ID and verbatim quote compared with current request")
    record["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 2)
    failed = any(not item["passed"] for item in record["checks"])
    record["status"] = "checks_failed" if failed else ("synthetic_checks_ok" if mode == "offline" else "awaiting_human_review")
    return record


def run(output, *, mode="offline", cases_path=DEFAULT, base_url="https://eval.invalid/v1", api_key="synthetic-only", model_name="qwen3.8-flash", responses_path=RESPONSES):
    if mode not in ("offline", "live"):
        raise ValueError("Unknown transport mode")
    if mode == "live":
        url = urlsplit(base_url)
        if not api_key or api_key == "synthetic-only" or url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.hostname.endswith(".invalid"):
            raise ValueError("Live transport requires explicit endpoint and credentials")
    started_at = datetime.now(timezone.utc).isoformat()
    cases, errors = validate(cases_path)
    if errors:
        raise ValueError("Invalid cases: " + "; ".join(errors))
    fixture = json.loads(responses_path.read_text()) if mode == "offline" else None
    if fixture is not None and (fixture.get("source") != "synthetic" or not SUPPORTED.issubset(fixture.get("messages", {}))):
        raise ValueError("Explicit synthetic responses are required for every supported case")
    output.mkdir(parents=True, exist_ok=False)
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True))
    except (OSError, subprocess.CalledProcessError):
        revision, dirty = "unknown", None
    run_id = str(uuid.uuid4())
    records = []
    with (output / "records.jsonl").open("x") as stream:
        for case in cases:
            try:
                record = replay_case(case, mode=mode, base_url=base_url, api_key=api_key,
                                     model_name=model_name, synthetic=fixture["messages"] if fixture else None)
            except Exception as exc:
                # Preserve the failing stage without leaking provider URLs, headers or exception strings.
                record = {"case_id": case["id"], "status": "adapter_error", "error_type": type(exc).__name__,
                          "scope": "backend_text_only", "transport": "synthetic" if mode == "offline" else "live",
                          "human_review": "not_evaluated"}
            record["run_id"] = run_id
            records.append(record)
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()
    counts = {status: sum(r["status"] == status for r in records) for status in sorted({r["status"] for r in records})}
    summary = {"schema_version": 1, "run_id": run_id, "started_at_utc": started_at,
               "finished_at_utc": datetime.now(timezone.utc).isoformat(),
               "code_revision": revision, "worktree_dirty": dirty, "mode": mode, "model": model_name,
               "channel_base_url_sha256": digest(base_url),
               "adapter_sha256": digest(Path(__file__).read_text()),
               "source_sha256": {str(path.relative_to(ROOT)): digest(path.read_text()) for path in
                                 sorted((ROOT / "src/apps/companion_runtime").glob("*.py"))},
               "cases_sha256": digest(cases_path.read_text()),
               "synthetic_responses_sha256": digest(responses_path.read_text()) if fixture else None,
               "counts": counts, "total": len(records), "human_quality": "NOT_EVALUATED",
               "full_scenario_pass_rate": None,
               "scope": "Backend text only; no UI, audio, browser or WebRTC evaluation"}
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New directory; existing directories are never overwritten")
    parser.add_argument("--mode", choices=("offline", "live"), default="offline")
    parser.add_argument("--base-url", default="https://eval.invalid/v1")
    parser.add_argument("--model", default="qwen3.8-flash")
    args = parser.parse_args()
    key = "synthetic-only"
    if args.mode == "live":
        url = urlsplit(args.base_url)
        key = os.environ.get("COMPANION_EVAL_API_KEY", "")
        if not key or url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.hostname.endswith(".invalid"):
            parser.error("Live mode needs an explicit HTTPS base URL without credentials/query and COMPANION_EVAL_API_KEY")
    if not args.model.startswith("qwen"):
        parser.error("The current runtime adapter supports Qwen model names only")
    try:
        summary = run(args.output, mode=args.mode, base_url=args.base_url, api_key=key, model_name=args.model)
    except (ValueError, OSError) as exc:
        parser.error(type(exc).__name__ + ": unable to create or validate the run")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 2 if any(summary["counts"].get(name) for name in ("checks_failed", "adapter_error")) else 0


if __name__ == "__main__":
    raise SystemExit(main())
