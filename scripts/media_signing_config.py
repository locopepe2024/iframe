"""Provision the server's stable media-signing key without logging secrets."""
import os
from pathlib import Path
import secrets


def media_signing_env(environment: list[str], secret_file: Path) -> list[str]:
    values = dict(item.split('=', 1) for item in environment if '=' in item)
    if values.get('LUMENX_MEDIA_SIGNING_KEY') or values.get('LUMENX_CONFIG_MASTER_KEY'):
        return list(environment)
    secret_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not secret_file.exists():
        key = secrets.token_urlsafe(48)
        fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(key + '\n')
    key = secret_file.read_text().strip()
    if len(key) < 32 or any(c.isspace() for c in key):
        raise ValueError('Invalid persisted media-signing key')
    return [item for item in environment if not item.startswith('LUMENX_MEDIA_SIGNING_KEY=')] + ['LUMENX_MEDIA_SIGNING_KEY=' + key]
