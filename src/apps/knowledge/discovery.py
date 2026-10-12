"""Bounded discovery leads; results are never knowledge citations."""

import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from xml.etree import ElementTree

import requests


class DiscoveryUnavailable(Exception):
    pass


FED_RSS_URL = "https://www.federalreserve.gov/feeds/press_all.xml"
FED_HOST = "www.federalreserve.gov"
FED_PATH = "/newsevents/pressreleases/"
QUERY_STOPWORDS = {"and", "board", "federal", "for", "from", "news", "release",
                   "reserve", "the", "with"}


def discover_fed_rss(query: str, start_date: str | None,
                     end_date: str | None) -> list[dict]:
    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError as exc:
        raise DiscoveryUnavailable("invalid_date_window") from exc
    if start and end and start > end:
        raise DiscoveryUnavailable("invalid_date_window")
    terms = {term for term in re.findall(r"[a-z0-9]{3,}", query.casefold())
             if term not in QUERY_STOPWORDS}
    if not terms:
        raise DiscoveryUnavailable("invalid_query")
    try:
        response = requests.get(FED_RSS_URL, timeout=12, stream=True,
                                allow_redirects=False)
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
            root = ElementTree.fromstring(b"".join(chunks))
        finally:
            response.close()
    except DiscoveryUnavailable:
        raise
    except (requests.RequestException, ElementTree.ParseError, ValueError) as exc:
        raise DiscoveryUnavailable("provider_failed") from exc
    allowed_hosts = {host.strip().lower() for host in
                     os.getenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "").split(",") if host.strip()}
    seen_at = datetime.now(timezone.utc).isoformat()
    results = []
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        if not title or not url or not terms.intersection(
                re.findall(r"[a-z0-9]{3,}", title.casefold())):
            continue
        try:
            parsed = urlsplit(url)
            port = parsed.port
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError, IndexError):
            continue
        if (parsed.scheme != "https" or parsed.hostname != FED_HOST or
                parsed.username or parsed.password or port not in (None, 443) or
                parsed.query or parsed.fragment or not parsed.path.startswith(FED_PATH) or
                ".." in parsed.path.split("/") or published.tzinfo is None or
                not parsed.path.endswith((".htm", ".html")) or len(url) > 2048):
            continue
        published = published.astimezone(timezone.utc)
        if (start and published.date() < start) or (end and published.date() > end):
            continue
        results.append({"url": url, "title": title[:300],
                        "publisher": "Federal Reserve Board", "seen_at": seen_at,
                        "published_at": published.isoformat(),
                        "access_status": "public" if FED_HOST in allowed_hosts else "not_allowlisted",
                        "provider": "fed_rss"})
        if len(results) == 10:
            break
    return results


def discover(query: str, start_date: str | None = None,
             end_date: str | None = None) -> list[dict]:
    if os.getenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER") == "fed_rss":
        return discover_fed_rss(query, start_date, end_date)
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
