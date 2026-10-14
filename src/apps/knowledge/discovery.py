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
CNINFO_QUERY_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
CNINFO_SECURITY_URL = "https://www.cninfo.com.cn/new/information/topSearch/query"
CNINFO_PDF_HOST = "static.cninfo.com.cn"
CNINFO_PDF_PATH = re.compile(r"finalpage/(\d{4}-\d{2}-\d{2})/(\d+)\.PDF")
CNINFO_TIMEZONE = timezone(timedelta(hours=8))
DEEPMIND_SITEMAP_URL = "https://deepmind.google/sitemap.xml"
VIDEO_TREND_PATH = re.compile(r"/(?:models/veo(?:/|$)|models/model-cards/veo-[^/]+/|blog/(?:generating-audio-for-video|genie-3-a-new-frontier-for-world-models)/)")
QUERY_STOPWORDS = {"and", "board", "federal", "for", "from", "news", "release",
                   "reserve", "the", "with"}


def current_cninfo_date() -> date:
    return datetime.now(CNINFO_TIMEZONE).date()


def video_trend_request(query: str) -> bool:
    return (bool(re.search(r"视频|video", query, re.IGNORECASE))
            and bool(re.search(r"模型|生成|AI|发展趋势|趋势|model|generation|trend", query, re.IGNORECASE)))


def discover_video_trends(query: str, start_date: str | None,
                          end_date: str | None) -> list[dict]:
    if not video_trend_request(query):
        raise DiscoveryUnavailable("unsupported_subject")
    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError as exc:
        raise DiscoveryUnavailable("invalid_date_window") from exc
    if start and end and start > end:
        raise DiscoveryUnavailable("invalid_date_window")
    try:
        response = requests.get(DEEPMIND_SITEMAP_URL, timeout=12, stream=True, allow_redirects=False)
        try:
            if response.status_code == 429:
                raise DiscoveryUnavailable("rate_limited")
            if response.status_code != 200:
                raise DiscoveryUnavailable("provider_failed")
            root = ElementTree.fromstring(b"".join(_bounded_chunks(response, 256_000)))
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
    for element in root.findall("./{http://www.sitemaps.org/schemas/sitemap/0.9}url"):
        url = (element.findtext("{http://www.sitemaps.org/schemas/sitemap/0.9}loc") or "").strip()
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError:
            continue
        if (parsed.scheme != "https" or parsed.hostname != "deepmind.google" or
                parsed.username or parsed.password or port not in (None, 443) or
                parsed.query or parsed.fragment or ".." in parsed.path.split("/") or
                not VIDEO_TREND_PATH.fullmatch(parsed.path) or len(url) > 2048):
            continue
        results.append({"url": url, "title": parsed.path.strip("/").split("/")[-1].replace("-", " ")[:300],
                        "publisher": "Google DeepMind", "seen_at": seen_at,
                        "published_at": None, "access_status": "public" if "deepmind.google" in allowed_hosts else "not_allowlisted",
                        "provider": "video_trends"})
        if len(results) == 10:
            break
    return results


def cninfo_issuer(query: str, name_hint: str | None = None) -> tuple[str, str, str]:
    codes = set(re.findall(r"(?<!\d)\d{6}(?!\d)", query))
    if len(codes) > 1:
        raise DiscoveryUnavailable("ambiguous_subject")
    keyword = next(iter(codes), query.strip()[:120])
    if len(keyword) < 2:
        raise DiscoveryUnavailable("ambiguous_subject")
    matches = _search_cninfo_issuers(keyword)
    if len(matches) != 1:
        raise DiscoveryUnavailable("ambiguous_subject" if matches else "subject_not_found")
    item = matches[0]
    if name_hint and codes and name_hint.strip() and name_hint.strip() != keyword:
        named_matches = _search_cninfo_issuers(name_hint.strip()[:120])
        if len(named_matches) != 1 or named_matches[0]["code"] != item["code"]:
            raise DiscoveryUnavailable("ambiguous_subject")
    return item["code"], item["orgId"], item["zwjc"].strip()


