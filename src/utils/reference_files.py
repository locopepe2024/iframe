"""Read owned reference documents and normalize audio containers for Chat."""
import os
from pathlib import Path
import subprocess
import tempfile

TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.srt', '.vtt'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.aiff', '.aif', '.wma'}


def read_reference_text(path: str) -> str:
    with open(path, 'rb') as source:
        data = source.read(256 * 1024 + 1)
    if len(data) > 256 * 1024:
        raise ValueError('文本参考最大 256 KB')
    try:
        return data.decode('utf-8-sig')
    except UnicodeError as error:
        raise ValueError('文本参考需要 UTF-8 编码') from error


def chat_audio(path: str) -> tuple[bytes, str]:
    """Keep small MP3/WAV inputs; convert other/large files without trimming."""
    size = os.path.getsize(path)
    if size > 100 * 1024 * 1024:
        raise ValueError('音频文件最大 100 MB')
    suffix = Path(path).suffix.lower()
    if suffix in {'.mp3', '.wav'} and size <= 512 * 1024:
        return Path(path).read_bytes(), suffix[1:]
    with tempfile.TemporaryDirectory(prefix='lumenx-chat-audio-') as folder:
        target = Path(folder) / 'reference.mp3'
        try:
            subprocess.run([
                'ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                '-i', os.path.abspath(path), '-map', '0:a:0', '-vn',
                '-c:a', 'libmp3lame', '-b:a', '64k', str(target),
            ], check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except FileNotFoundError as error:
            raise ValueError('服务器音频转换组件不可用，请使用 MP3/WAV 或联系管理员') from error
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise ValueError('音频无法解码或转换超时，请检查文件后重试') from error
        if not target.is_file() or not target.stat().st_size:
            raise ValueError('音频转换未产生有效内容')
        if target.stat().st_size > 10 * 1024 * 1024:
            raise ValueError('转换后音频过大，当前 Chat 接口无法接收；未截断原音频')
        return target.read_bytes(), 'mp3'
