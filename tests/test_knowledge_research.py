from contextlib import contextmanager
import json
from datetime import date, timedelta, datetime, timezone
from unittest.mock import Mock
import socket
import subprocess
import sys
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.knowledge import api, capture, discovery, store, worker


def test_discovery_requires_configured_provider(monkeypatch):
    monkeypatch.delenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", raising=False)
    with pytest.raises(discovery.DiscoveryUnavailable, match="provider_not_configured"):
        discovery.discover("NVIDIA")


def test_gdelt_rejects_windows_older_than_provider_retention(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    with pytest.raises(discovery.DiscoveryUnavailable, match="provider_date_window_unsupported"):
        discovery.discover("NVIDIA", "2026-03-01", "2026-03-31")


def test_discovery_keeps_seen_date_separate_from_publication_date(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps({"articles": [{"url": "https://example.org/news",
        "title": "Company report", "domain": "example.org", "seendate": "20260301T120000Z"}]}).encode()]
    monkeypatch.setattr(discovery.requests, "get", Mock(return_value=response))
    end = date.today()
    start = end - timedelta(days=10)
    result = discovery.discover("NVIDIA", start.isoformat(), end.isoformat())
    assert result[0]["access_status"] == "public"
    assert result[0]["seen_at"] == "20260301T120000Z"
    assert result[0]["published_at"] is None


def test_fed_rss_discovers_only_matching_official_html_in_window(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "www.federalreserve.gov")
    feed = b"""<rss><channel>
      <item><title>2025 Survey of Consumer Finances results</title>
        <link>https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm</link>
        <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate></item>
      <item><title>Consumer Finances outside host</title>
        <link>https://example.org/newsevents/pressreleases/other20261009a.htm</link>
        <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate></item>
      <item><title>Monetary policy statement</title>
        <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261009a.htm</link>
        <pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate></item>
    </channel></rss>"""
    response = Mock(status_code=200)
    response.iter_content.return_value = [feed]
    get = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "get", get)
    results = discovery.discover("Survey of Consumer Finances", "2026-10-01", "2026-10-12")
    assert len(results) == 1
    assert results[0]["provider"] == "fed_rss"
    assert results[0]["access_status"] == "public"
    assert results[0]["published_at"] == "2026-10-09T14:00:00+00:00"
    assert results[0]["seen_at"] != results[0]["published_at"]
    assert get.call_args.kwargs["allow_redirects"] is False
    assert discovery.discover("Survey of Consumer Finances", "2026-10-10", "2026-10-12") == []