def _search_cninfo_issuers(keyword: str) -> list[dict]:
    try:
        response = requests.post(CNINFO_SECURITY_URL, data={"keyWord": keyword},
                                 timeout=12, stream=True, allow_redirects=False)
        try:
            if response.status_code == 429:
                raise DiscoveryUnavailable("rate_limited")
            if response.status_code != 200:
                raise DiscoveryUnavailable("provider_failed")
            raw = b"".join(_bounded_chunks(response, 128_000))
            payload = json.loads(raw)
        finally:
            response.close()
    except DiscoveryUnavailable:
        raise
    except (requests.RequestException, ValueError, TypeError) as exc:
        raise DiscoveryUnavailable("provider_failed") from exc
    if not isinstance(payload, list):
        raise DiscoveryUnavailable("invalid_provider_response")
    return [item for item in payload if isinstance(item, dict)
               and item.get("category") == "A股" and item.get("delisted") == "false"
               and isinstance(item.get("code"), str) and re.fullmatch(r"\d{6}", item["code"])
               and isinstance(item.get("orgId"), str) and re.fullmatch(r"[A-Za-z0-9]{4,30}", item["orgId"])
               and isinstance(item.get("zwjc"), str) and item["zwjc"].strip()
               and (not re.fullmatch(r"\d{6}", keyword) or item["code"] == keyword)]


def _bounded_chunks(response, limit: int):
    size = 0
    for chunk in response.iter_content(65536):
        size += len(chunk)
        if size > limit:
            raise DiscoveryUnavailable("oversized_provider_response")
        yield chunk


def discover_cninfo(query: str, start_date: str | None,
                    end_date: str | None, name_hint: str | None = None) -> list[dict]:
    try:
        end = date.fromisoformat(end_date) if end_date else current_cninfo_date()
        start = date.fromisoformat(start_date) if start_date else end - timedelta(days=30)
    except ValueError as exc:
        raise DiscoveryUnavailable("invalid_date_window") from exc
    if start > end or end > current_cninfo_date() or (end - start).days > 366:
        raise DiscoveryUnavailable("invalid_date_window")
    code, org_id, name = cninfo_issuer(query, name_hint)
    if code.startswith(("6", "9")):
        column, plate = "sse", "sh"
    elif code.startswith(("0", "3")):
        column, plate = "szse", "sz"
    else:
        raise DiscoveryUnavailable("subject_not_found")
    try:
        response = requests.post(CNINFO_QUERY_URL, data={
            "pageNum": "1", "pageSize": "10", "column": column,
            "tabName": "fulltext", "stock": f"{code},{org_id}", "plate": plate,
            "seDate": f"{start.isoformat()}~{end.isoformat()}",
        }, timeout=12, stream=True, allow_redirects=False)
        try:
            if response.status_code == 429:
                raise DiscoveryUnavailable("rate_limited")
            if response.status_code != 200:
                raise DiscoveryUnavailable("provider_failed")
            chunks = []
            size = 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 256_000:
                    raise DiscoveryUnavailable("oversized_provider_response")
                chunks.append(chunk)
            payload = json.loads(b"".join(chunks))
        finally:
            response.close()
    except DiscoveryUnavailable:
        raise
    except (requests.RequestException, ValueError, TypeError) as exc:
        raise DiscoveryUnavailable("provider_failed") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("announcements"), (list, type(None))):
        raise DiscoveryUnavailable("invalid_provider_response")
    allowed_hosts = {host.strip().lower() for host in
                     os.getenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "").split(",") if host.strip()}
    seen_at = datetime.now(timezone.utc).isoformat()
    results = []
    for item in (payload.get("announcements") or [])[:10]:
        if not isinstance(item, dict) or item.get("secCode") != code or item.get("orgId") != org_id:
            continue
        path = item.get("adjunctUrl")
        title = item.get("announcementTitle")
        if not isinstance(path, str) or not CNINFO_PDF_PATH.fullmatch(path) or not isinstance(title, str):
            continue
        try:
            published = datetime.fromtimestamp(item["announcementTime"] / 1000, CNINFO_TIMEZONE)
            path_date = date.fromisoformat(CNINFO_PDF_PATH.fullmatch(path).group(1))
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        if not start <= published.date() <= end or abs((published.date() - path_date).days) > 1:
            continue
        results.append({"url": f"https://{CNINFO_PDF_HOST}/{path}", "title": title[:300],
                        "publisher": f"CNINFO / {name} ({code})", "seen_at": seen_at,
                        "published_at": published.isoformat(),
                        "access_status": "public" if CNINFO_PDF_HOST in allowed_hosts else "not_allowlisted",
                        "provider": "cninfo"})
        if len(results) == 5:
            break
    return results


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
             end_date: str | None = None, name_hint: str | None = None) -> list[dict]:
    if os.getenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER") == "cninfo":
        return discover_cninfo(query, start_date, end_date, name_hint)
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
