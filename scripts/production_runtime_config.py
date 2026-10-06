"""Validate the sole production env file without displaying secret values."""
import os
import re
import stat
from pathlib import Path

PRODUCTION_ENV_FILE = Path('/srv/lumenx/runtime/iframe-backend.env')


def validate_production_env(path: Path = PRODUCTION_ENV_FILE) -> Path:
    try:
        metadata = path.lstat()
        parent = path.parent.lstat()
    except OSError:
        raise ValueError(f'Production config unavailable: {path}') from None
    if not stat.S_ISREG(metadata.st_mode) or not stat.S_ISDIR(parent.st_mode):
        raise ValueError('Production config and parent must be regular file/directory, not symlinks')
    if metadata.st_uid != os.geteuid() or parent.st_uid != os.geteuid():
        raise ValueError('Production config must be owned by the deployment user')
    if metadata.st_mode & 0o077 or parent.st_mode & 0o077:
        raise ValueError('Production config requires private file and directory permissions')
    try:
        text = path.read_text(encoding='utf-8')
    except (OSError, UnicodeError):
        raise ValueError('Cannot read production config as UTF-8') from None
    values = {}
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError(f'Invalid production config assignment at line {number}')
        if key in values:
            raise ValueError(f'Duplicate production config key at line {number}')
        if value != value.strip() or any(c in value for c in '\x00\"\x27$\\') or re.search(r'\s#', value):
            raise ValueError(f'Nonportable env-file value at line {number}; no automatic conversion')
        values[key] = value
    if not any(values.get(key) for key in ('LUMENX_MEDIA_SIGNING_KEY', 'LUMENX_CONFIG_MASTER_KEY')):
        raise ValueError('Production config requires a nonempty persistent signing key')
    return path


if __name__ == '__main__':
    try:
        validated = validate_production_env()
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print(f'Production config validated: {validated}')
