import json
from pathlib import Path

import pytest

from scripts.verify_finance_owner_api import run


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
