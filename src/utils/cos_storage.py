"""Minimal Tencent COS adapter shared by iFrame asset/media upload paths.

Credentials are read only from the server environment.  Objects remain private;
callers receive an object key and short lived presigned GET URLs.
"""
import hashlib
import mimetypes
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

from . import get_logger

logger = get_logger(__name__)


def is_cos_configured() -> bool:
    return all(os.getenv(name) for name in (
        "UNIART_VIDEO_COS_SECRET_ID",
        "UNIART_VIDEO_COS_SECRET_KEY",
        "UNIART_VIDEO_COS_BUCKET",
        "UNIART_VIDEO_COS_REGION",
    ))


class COSImageUploader:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.secret_id = os.getenv("UNIART_VIDEO_COS_SECRET_ID")
        self.secret_key = os.getenv("UNIART_VIDEO_COS_SECRET_KEY")
        self.bucket_name = os.getenv("UNIART_VIDEO_COS_BUCKET")
        self.region = os.getenv("UNIART_VIDEO_COS_REGION")
        self.domain = os.getenv("UNIART_VIDEO_COS_DOMAIN", "").strip()
        self.base_path = os.getenv("LUMENX_COS_KEY_PREFIX", "lumenx").strip("/")
        self._url_cache = {}
        self.client = None
        if is_cos_configured():
            try:
                from qcloud_cos import CosConfig, CosS3Client
                config = CosConfig(Region=self.region, SecretId=self.secret_id, SecretKey=self.secret_key)
                self.client = CosS3Client(config)
            except Exception as exc:
                logger.warning("Tencent COS initialization failed: %s", exc)
        self._initialized = True

    @classmethod
    def reset_instance(cls):
        cls._instance = None

    @property
    def is_configured(self) -> bool:
        return self.client is not None and bool(self.bucket_name and self.region)

    def _key(self, sub_path: str, filename: str) -> str:
        parts = [p.strip("/") for p in (self.base_path, sub_path, filename) if p and p.strip("/")]
        return "/".join(parts)

    def upload_file(self, local_path: str, sub_path: str = "", custom_filename: str = None) -> Optional[str]:
        if not self.is_configured:
            return None
        resolved = os.path.realpath(local_path)
        allowed = (os.path.realpath("output") + os.sep, os.path.realpath(tempfile.gettempdir()) + os.sep)
        if not any(resolved.startswith(prefix) for prefix in allowed) or not os.path.isfile(resolved):
            logger.warning("Refusing COS upload outside output/temp: %s", local_path)
            return None
        key = self._key(sub_path, custom_filename or os.path.basename(resolved))
        content_type = mimetypes.guess_type(resolved)[0] or "application/octet-stream"
        try:
            with open(resolved, "rb") as body:
                self.client.put_object(Bucket=self.bucket_name, Body=body, Key=key, ContentType=content_type)
            head = self.client.head_object(Bucket=self.bucket_name, Key=key)
            remote_size = head.get("content-length", head.get("Content-Length", -1))
            if int(remote_size) != os.path.getsize(resolved):
                logger.warning("COS upload size verification failed: %s", key)
                return None
            return key
        except Exception as exc:
            logger.warning("COS upload failed for %s: %s", key, exc)
            return None

    def generate_signed_url(self, object_key: str, expires: int = 7200) -> str:
        if not self.is_configured:
            return ""
        cache_key = (object_key, expires)
        now = time.time()
        cached = self._url_cache.get(cache_key)
        if cached and now - cached[1] < max(1, expires - 600):
            return cached[0]
        try:
            url = self.client.get_presigned_url(
                Method="GET", Bucket=self.bucket_name, Key=object_key, Expired=expires,
            )
            if url.startswith("http://"):
                url = "https://" + url[7:]
            self._url_cache[cache_key] = (url, now)
            return url
        except Exception as exc:
            logger.warning("COS signing failed for %s: %s", object_key, exc)
            return ""

    def sign_url_for_display(self, object_key: str) -> str:
        return self.generate_signed_url(object_key, 7200)

    def sign_url_for_api(self, object_key: str) -> str:
        return self.generate_signed_url(object_key, 1800)

    def object_exists(self, object_key: str) -> bool:
        if not self.is_configured:
            return False
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=object_key)
            return True
        except Exception:
            return False

    def get_oss_url(self, object_key: str, use_public_url: bool = False) -> str:
        return self.sign_url_for_display(object_key)

    upload_image = upload_file
    upload_video = upload_file