def test_fed_rss_rate_limit_and_invalid_xml_are_visible(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    response = Mock(status_code=429)
    monkeypatch.setattr(discovery.requests, "get", Mock(return_value=response))
    with pytest.raises(discovery.DiscoveryUnavailable, match="rate_limited"):
        discovery.discover("consumer finances")
    response.status_code = 200
    response.iter_content.return_value = [b"not xml"]
    with pytest.raises(discovery.DiscoveryUnavailable, match="provider_failed"):
        discovery.discover("consumer finances")


def test_fed_rss_uses_own_budget_and_source_policy(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "www.federalreserve.gov")
    assert api.research_enabled_for("owner-a") is True
    assert api.research_enabled_for("owner-b") is True
    cursor = Mock()
    cursor.fetchone.side_effect = [None, None]
    connection = Mock()
    connection.cursor.return_value = cursor
    assert store.reserve_discovery(connection, "owner-a", "fed_rss") is True
    assert any(call.args[1][0] == "provider:fed_rss" and call.args[1][1] == "60 seconds"
               for call in cursor.execute.call_args_list
               if len(call.args) == 2 and len(call.args[1]) > 1)


def test_cninfo_discovers_exact_issuer_and_march_announcement(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    monkeypatch.setattr(discovery, "cninfo_issuer", lambda query, hint=None: ("002303", "9900008616", "美盈森") if "美盈森" in query else (_ for _ in ()).throw(discovery.DiscoveryUnavailable("subject_not_found")))
    payload = {"announcements": [
        {"secCode": "002303", "orgId": "9900008616", "announcementTitle": "仲裁裁决公告",
         "announcementTime": 1773849600000, "adjunctUrl": "finalpage/2026-03-19/1225016378.PDF"},
        {"secCode": "002304", "orgId": "9900008616", "announcementTitle": "other issuer",
         "announcementTime": 1773849600000, "adjunctUrl": "finalpage/2026-03-19/1225016379.PDF"},
        {"secCode": "002303", "orgId": "9900008616", "announcementTitle": "unsafe path",
         "announcementTime": 1773849600000, "adjunctUrl": "../private/1225016378.PDF"},
    ]}
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps(payload).encode()]
    post = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "post", post)
    results = discovery.discover("美盈森集团股份有限公司", "2026-03-01", "2026-03-31")
    assert [item["url"] for item in results] == [
        "https://static.cninfo.com.cn/finalpage/2026-03-19/1225016378.PDF"]
    assert results[0]["access_status"] == "public"
    assert results[0]["published_at"] == "2026-03-19T00:00:00+08:00"
    assert post.call_args.kwargs["data"]["stock"] == "002303,9900008616"
    assert post.call_args.kwargs["allow_redirects"] is False
    with pytest.raises(discovery.DiscoveryUnavailable, match="subject_not_found"):
        discovery.discover("其他公司", "2026-03-01", "2026-03-31")
    assert post.call_count == 1


def test_cninfo_discovers_yiyatong_with_exact_issuer_identity(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    issuer_response = Mock(status_code=200)
    issuer_response.iter_content.return_value = [json.dumps([
        {"code": "002183", "orgId": "9900003828", "zwjc": "怡亚通", "category": "A股", "delisted": "false"},
        {"code": "148506", "orgId": "9900003828", "zwjc": "23怡亚03", "category": "公司债", "delisted": "false"},
    ]).encode()]
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps({"announcements": [
        {"secCode": "002183", "orgId": "9900003828", "announcementTitle": "2026年公告",
         "announcementTime": 1791907200000, "adjunctUrl": "finalpage/2026-10-14/1225604113.PDF"},
        {"secCode": "002183", "orgId": "wrong-org", "announcementTitle": "wrong",
         "announcementTime": 1791907200000, "adjunctUrl": "finalpage/2026-10-14/1225604114.PDF"},
    ]}).encode()]
    post = Mock(side_effect=[issuer_response, response])
    monkeypatch.setattr(discovery.requests, "post", post)
    results = discovery.discover_cninfo("深圳市怡亚通供应链股份有限公司 002183", "2026-10-01", "2026-10-14")
    assert [item["url"] for item in results] == ["https://static.cninfo.com.cn/finalpage/2026-10-14/1225604113.PDF"]
    assert post.call_args_list[0].args[0] == discovery.CNINFO_SECURITY_URL
    assert post.call_args_list[0].kwargs["data"] == {"keyWord": "002183"}
    assert post.call_args_list[1].kwargs["data"]["stock"] == "002183,9900003828"
    assert "怡亚通" in results[0]["publisher"]


def test_cninfo_overview_prioritizes_latest_periodic_summary(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    monkeypatch.setattr(discovery, "cninfo_issuer", lambda query, hint=None: ("002183", "9900003828", "怡亚通"))
    def entry(day, number, title):
        return {"secCode": "002183", "orgId": "9900003828", "announcementTitle": title,
                "announcementTime": int(datetime.fromisoformat(day).replace(tzinfo=timezone(timedelta(hours=8))).timestamp() * 1000),
                "adjunctUrl": f"finalpage/{day}/{number}.PDF"}
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps({"announcements": [
        entry("2026-10-14", "1", "股东减持公告"),
        entry("2026-10-13", "2", "担保公告"),
        entry("2026-10-12", "3", "董事会公告"),
        entry("2026-10-11", "4", "股权转让公告"),
        entry("2026-10-10", "5", "质押公告"),
        entry("2026-08-28", "6", "2026年半年度报告"),
        entry("2026-08-28", "7", "2026年半年度报告摘要"),
    ]}).encode()]
    post = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "post", post)
    results = discovery.discover_cninfo("002183", "2026-01-01", "2026-10-14", prioritize_reports=True)
    assert results[0]["title"] == "2026年半年度报告摘要"
    assert len(results) == 5
    assert post.call_args.kwargs["data"]["pageSize"] == "30"


