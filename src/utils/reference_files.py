"""Read owned reference documents and normalize audio containers for Chat."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib

from pypdf import PdfReader

TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.srt', '.vtt'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.aiff', '.aif', '.wma'}
DOCUMENT_EXTENSIONS = {'.pdf', '.docx', '.pptx'}
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_DOCUMENT_CHARS = 50_000


def _document_text(parts: list[str]) -> str:
    text = '\n'.join(part.strip() for part in parts if part.strip())
    if not text:
        raise ValueError('文档没有可提取文字；扫描版 PDF 请先进行 OCR')
    if len(text) > MAX_DOCUMENT_CHARS:
        raise ValueError('文档提取文字超过 50000 字符，请拆分文件后重试')
    return text


def _office_xml(archive: zipfile.ZipFile, name: str) -> ET.Element:
    item = archive.getinfo(name)
    if item.file_size > 20 * 1024 * 1024:
        raise ValueError('文档解压后过大，请拆分文件后重试')
    raw = archive.read(item)
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('文档包含不支持的 XML 声明')
    return ET.fromstring(raw)


def read_reference_document(path: str) -> str:
    """Extract bounded, ordered text from an owned document for Chat input."""
    suffix = Path(path).suffix.lower()
    if suffix not in DOCUMENT_EXTENSIONS:
        raise ValueError('不支持的文档格式')
    if os.path.getsize(path) > MAX_DOCUMENT_BYTES:
        raise ValueError('文档最大 10 MB，请拆分文件后重试')
    if suffix == '.pdf':
        with open(path, 'rb') as source:
            if source.read(5) != b'%PDF-':
                raise ValueError('PDF 无法解析，请检查文件')
        try:
            reader = PdfReader(path, strict=False)
        except Exception as error:
            raise ValueError('PDF 无法解析，请检查文件') from error
        try:
            if reader.is_encrypted:
                raise ValueError('加密 PDF 暂不支持，请先解除密码')
            if len(reader.pages) > 100:
                raise ValueError('PDF 超过 100 页，请拆分文件后重试')
            parts = []
            text_length = 0
            for index, page in enumerate(reader.pages, 1):
                try:
                    content = (page.extract_text() or '').strip()
                except Exception as error:
                    raise ValueError('PDF 无法提取文字，请检查文件') from error
                if content:
                    parts.append(f'[第 {index} 页]\n{content}')
                    text_length += len(parts[-1])
                if text_length > MAX_DOCUMENT_CHARS:
                    raise ValueError('文档提取文字超过 50000 字符，请拆分文件后重试')
        except ValueError:
            raise
        except Exception as error:
            raise ValueError('PDF 无法解析，请检查文件') from error
        return _document_text(parts)

    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > 1000 or sum(item.file_size for item in members) > 20 * 1024 * 1024:
                raise ValueError('文档解压后过大，请拆分文件后重试')
            if suffix == '.docx':
                root = _office_xml(archive, 'word/document.xml')
                paragraphs = root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')
                parts = [''.join(node.text or '' for node in paragraph.iter(
                    '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')) for paragraph in paragraphs]
            else:
                slides = sorted(
                    ((int(match.group(1)), item.filename) for item in members
                     if (match := re.fullmatch(r'ppt/slides/slide(\d+)\.xml', item.filename))),
                )
                if len(slides) > 100:
                    raise ValueError('PPTX 超过 100 页，请拆分文件后重试')
                parts = []
                for number, name in slides:
                    root = _office_xml(archive, name)
                    paragraphs = root.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}p')
                    content = '\n'.join(''.join(node.text or '' for node in paragraph.iter(
                        '{http://schemas.openxmlformats.org/drawingml/2006/main}t')) for paragraph in paragraphs)
                    if content.strip():
                        parts.append(f'[幻灯片 {number}]\n{content}')
            return _document_text(parts)
    except (zipfile.BadZipFile, KeyError, ET.ParseError, RuntimeError, EOFError, zlib.error) as error:
        raise ValueError('文档无法解析，请检查文件') from error


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
