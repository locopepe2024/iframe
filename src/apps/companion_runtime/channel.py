"""Demo-local encrypted channel overrides; existing personal settings stay read-only."""
import os
from fastapi import HTTPException
from ..user_config import UserConfigStore


def local_store():
    path = os.getenv('IFRAME_COMPANION_DB_PATH')
    if not path:
        raise HTTPException(503, 'Companion storage unavailable')
    return UserConfigStore(path)


def personal_store(identity):
    local = local_store()
    if local.get_public(identity)['secrets_configured']['UNIART_API_KEY']:
        return local
    path = os.getenv('IFRAME_COMPANION_USER_CONFIG_DB') or os.getenv('IFRAME_PHOTOS_USER_CONFIG_DB') or os.getenv('LUMENX_USER_DB_PATH')
    if path:
        shared = UserConfigStore(path, read_only=True)
        if shared.get_public(identity)['secrets_configured']['UNIART_API_KEY']:
            return shared
    raise HTTPException(409, '请配置个人 UniArt API Key。')


def runtime(identity):
    config = personal_store(identity).get_runtime_uniart(identity)
    if not config['base_url'].startswith('https://'):
        raise HTTPException(422, 'UniArt 地址必须使用 HTTPS。')
    return config


def public(identity):
    preferences = local_store().get_public(identity).get('preferences', {})
    try:
        config = personal_store(identity).get_public(identity)
        return dict(configured=True, base_url=config.get('UNIART_BASE_URL') or 'https://uniart.fun/v1', preferences=preferences)
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        return dict(configured=False, base_url='https://uniart.fun/v1', preferences=preferences)