def test_cninfo_subject_resolution_reports_ambiguity_without_guessing(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps([
        {"code": "000001", "orgId": "org0001", "zwjc": "甲公司", "category": "A股", "delisted": "false"},
        {"code": "000002", "orgId": "org0002", "zwjc": "乙公司", "category": "A股", "delisted": "false"},
    ]).encode()]
    monkeypatch.setattr(discovery.requests, "post", Mock(return_value=response))
    with pytest.raises(discovery.DiscoveryUnavailable, match="ambiguous_subject"):
        discovery.cninfo_issuer("供应链公司")


def test_cninfo_resolves_company_name_without_code(monkeypatch):
    response = Mock(status_code=200)
    response.iter_content.return_value = [json.dumps([
        {"code": "002183", "orgId": "9900003828", "zwjc": "怡亚通", "category": "A股", "delisted": "false"},
        {"code": "148506", "orgId": "9900003828", "zwjc": "23怡亚03", "category": "公司债", "delisted": "false"},
    ]).encode()]
    post = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "post", post)
    assert discovery.cninfo_issuer("深圳市怡亚通供应链股份有限公司") == ("002183", "9900003828", "怡亚通")
    assert post.call_args.kwargs["data"] == {"keyWord": "深圳市怡亚通供应链股份有限公司"}


def test_cninfo_rejects_conflicting_code_and_company_name(monkeypatch):
    def response_for(code, name):
        response = Mock(status_code=200)
        response.iter_content.return_value = [json.dumps([
            {"code": code, "orgId": "9900003828", "zwjc": name,
             "category": "A股", "delisted": "false"},
        ]).encode()]
        return response

    post = Mock(side_effect=[response_for("002183", "怡亚通"),
                             response_for("002303", "美盈森")])
    monkeypatch.setattr(discovery.requests, "post", post)
    with pytest.raises(discovery.DiscoveryUnavailable, match="ambiguous_subject"):
        discovery.cninfo_issuer("002183", "美盈森集团股份有限公司")
    assert [call.kwargs["data"]["keyWord"] for call in post.call_args_list] == [
        "002183", "美盈森集团股份有限公司"]


def test_cninfo_uses_shanghai_announcement_column(monkeypatch):
    monkeypatch.setattr(discovery, "cninfo_issuer", lambda query, hint=None: ("600000", "org600000", "浦发银行"))
    response = Mock(status_code=200)
    response.iter_content.return_value = [b'{"announcements":[]}']
    post = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "post", post)
    assert discovery.discover_cninfo("600000", "2026-10-01", "2026-10-14") == []
    assert post.call_args.kwargs["data"]["column"] == "sse"
    assert post.call_args.kwargs["data"]["plate"] == "sh"


def test_video_trend_discovery_uses_only_official_bounded_paths(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "deepmind.google")
    response = Mock(status_code=200)
    response.iter_content.return_value = [b"""<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://deepmind.google/models/veo/</loc><lastmod>2026-06-04</lastmod></url>
      <url><loc>https://deepmind.google/blog/generating-audio-for-video/</loc></url>
      <url><loc>https://evil.example/models/veo/</loc></url>
      <url><loc>https://deepmind.google/private/account/</loc></url>
    </urlset>"""]
    get = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "get", get)
    results = discovery.discover_video_trends("视频 AI 模型最近一年的发展趋势", "2025-10-14", "2026-10-14")
    assert [item["url"] for item in results] == [
        "https://deepmind.google/models/veo/",
        "https://deepmind.google/blog/generating-audio-for-video/"]
    assert all(item["published_at"] is None and item["access_status"] == "public" for item in results)
    assert get.call_args.kwargs["allow_redirects"] is False


