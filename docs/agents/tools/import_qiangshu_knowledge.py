"""Import the reviewed qiangshu seed through the owner-scoped knowledge API."""

import argparse
import hashlib
import json
from pathlib import Path

import requests
from dotenv import dotenv_values


DEFAULT_SEED = Path(__file__).resolve().parents[1] / "context/2026-10-11-qiangshu-knowledge-seed-v1.json"


def request_json(session, method, url, **kwargs):
    response = session.request(method, url, timeout=30, **kwargs)
    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Reachable iFrame backend URL")
    parser.add_argument("--key-env-file", type=Path, required=True, help="Local dotenv file with UNIART_API_KEY")
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED)
    args = parser.parse_args()

    api_key = (dotenv_values(args.key_env_file).get("UNIART_API_KEY") or "").strip()
    if not api_key:
        raise SystemExit("UNIART_API_KEY is missing")
    seed = json.loads(args.seed.read_text())
    base = args.base_url.rstrip("/")
    session = requests.Session()
    session.headers.update({"X-iFrame-API-Key-Identity": hashlib.sha256(api_key.encode()).hexdigest()})

    identity = request_json(session, "GET", f"{base}/auth/me")
    owner = identity["profile"]["profile_id"]
    if not owner.startswith("apikey-"):
        raise RuntimeError("Knowledge import did not resolve to an API-key workspace")

    collections = request_json(session, "GET", f"{base}/knowledge/collections")["collections"]
    matches = [item for item in collections if item["scope"] == "owner"
               and item["name"] == seed["collection"]["name"]
               and item["domain"] == seed["collection"]["domain"]]
    if len(matches) > 1:
        raise RuntimeError("Multiple matching owner collections")
    collection = matches[0] if matches else request_json(
        session, "POST", f"{base}/knowledge/collections", json=seed["collection"]
    )
    collection_id = collection["id"]

    imports = []
    for source in seed["sources"]:
        result = request_json(
            session, "POST", f"{base}/knowledge/collections/{collection_id}/sources", json=source
        )
        persisted = request_json(session, "GET", f"{base}/knowledge/sources/{result['source_id']}")
        if persisted["revision_id"] != result["revision_id"]:
            raise RuntimeError("Readback revision differs from imported revision")
        if {item["locator"] for item in persisted["units"]} != {
            item["locator"] for item in source["units"]
        }:
            raise RuntimeError("Readback locators differ from seed")
        repeated = request_json(
            session, "POST", f"{base}/knowledge/collections/{collection_id}/sources", json=source
        )
        if repeated["created"] or repeated["revision_id"] != result["revision_id"]:
            raise RuntimeError("Repeated import was not idempotent")
        imports.append({"source_id": result["source_id"], "revision_id": result["revision_id"],
                        "created": result["created"], "units": len(result["units"])})

    searches = {}
    for query in ("扎枪", "头颈"):
        hits = request_json(session, "POST", f"{base}/knowledge/search", json={
            "query": query, "domain": seed["collection"]["domain"],
            "collection_id": collection_id, "limit": 20,
        })["hits"]
        if not hits:
            raise RuntimeError(f"No search hits for {query}")
        searches[query] = [hit["locator"] for hit in hits]

    print(json.dumps({"owner_prefix": owner[:19], "collection_id": collection_id,
                      "imports": imports, "search_locators": searches}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
