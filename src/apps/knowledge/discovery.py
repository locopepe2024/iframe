"""Bounded discovery leads; results are never knowledge citations."""

import json
import os
from datetime import date, timedelta
from urllib.parse import urlsplit

import requests


class DiscoveryUnavailable(Exception):
    pass


def discover(query: str, start_date: str | None = None,
             end_date: str | None = None) -> list[dict]:
    if os.getenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER") != "gdelt":
        raise DiscoveryUnavailable("provider_not_configured")
    if start_date and end_date:
        try:
            start = date.fromisoformat(start_date)
            end = date.fromisoformat(end_date)
        except ValueError as exc:
            raise DiscoveryUnavailable("invalid_date_window") from exc
        if start < date.today() - timedelta(days=90) or end > date.today():
            raise DiscoveryUnavailable("provider_date_window_unsupported")
    try:
        params = {"query": query, "mode": "artlist", "format": "json", "maxrecords": 10,
                  "sort": "datedesc"}
        if start_date and end_date:
            params["startdatetime"] = start_date.replace("-", "") + "000000"
            params["enddatetime"] = end_date.replace("-", "") + "235959"
        response = requests.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params=params,
            timeout=12,
            stream=True,
        )
        try:
            if response.status_code == 429:
                raise DiscoveryUnavailable("rate_limited")
            response.raise_for_status()
            chunks = []
            size = 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 256_000:
                    raise DiscoveryUnavailable("oversized_provider_response")
                chunks.append(chunk)
            payload = json.loads(b"".join(chunks))
            if not isinstance(payload, dict):
                raise DiscoveryUnavailable("invalid_provider_response")
            articles = payload.get("articles", [])
        finally:
            response.close()
    except DiscoveryUnavailable:
        raise
    except (requests.RequestException, ValueError, TypeError) as exc:
        raise DiscoveryUnavailable("provider_failed") from exc
    if not isinstance(articles, list):
        raise DiscoveryUnavailable("invalid_provider_response")
    allowed_hosts = {host.strip().lower() for host in
                     os.getenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "").split(",") if host.strip()}
    results = []
    for item in articles[:10]:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        title = item.get("title")
        if not isinstance(url, str) or not isinstance(title, str):
            continue
        try:
            parsed = urlsplit(url)
        except ValueError:
            continue
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            continue
        results.append({
            "url": url[:2048], "title": title[:300],
            "publisher": str(item.get("domain") or parsed.hostname)[:120],
            "seen_at": str(item.get("seendate") or "")[:40],
            "published_at": None,
            "access_status": "public" if parsed.hostname.lower() in allowed_hosts else "not_allowlisted",
            "provider": "gdelt",
        })
    return results