def test_video_trend_request_routes_away_from_cninfo(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "ensure_research_collection", lambda *args: "collection-a")
    monkeypatch.setattr(store, "create_research_run", lambda *args: "run-a")
    monkeypatch.setattr(store, "reserve_discovery", lambda conn, owner, provider: calls.append(provider) or True)
    monkeypatch.setattr(store, "finish_discovery", lambda *args: None)
    monkeypatch.setattr(store, "get_research_run", lambda *args: {"id": "run-a", "status": "awaiting_selection", "candidates": [], "jobs": []})
    monkeypatch.setattr(discovery, "discover_video_trends", lambda *args: [{"url": "https://deepmind.google/models/veo/", "provider": "video_trends"}])
    monkeypatch.setattr(discovery, "discover_cninfo", Mock(side_effect=AssertionError("Wrong source")))
    api.start_research("owner", "session", "分析视频 AI 模型最近一年的发展趋势",
                       intent={"subject": "视频生成模型", "start_date": "2025-10-14", "end_date": "2026-10-14"})
    assert calls == ["video_trends"]


def test_cninfo_rejects_invalid_window_and_rate_limit(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    monkeypatch.setattr(discovery, "cninfo_issuer", lambda query, hint=None: ("002303", "9900008616", "美盈森"))
    with pytest.raises(discovery.DiscoveryUnavailable, match="invalid_date_window"):
        discovery.discover("002303", "2026-04-01", "2026-03-01")
    response = Mock(status_code=429)
    monkeypatch.setattr(discovery.requests, "post", Mock(return_value=response))
    with pytest.raises(discovery.DiscoveryUnavailable, match="rate_limited"):
        discovery.discover("002303", "2026-03-01", "2026-03-31")


def test_cninfo_today_uses_china_date_at_utc_boundary(monkeypatch):
    monkeypatch.setattr(discovery, "cninfo_issuer", lambda query, hint=None: ("002303", "9900008616", "美盈森"))
    real_datetime = datetime
    class BoundaryClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 10, 13, 16, 30, tzinfo=timezone.utc).astimezone(tz)
    monkeypatch.setattr(discovery, "datetime", BoundaryClock)
    assert discovery.current_cninfo_date() == date(2026, 10, 14)
    monkeypatch.setattr(discovery, "current_cninfo_date",
                        lambda: date(2026, 10, 14))
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    response = Mock(status_code=200)
    response.iter_content.return_value = [b'{"announcements":[]}']
    post = Mock(return_value=response)
    monkeypatch.setattr(discovery.requests, "post", post)
    assert discovery.discover_cninfo("002303", "2026-10-13", "2026-10-14") == []
    assert post.call_args.kwargs["data"]["seDate"] == "2026-10-13~2026-10-14"
    with pytest.raises(discovery.DiscoveryUnavailable, match="invalid_date_window"):
        discovery.discover_cninfo("002303", "2026-10-13", "2026-10-15")


