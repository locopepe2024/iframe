"""Owner-scoped Studio speech via UniArt's OpenAI-compatible audio endpoint.

Protocol evidence and migration boundary:
 docs/agents/deliverables/2026-10-21-uniart-character-audio.md
No credentials or SDK state are stored on processor instances.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from pathlib import Path

import requests

from ..apps.studio_access import require_studio_user, studio_media_dir, studio_uniart_config
from ..utils.provider_catalog import catalog_name, fetch_selected_catalog

MODELS = ('speech-2.8-hd', 'speech-2.8-turbo')
# Versioned official metadata; listing and synthesis share the same allowlist.
VOICES = json.loads(Path(__file__).with_name('minimax_system_voices.json').read_text(encoding='utf-8'))['voices']
VOICE_IDS = frozenset(voice['id'] for voice in VOICES)
EMOTIONS = {
    'happy': 'happy', '高兴': 'happy', '开心': 'happy',
    'sad': 'sad', '悲伤': 'sad', 'angry': 'angry', '愤怒': 'angry',
    'fearful': 'fearful', '害怕': 'fearful', 'disgusted': 'disgusted', '厌恶': 'disgusted',
    'surprised': 'surprised', '惊讶': 'surprised', 'calm': 'calm', '平静': 'calm', '中性': 'calm',
}


class UniArtTTSError(RuntimeError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


class UniArtTTSProcessor:
    def _config_and_models(self):
        config = studio_uniart_config()
        if catalog_name(config) != 'uniart' or not config.get('api_key') or not config.get('base_url'):
            raise UniArtTTSError('请在设置中配置 UniArt 网关和 API Key 后重试。', 409)
        try:
            catalog = fetch_selected_catalog(config)
        except Exception:
            raise UniArtTTSError('无法读取 UniArt 语音模型目录，请检查网关配置和网络后重试。', 502) from None
        models = {m['api_model_id'] for m in catalog if 'audio' in m.get('capabilities', [])}
        return config, [model for model in MODELS if model in models]

    def list_voices(self):
        _, models = self._config_and_models()
        return [dict(voice, id=f"uniart:{model}:{voice['id']}",
                     model=model, family='minimax', supports_instruction=False, origin='system')
                for model in models for voice in VOICES]

    def _prepare(self, text, voice, speech_rate, pitch_rate, volume, instructions,
                 model_override=None, family_override=None):
        parts = (voice or '').split(':')
        if (len(parts) != 3 or parts[0] != 'uniart' or parts[1] not in MODELS
                or parts[2] not in VOICE_IDS):
            raise UniArtTTSError('此音色不兼容 UniArt，请打开音色库重新选择并保存。')
        model, voice_id = parts[1:]
        if model_override not in (None, model) or family_override not in (None, 'minimax'):
            raise UniArtTTSError('旧自定义音色尚未迁移，请重新选择 UniArt 音色。')
        if not isinstance(text, str) or not text.strip() or len(text) > 20000:
            raise UniArtTTSError('语音文本不能为空，且不能超过 20000 字。')
        if (not math.isfinite(speech_rate) or not .5 <= speech_rate <= 2
                or not math.isfinite(pitch_rate) or not .5 <= pitch_rate <= 2
                or not math.isfinite(volume) or not 0 < volume <= 100):
            raise UniArtTTSError('语速和音调范围为 0.5–2，音量范围为 1–100。')
        # Preserve the existing rate UI: 1 is original pitch, .5/2 are -/+12 semitones.
        settings = dict(speed=speech_rate, pitch=round(12 * math.log2(pitch_rate)), vol=volume / 50)
        if instructions and instructions.strip():
            value = instructions.strip().removeprefix('情绪：').strip().lower()
            if value not in EMOTIONS:
                raise UniArtTTSError('当前 UniArt 音色仅支持高兴、悲伤、愤怒、害怕、厌恶、惊讶、平静情绪；请清除其他演绎指令。')
            settings['emotion'] = EMOTIONS[value]
        config, models = self._config_and_models()
        if model not in models:
            raise UniArtTTSError('当前 UniArt 凭据不可使用此语音模型，请重新选择可用音色。', 409)
        payload = dict(model=model, input=text, voice=voice_id, response_format='mp3',
                       speed=speech_rate, metadata={'voice_setting': settings})
        return config, payload

    def _write(self, config, payload, output_path):
        try:
            response = requests.post(config['base_url'].rstrip('/') + '/audio/speech',
                                     headers={'Authorization': f"Bearer {config['api_key']}"},
                                     json=payload, timeout=(10, 120))
        except requests.RequestException:
            raise UniArtTTSError('UniArt 语音请求连接失败或超时，请重试。', 502) from None
        if response.status_code != 200:
            raise UniArtTTSError(f'UniArt 语音生成失败（HTTP {response.status_code}），请检查网关权限、余额或稍后重试。', 502)
        content = response.content
        # Reject JSON/HTML errors even if an upstream returned HTTP 200.
        if not content or not (content.startswith(b'ID3') or
                               (len(content) > 1 and content[0] == 0xff and content[1] & 0xe0 == 0xe0)):
            raise UniArtTTSError('UniArt 未返回有效 MP3 音频，请重试。', 502)
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.tmp', delete=False) as stream:
                temp_path = stream.name
                stream.write(content)
            os.replace(temp_path, target)
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)
        return os.fspath(target)

    def synthesize(self, text, output_path, voice=None, speech_rate=1.0, pitch_rate=1.0,
                   volume=50, instructions=None, model_override=None, family_override=None):
        config, payload = self._prepare(text, voice, speech_rate, pitch_rate, volume,
                                        instructions, model_override, family_override)
        return self._write(config, payload, output_path)

    def preview(self, *, output_root, text, voice, speech_rate=1.0, pitch_rate=1.0,
                volume=50, instructions=None):
        user = require_studio_user()
        config, payload = self._prepare(text, voice, speech_rate, pitch_rate, volume, instructions)
        identity = json.dumps([config['base_url'].rstrip('/'), payload], sort_keys=True, ensure_ascii=False)
        key = hashlib.sha256(identity.encode()).hexdigest()
        directory = Path(studio_media_dir(user.owner_profile_id, 'audio', output_root=output_root)) / 'voice_preview'
        target = directory / f'{key}.mp3'
        cached = target.is_file() and target.stat().st_size > 0
        if not cached:
            self._write(config, payload, target)
        return {'url': os.path.relpath(target, output_root), 'cached': cached}
