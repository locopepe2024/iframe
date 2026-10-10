"""Allowlisted HTML capture with bounded text and media extraction."""

import ipaddress
import http.client
import os
import socket
import ssl
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

class CaptureRejected(Exception):
    pass


def validate_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise CaptureRejected("invalid_source_url") from exc
    allowed = {host.strip().lower() for host in
               os.getenv("IFRAME_KNOWLEDGE_CAPTURE_HOSTS", "").split(",") if host.strip()}
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or port not in (None, 443) or parsed.hostname.lower() not in allowed):
        raise CaptureRejected("source_not_allowlisted")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise CaptureRejected("non_public_destination")
        return addresses[0][4][0]
    except OSError as exc:
        raise CaptureRejected("dns_failed") from exc


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, ip: str):
        super().__init__(host, port=443, timeout=15, context=ssl.create_default_context())
        self._pinned_ip = ip

    def connect(self):
        self.sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def fetch(url: str, allowed_types: set[str], limit: int) -> tuple[bytes, str]:
    for _ in range(4):
        ip = validate_url(url)
        parsed = urlsplit(url)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        connection = PinnedHTTPSConnection(parsed.hostname, ip)
        try:
            connection.request("GET", path, headers={
                "Host": parsed.hostname, "User-Agent": "iFrameKnowledgeResearch/1.0",
                "Accept-Encoding": "identity",
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise CaptureRejected("invalid_redirect")
                url = urljoin(url, location)
                continue
            if response.status == 429:
                raise CaptureRejected("source_rate_limited")
            if response.status != 200:
                raise CaptureRejected("source_http_error")
            media_type = (response.getheader("Content-Type") or "").split(";", 1)[0].lower()
            if media_type not in allowed_types:
                raise CaptureRejected("unsupported_content_type")
            content = response.read(limit + 1)
            if len(content) > limit:
                raise CaptureRejected("source_too_large")
            return content, media_type
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            raise CaptureRejected("source_fetch_failed") from exc
        finally:
            connection.close()
    raise CaptureRejected("too_many_redirects")


class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.blocks = []
        self.images = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style", "nav", "footer", "header"):
            self.skip += 1
        if self.skip:
            return
        if tag in ("h1", "h2", "h3", "p", "li", "figcaption"):
            self.current = []
        if tag == "img" and attrs.get("src"):
            self.images.append((attrs["src"], attrs.get("alt", "")[:500], ""))

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer", "header") and self.skip:
            self.skip -= 1
        if not self.skip and tag in ("h1", "h2", "h3", "p", "li", "figcaption") and self.current is not None:
            text = " ".join(" ".join(self.current).split())
            if text:
                self.blocks.append(text[:20000])
                if tag == "figcaption" and self.images:
                    source, alt, _ = self.images[-1]
                    self.images[-1] = (source, alt, text[:500])
            self.current = None

    def handle_data(self, data):
        if not self.skip and self.current is not None:
            self.current.append(data)


def capture_article(url: str) -> tuple[bytes, list[dict]]:
    raw, _ = fetch(url, {"text/html"}, 2 * 1024 * 1024)
    parser = ArticleParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    units = [{"kind": "text", "locator": f"block:{index + 1}", "body": text,
              "labels": [], "annotation": None} for index, text in enumerate(parser.blocks[:100])]
    if not units:
        raise CaptureRejected("no_article_text")
    for source, alt, caption in parser.images[:2]:
        image_url = urljoin(url, source)
        try:
            media, media_type = fetch(image_url, {"image/jpeg", "image/png", "image/webp"}, 4 * 1024 * 1024)
        except CaptureRejected:
            continue
        signatures = {"image/jpeg": media.startswith(b"\xff\xd8\xff"),
                      "image/png": media.startswith(b"\x89PNG\r\n\x1a\n"),
                      "image/webp": media.startswith(b"RIFF") and media[8:12] == b"WEBP"}
        if not signatures[media_type]:
            continue
        units.append({"kind": "image", "locator": f"image:{len(units) + 1}",
                      "body": caption or alt, "labels": [],
                      "annotation": f"alt: {alt}" if caption and alt else None,
                      "media_type": media_type, "media_bytes": media})
    return raw, units