def test_current_cninfo_run_auto_queues_only_public_candidates(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "ensure_research_collection", lambda conn, owner: "collection-a")
    monkeypatch.setattr(store, "create_research_run", lambda *args: "run-a")
    monkeypatch.setattr(store, "reserve_discovery", lambda *args: True)
    monkeypatch.setattr(store, "finish_discovery", lambda *args: None)
    monkeypatch.setattr(store, "get_research_run", lambda *args: {
        "id": "run-a", "status": "awaiting_selection", "candidates": [
            {"url": "https://static.cninfo.com.cn/a.PDF", "access_status": "public", "provider": "cninfo"},
            {"url": "https://blocked.example/b.PDF", "access_status": "not_allowlisted"}],
        "jobs": []})
    monkeypatch.setattr(store, "select_research_sources", lambda conn, owner, rid, urls:
                        calls.append((owner, rid, urls)) or {"id": rid, "status": "capturing", "candidates": [], "jobs": []})
    monkeypatch.setattr(discovery, "discover", lambda *args, **kwargs: [{"url": "https://static.cninfo.com.cn/a.PDF", "access_status": "public"}])
    run = api.start_research("owner-a", "session-a", "美盈森截止目前公告", auto_select_cninfo=True)
    assert run["status"] == "capturing"
    assert calls == [("owner-a", "run-a", ["https://static.cninfo.com.cn/a.PDF"])]


def test_cninfo_overview_requests_report_priority_but_news_request_does_not(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    @contextmanager
    def transaction():
        yield object()
    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "ensure_research_collection", lambda *args: "collection-a")
    monkeypatch.setattr(store, "create_research_run", lambda *args: "run-a")
    monkeypatch.setattr(store, "reserve_discovery", lambda *args: True)
    monkeypatch.setattr(store, "finish_discovery", lambda *args: None)
    monkeypatch.setattr(store, "get_research_run", lambda *args: {
        "id": "run-a", "status": "awaiting_selection", "candidates": [], "jobs": []})
    discover = Mock(return_value=[])
    monkeypatch.setattr(discovery, "discover", discover)
    intent = {"subject": "怡亚通", "start_date": "2026-01-01", "end_date": "2026-10-14"}
    api.start_research("owner", "session", "分析一下怡亚通 002183", intent=intent)
    assert discover.call_args.kwargs["prioritize_reports"] is True
    api.start_research("owner", "session", "查询怡亚通 002183 最新公告", intent=intent)
    assert discover.call_args.kwargs["prioritize_reports"] is False


def test_cninfo_available_to_authenticated_owners(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "cninfo")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "static.cninfo.com.cn")
    monkeypatch.delenv("IFRAME_KNOWLEDGE_CNINFO_OWNERS", raising=False)
    assert api.research_enabled_for("owner-a") is True
    assert api.research_enabled_for("owner-b") is True
    assert api.research_enabled_for("") is False
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CNINFO_OWNERS", "owner-a")
    assert api.research_enabled_for("owner-b") is True


def test_cninfo_pdf_capture_has_page_locator_and_rejects_bad_path(monkeypatch):
    url = "https://static.cninfo.com.cn/finalpage/2026-03-19/1225016378.PDF"
    fetched = []
    monkeypatch.setattr(capture, "fetch", lambda *args: fetched.append(args) or (b"%PDF-fixture", "application/pdf"))
    page = Mock()
    page.extract_text.return_value = "公告正文  事实"
    reader = Mock(is_encrypted=False, pages=[page])
    monkeypatch.setattr(capture, "PdfReader", lambda *args, **kwargs: reader)
    raw, units = capture.capture_article(url)
    assert raw == b"%PDF-fixture"
    assert units[0]["locator"] == "page:1:part:1"
    assert units[0]["body"] == "公告正文 事实"
    assert fetched[0][1] == {"application/pdf"}
    with pytest.raises(capture.CaptureRejected, match="unsupported_source_path"):
        capture.capture_article("https://static.cninfo.com.cn/private/secret.PDF")
    assert len(fetched) == 1
    page.extract_text.return_value = ""
    with pytest.raises(capture.CaptureRejected, match="no_article_text"):
        capture.capture_article(url)


def test_research_availability_requires_provider_and_capture_hosts(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "www.federalreserve.gov")
    assert api.research_enabled_for("browser-account") is True
    assert api.research_enabled_for("apikey-account") is True
    assert api.research_enabled_for("") is False
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "")
    assert api.research_enabled_for("browser-account") is False
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "www.federalreserve.gov")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "")
    assert api.research_enabled_for("browser-account") is False
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "fed_rss")
    assert api.research_enabled_for("browser-account") is True


