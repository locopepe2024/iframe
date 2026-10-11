import json
import hashlib
from pathlib import Path

import pytest

from scripts.verify_finance_owner_api import run, session_token_for_api_key


FIXTURE = json.loads((Path(__file__).parent / "fixtures" /
                      "finance_sec_aapl_2025_10k_source.json").read_text())


class FakeSession:
    def __init__(self):
        self.calls = []
        self.import_count = 0

    def request(self, method, url, **kwargs):
        token = kwargs["headers"]["Authorization"].removeprefix("Bearer ")
        path = url.removeprefix("http://127.0.0.1:17178")
        self.calls.append((method, path, token))
        if path == "/knowledge/collections":
            return FakeResponse(201, {"id": "collection-a"})
        if path == "/knowledge/collections/collection-a/sources":
            self.import_count += 1
            return FakeResponse(201, {"created": self.import_count == 1,
                                      "source_id": "source-a", "revision_id": "revision-a"})
        if path == "/knowledge/sources/source-a":
            if token == "owner-b":
                return FakeResponse(404, {})
            return FakeResponse(200, {"source_uri": FIXTURE["source_uri"],
                                      "units": [{**FIXTURE["units"][0], "id": "unit-a"}]})
        if path == "/knowledge/search":
            hits = [] if token == "owner-b" else [{"source_id": "source-a",
                    "locator": FIXTURE["units"][0]["locator"], "unit_id": "unit-a",
                    "excerpt": FIXTURE["units"][0]["body"]}]
            return FakeResponse(200, {"hits": hits})
        raise AssertionError(f"Unexpected request: {method} {path}")


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self.payload = payload

    def json(self):
        return self.payload


def test_single_owner_smoke_marks_isolation_pending():
    session = FakeSession()
    result = run("http://127.0.0.1:17178", FIXTURE, "owner-a",
                 session=session, single_owner=True)
    assert result["status"] == "passed"
    assert result["cross_owner"] == "pending"
    assert result["repeat_created"] is False
    assert result["unit_id"] == "unit-a"
    assert len(session.calls) == 5
    assert all(token == "owner-a" for _, _, token in session.calls)


def test_two_owner_smoke_checks_isolation():
    session = FakeSession()
    result = run("http://127.0.0.1:17178", FIXTURE, "owner-a", "owner-b",
                 session=session)
    assert result["cross_owner"] == "passed"
    assert result["other_owner_source_status"] == 404
    assert result["other_owner_search_hits"] == 0
    assert [token for _, _, token in session.calls[-2:]] == ["owner-b", "owner-b"]


def test_two_owner_mode_requires_distinct_tokens_before_writing():
    session = FakeSession()
    with pytest.raises(ValueError, match="Two distinct"):
        run("http://127.0.0.1:17178", FIXTURE, "owner-a", session=session)
    assert session.calls == []


def test_api_key_file_exchanges_only_on_loopback_and_checks_owner(tmp_path):
    key_path = tmp_path / "key"
    key_path.write_text("test-key\n")

    class AuthSession:
        def post(self, url, **kwargs):
            assert url == "http://127.0.0.1:17177/auth/session-token"
            assert kwargs["json"] == {"api_key": "test-key", "ttl_seconds": 900}
            owner = "apikey-" + hashlib.sha256(b"test-key").hexdigest()
            return FakeResponse(200, {"auth_mode": "api_key_session",
                                      "owner_profile_id": owner,
                                      "access_token": "iframe-session.test.signature"})

    session = AuthSession()
    assert session_token_for_api_key("http://127.0.0.1:17177", key_path, session).startswith(
        "iframe-session.")
    with pytest.raises(ValueError, match="loopback HTTP origin"):
        session_token_for_api_key("https://candidate.example.com", key_path, session)
    with pytest.raises(ValueError, match="loopback HTTP origin"):
        session_token_for_api_key("http://127.0.0.1:17177/other", key_path, session)

    class WrongOwnerSession:
        def post(self, url, **kwargs):
            return FakeResponse(200, {"auth_mode": "api_key_session",
                                      "owner_profile_id": "apikey-other",
                                      "access_token": "iframe-session.test.signature"})

    with pytest.raises(RuntimeError, match="owner or mode"):
        session_token_for_api_key("http://127.0.0.1:17177", key_path,
                                  WrongOwnerSession())
