"""Smoke owner-scoped finance ingestion on a disposable iFrame candidate API.

Set IFRAME_FINANCE_SMOKE_OWNER_A_TOKEN and IFRAME_FINANCE_SMOKE_OWNER_B_TOKEN.
The script creates a collection and source; run it only against a disposable
candidate or an explicitly designated test owner environment.
"""

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import requests


def request(session, method, url, token, expected, **kwargs):
    response = session.request(
        method, url, headers={"Authorization": f"Bearer {token}"},
        timeout=15, allow_redirects=False, **kwargs,
    )
    if response.status_code != expected:
        raise RuntimeError(f"{method} {urlsplit(url).path}: HTTP {response.status_code}, expected {expected}")
    return response.json()


def run(base_url, fixture, owner_a_token, owner_b_token, session=None):
    parsed = urlsplit(base_url)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    ):
        raise ValueError("Base URL must use HTTPS or loopback HTTP")
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or
            parsed.fragment or parsed.path not in ("", "/")):
        raise ValueError("Base URL must be an origin without credentials or query")
    if not owner_a_token or not owner_b_token or owner_a_token == owner_b_token:
        raise ValueError("Two distinct test owner tokens are required")
    if len(fixture.get("units", [])) != 1:
        raise ValueError("Smoke fixture must contain exactly one evidence unit")

    client = session or requests.Session()
    root = base_url.rstrip("/")
    collection = request(client, "POST", f"{root}/knowledge/collections",
                         owner_a_token, 201,
                         json={"name": "SEC filing smoke", "domain": "finance"})
    collection_id = collection["id"]
    source_url = f"{root}/knowledge/collections/{collection_id}/sources"
    first = request(client, "POST", source_url, owner_a_token, 201, json=fixture)
    repeated = request(client, "POST", source_url, owner_a_token, 201, json=fixture)
    if repeated["created"] or repeated["revision_id"] != first["revision_id"]:
        raise AssertionError("Repeated import created another revision")

    source_id = first["source_id"]
    source = request(client, "GET", f"{root}/knowledge/sources/{source_id}",
                     owner_a_token, 200)
    unit = fixture["units"][0]
    if (source["source_uri"] != fixture["source_uri"] or
            not any(item["locator"] == unit["locator"] and item["body"] == unit["body"]
                    for item in source["units"])):
        raise AssertionError("Source readback does not match fixture")

    query = {"query": "Apple", "domain": "finance", "collection_id": collection_id}
    hits = request(client, "POST", f"{root}/knowledge/search", owner_a_token,
                   200, json=query)["hits"]
    matching = [hit for hit in hits if hit["source_id"] == source_id and
                hit["locator"] == unit["locator"]]
    if len(matching) != 1 or "2025-09-27" not in matching[0]["excerpt"]:
        raise AssertionError("Owner search did not return cited filing metadata")
    cited_unit_id = matching[0]["unit_id"]
    if cited_unit_id not in {item["id"] for item in source["units"]}:
        raise AssertionError("Search citation does not resolve to the source unit")

    request(client, "GET", f"{root}/knowledge/sources/{source_id}",
            owner_b_token, 404)
    other_hits = request(client, "POST", f"{root}/knowledge/search", owner_b_token,
                         200, json=query)["hits"]
    if other_hits:
        raise AssertionError("Other owner can search the test collection")

    return {"status": "passed", "collection_id": collection_id,
            "source_id": source_id, "revision_id": first["revision_id"],
            "unit_id": cited_unit_id, "repeat_created": False,
            "other_owner_source_status": 404, "other_owner_search_hits": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--fixture", type=Path, default=Path(__file__).resolve().parent.parent /
                        "tests/fixtures/finance_sec_aapl_2025_10k_source.json")
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text())
    result = run(args.base_url, fixture,
                 os.getenv("IFRAME_FINANCE_SMOKE_OWNER_A_TOKEN", ""),
                 os.getenv("IFRAME_FINANCE_SMOKE_OWNER_B_TOKEN", ""))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