def test_capture_rejects_private_destination_and_extracts_text(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setattr(capture.socket, "getaddrinfo", lambda *args, **kwargs:
                        [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 443))])
    with pytest.raises(capture.CaptureRejected, match="non_public_destination"):
        capture.validate_url("https://example.org/report")
    with pytest.raises(capture.CaptureRejected, match="source_not_allowlisted"):
        capture.validate_url("https://127.0.0.1/report")
    parser = capture.ArticleParser()
    parser.feed("<html><script>ignore</script><h1>Title</h1><p>Policy <b>update</b></p><img src='/figure.png' alt='Chart'></html>")
    assert parser.blocks == ["Title", "Policy update"]
    assert parser.images == [("/figure.png", "Chart", "")]
    parser = capture.ArticleParser()
    parser.feed("<figure><img src='/figure.png' alt='Revenue'><figcaption>Quarterly revenue</figcaption></figure>")
    assert parser.images == [("/figure.png", "Revenue", "Quarterly revenue")]


def test_capture_rechecks_redirect_destination(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setattr(capture.socket, "getaddrinfo", lambda *args, **kwargs:
                        [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 443))])
    response = Mock(status=302)
    response.getheader.return_value = "https://127.0.0.1/private"
    connection = Mock()
    connection.getresponse.return_value = response
    monkeypatch.setattr(capture, "PinnedHTTPSConnection", lambda host, ip: connection)
    with pytest.raises(capture.CaptureRejected, match="source_not_allowlisted"):
        capture.fetch("https://example.org/article", {"text/html"}, 1000)
    connection.request.assert_called_once()
    connection.close.assert_called_once()


def test_capture_pins_checked_ip_and_verifies_original_hostname(monkeypatch):
    context = Mock()
    raw_socket = Mock()
    monkeypatch.setattr(capture.ssl, "create_default_context", lambda: context)
    monkeypatch.setattr(capture.socket, "create_connection", lambda address, timeout: raw_socket)
    connection = capture.PinnedHTTPSConnection("example.org", "93.184.215.14")
    connection.connect()
    context.wrap_socket.assert_called_once_with(raw_socket, server_hostname="example.org")
    assert connection._pinned_ip == "93.184.215.14"


def test_research_api_uses_authenticated_owner_and_selected_candidates(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    run_id = uuid.uuid4()
    owner_calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "ensure_research_collection", lambda connection, owner: owner_calls.append(owner) or str(uuid.uuid4()))
    monkeypatch.setattr(store, "create_research_run", lambda connection, owner, sid, query, cid, intent: owner_calls.append((owner, sid, query, cid)) or str(run_id))
    monkeypatch.setattr(store, "reserve_discovery", lambda connection, owner, provider: True)
    monkeypatch.setattr(store, "finish_discovery", lambda connection, owner, rid, candidates, error: owner_calls.append((owner, rid, candidates, error)))
    monkeypatch.setattr(store, "get_research_run", lambda connection, owner, rid: {"id": rid, "status": "awaiting_selection", "candidates": [{"url": "https://example.org/a", "access_status": "public"}], "jobs": []})
    monkeypatch.setattr(store, "select_research_sources", lambda connection, owner, rid, urls: owner_calls.append((owner, urls)) or {"id": rid, "status": "capturing", "jobs": []})
    monkeypatch.setattr(discovery, "discover", lambda query, start, end: [{"url": "https://example.org/a", "access_status": "public"}])
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner-a", "A", "token")
    with TestClient(app) as client:
        assert client.get("/knowledge/research-capability").json() == {"enabled": True}
        created = client.post("/knowledge/research", json={"query": "NVIDIA March 2026", "session_id": "session-a"})
        assert created.status_code == 201
        assert created.json()["id"] == str(run_id)
        selected = client.post(f"/knowledge/research/{run_id}/sources", json={"urls": ["https://example.org/a"]})
        assert selected.status_code == 200
        assert owner_calls[0] == "owner-a"
        assert owner_calls[-1] == ("owner-a", ["https://example.org/a"])


