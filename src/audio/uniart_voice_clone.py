"""Owner-scoped MiniMax voice clones through the UniArt gateway."""
from __future__ import annotations

import re
import sqlite3
import time
from pathlib import Path
from uuid import uuid4

import requests

from ..apps.studio_access import studio_uniart_config
from ..utils.provider_catalog import catalog_name, fetch_selected_catalog
from .uniart_tts import MODELS, UniArtTTSError

MAX_SAMPLE_BYTES = 20 << 20
ALLOWED_SUFFIXES = {'.mp3', '.m4a', '.wav'}
CLONE_ID = re.compile(r'^uniart:(speech-2\.8-hd|speech-2\.8-turbo):(iframe[a-f0-9]{32})$')


class VoiceCloneStore:
    def __init__(self, output_root):
        self.path = Path(output_root) / 'voice_clones.sqlite3'

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute('CREATE TABLE IF NOT EXISTS voice_clones ('
                   'id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, '
                   'model TEXT NOT NULL, created_at REAL NOT NULL)')
        return db

    def list(self, owner):
        with self._connect() as db:
            rows = db.execute('SELECT id, name, model, created_at FROM voice_clones '
                              'WHERE owner=? ORDER BY created_at DESC', (owner,)).fetchall()
        return [dict(id=row[0], name=row[1], model=row[2], created_at=row[3],
                     family='minimax', origin='clone') for row in rows]

    def contains(self, owner, voice):
        if not CLONE_ID.fullmatch(voice or ''):
            return False
        with self._connect() as db:
            return db.execute('SELECT 1 FROM voice_clones WHERE id=? AND owner=?',
                              (voice, owner)).fetchone() is not None

    def add(self, owner, name, model, voice):
        record = dict(id=f'uniart:{model}:{voice}', name=name, model=model,
                      created_at=time.time(), family='minimax', origin='clone')
        with self._connect() as db:
            db.execute('INSERT INTO voice_clones VALUES (?,?,?,?,?)',
                       (record['id'], owner, name, model, record['created_at']))
        return record


def create_voice_clone(owner, output_root, sample, filename, name, model, consent_confirmed):
    if not consent_confirmed:
        raise UniArtTTSError('请确认已获得录音中说话人的音色复刻授权。')
    if not name or not name.strip() or len(name.strip()) > 80:
        raise UniArtTTSError('音色名称须为 1 至 80 个字符。')
    if model not in MODELS or Path(filename or '').suffix.lower() not in ALLOWED_SUFFIXES:
        raise UniArtTTSError('请选择 MiniMax 语音模型和 MP3、M4A 或 WAV 录音。')
    data = sample.read(MAX_SAMPLE_BYTES + 1)
    if not data or len(data) > MAX_SAMPLE_BYTES:
        raise UniArtTTSError('录音不能为空，且不能超过 20 MiB。')
    suffix = Path(filename).suffix.lower()
    valid_header = (
        (suffix == '.wav' and data.startswith(b'RIFF') and data[8:12] == b'WAVE')
        or (suffix == '.mp3' and (data.startswith(b'ID3') or
            (len(data) > 1 and data[0] == 0xff and data[1] & 0xe0 == 0xe0)))
        or (suffix == '.m4a' and data[4:8] == b'ftyp')
    )
    if not valid_header:
        raise UniArtTTSError('录音内容与文件格式不匹配。')
    config = studio_uniart_config()
    if catalog_name(config) != 'uniart' or not config.get('api_key') or not config.get('base_url'):
        raise UniArtTTSError('请在设置中配置 UniArt 网关和 API Key 后重试。', 409)
    try:
        catalog = fetch_selected_catalog(config)
    except Exception:
        raise UniArtTTSError('无法读取 UniArt 语音模型目录。', 502) from None
    if not any(item.get('api_model_id') == model and 'audio' in item.get('capabilities', []) for item in catalog):
        raise UniArtTTSError('当前 UniArt 凭据不可使用此语音模型。', 409)
    voice = 'iframe' + uuid4().hex
    try:
        response = requests.post(
            config['base_url'].rstrip('/') + '/minimax/voice-clone',
            headers={'Authorization': f"Bearer {config['api_key']}"},
            data={'model': model, 'voice_id': voice, 'consent_confirmed': 'true'},
            files={'sample': (Path(filename).name, data)}, timeout=(10, 180),
        )
    except requests.RequestException:
        raise UniArtTTSError('UniArt 音色复刻请求连接失败或超时，请重试。', 502) from None
    if response.status_code != 200:
        raise UniArtTTSError(f'UniArt 音色复刻失败（HTTP {response.status_code}）。', 502)
    try:
        result = response.json()
    except ValueError:
        raise UniArtTTSError('UniArt 音色复刻响应无效。', 502) from None
    if (not isinstance(result, dict) or result.get('voice_id') != voice
            or not isinstance(result.get('file_id'), int) or result['file_id'] <= 0):
        raise UniArtTTSError('UniArt 音色复刻响应缺少有效音色或文件 ID。', 502)
    return VoiceCloneStore(output_root).add(owner, name.strip(), model, voice)