def test_research_rejects_unconfigured_source_before_storage_or_discovery(monkeypatch):
    monkeypatch.delenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", raising=False)
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    calls = []
    monkeypatch.setattr(store, "transaction", lambda: calls.append("storage"))
    monkeypatch.setattr(discovery, "discover", lambda *args: calls.append("discovery"))
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner-b", "B", "token")
    with TestClient(app) as client:
        assert client.get("/knowledge/research-capability").json() == {"enabled": False}
        assert client.post("/knowledge/research", json={
            "query": "NVIDIA", "session_id": "session-b",
        }).status_code == 403
        assert client.post(f"/knowledge/research/{uuid.uuid4()}/sources", json={
            "urls": ["https://example.org/a"],
        }).status_code == 403
    assert calls == []


def test_research_does_not_use_legacy_owner_list(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_DISCOVERY_PROVIDER", "gdelt")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "example.org")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_RESEARCH_OWNERS", "other-owner")
    assert api.research_enabled_for("owner-a") is True


def test_worker_imports_raw_capture_and_finishes_job(monkeypatch):
    job = {"id": "job-a", "run_id": "run-a", "owner": "owner-a", "source_url": "https://example.org/a",
           "collection_id": "collection-a", "candidates": [{"url": "https://example.org/a", "title": "Article"}], "attempts": 0}
    calls = []

    @contextmanager
    def transaction():
        yield object()

    monkeypatch.setattr(store, "transaction", transaction)
    monkeypatch.setattr(store, "fail_exhausted_jobs", lambda connection: None)
    monkeypatch.setattr(store, "claim_capture_job", lambda connection: job)
    monkeypatch.setattr(capture, "capture_article", lambda url: (b"<p>Evidence</p>", [{"kind": "text", "locator": "block:1", "body": "Evidence", "labels": [], "annotation": None}]))
    monkeypatch.setattr(worker.blob_store, "put", lambda kind, raw: ("raw/key", "digest"))
    monkeypatch.setattr(store, "import_source", lambda connection, owner, cid, source, key, digest, units: calls.append((owner, cid, source, key, units)) or {"source_id": "source-a", "revision_id": "revision-a"})
    monkeypatch.setattr(store, "finish_capture_job", lambda connection, job, source_id=None, revision_id=None, error_code=None: calls.append((source_id, revision_id, error_code)))
    assert worker.run_once() is True
    assert calls[0][0:2] == ("owner-a", "collection-a")
    assert calls[0][3] == "raw/key"
    assert calls[1] == ("source-a", "revision-a", None)


def test_idle_worker_exits_cleanly_on_sigterm():
    process = subprocess.Popen([sys.executable, "-c",
        "from src.apps.knowledge import worker; "
        "worker.run_once = lambda: (print('ready', flush=True), False)[1]; "
        "worker.main()"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "ready"
        process.terminate()
        _, errors = process.communicate(timeout=5)
        assert process.returncode == 0, errors
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


def test_selection_rejects_unlisted_or_blocked_sources(monkeypatch):
    connection = Mock()
    connection.cursor.return_value.fetchone.return_value = ("run-a",)
    monkeypatch.setattr(store, "get_research_run", lambda connection, owner, rid: {
        "status": "awaiting_selection", "candidates": [
            {"url": "https://example.org/a", "access_status": "public"},
            {"url": "https://blocked.example/a", "access_status": "not_allowlisted"},
        ],
    })
    with pytest.raises(ValueError, match="not available"):
        store.select_research_sources(connection, "owner-a", "run-a", ["https://blocked.example/a"])
    with pytest.raises(ValueError, match="not available"):
        store.select_research_sources(connection, "owner-a", "run-a", ["https://example.org/a", "https://example.org/a"])
