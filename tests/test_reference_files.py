import base64
import subprocess
import zipfile
from unittest.mock import Mock

import pytest

from src.apps import agent_api as agent
from src.utils import reference_files
from src.utils.reference_files import chat_audio, read_reference_document


def test_docx_and_pptx_are_extracted_in_reading_order(tmp_path):
    docx = tmp_path / 'story.docx'
    with zipfile.ZipFile(docx, 'w') as archive:
        archive.writestr('word/document.xml',
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:body><w:p><w:r><w:t>第一幕</w:t></w:r></w:p>'
            '<w:p><w:r><w:t>人来人往</w:t></w:r></w:p></w:body></w:document>')
    assert read_reference_document(str(docx)) == '第一幕\n人来人往'

    pptx = tmp_path / 'slides.pptx'
    with zipfile.ZipFile(pptx, 'w') as archive:
        for number, text in [(2, '第二页'), (1, '第一页')]:
            archive.writestr(f'ppt/slides/slide{number}.xml',
                '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                f'<a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sld>')
    assert read_reference_document(str(pptx)) == '[幻灯片 1]\n第一页\n[幻灯片 2]\n第二页'


def test_pdf_text_is_extracted_with_page_markers(tmp_path, monkeypatch):
    pdf = tmp_path / 'script.pdf'
    pdf.write_bytes(b'%PDF-1.7\nfixture')
    monkeypatch.setattr(reference_files, 'PdfReader', lambda *args, **kwargs: Mock(
        is_encrypted=False, pages=[Mock(extract_text=lambda: '开场'), Mock(extract_text=lambda: '转场')] ))
    assert read_reference_document(str(pdf)) == '[第 1 页]\n开场\n[第 2 页]\n转场'


@pytest.mark.parametrize('name,contents,expected', [
    ('bad.docx', b'not-a-zip', '无法解析'),
    ('bad.pptx', b'not-a-zip', '无法解析'),
    ('empty.pdf', b'not-a-pdf', '无法解析'),
])
def test_invalid_document_reports_useful_error(tmp_path, name, contents, expected):
    path = tmp_path / name
    path.write_bytes(contents)
    with pytest.raises(ValueError, match=expected):
        read_reference_document(str(path))


def test_agent_document_reference_is_text_for_chat_and_context_ir(tmp_path, monkeypatch):
    docx = tmp_path / 'story.docx'
    with zipfile.ZipFile(docx, 'w') as archive:
        archive.writestr('word/document.xml',
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:p><w:r><w:t>暮秋的长街人来人往</w:t></w:r></w:p></w:document>')
    monkeypatch.setattr(agent, 'owned_library_image_key', lambda *args: None)
    monkeypatch.setattr(agent, 'reference_path', lambda *args: str(docx))
    assert '暮秋的长街人来人往' in agent.reference_content(None, 'owned-reference')['text']
    assert '暮秋的长街人来人往' in agent._context_ir_reference_content(None, 'owned-reference')['text']


def test_scanned_pdf_is_rejected_instead_of_sending_empty_context(tmp_path, monkeypatch):
    pdf = tmp_path / 'scan.pdf'
    pdf.write_bytes(b'%PDF-1.7\nfixture')
    monkeypatch.setattr(reference_files, 'PdfReader', lambda *args, **kwargs: Mock(
        is_encrypted=False, pages=[Mock(extract_text=lambda: '')]))
    with pytest.raises(ValueError, match='没有可提取文字'):
        read_reference_document(str(pdf))


def test_document_over_text_budget_is_rejected_without_truncation(tmp_path):
    docx = tmp_path / 'long.docx'
    with zipfile.ZipFile(docx, 'w') as archive:
        archive.writestr('word/document.xml',
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:p><w:r><w:t>' + '字' * 50001 + '</w:t></w:r></w:p></w:document>')
    with pytest.raises(ValueError, match='提取文字超过'):
        read_reference_document(str(docx))


def test_office_xml_entities_are_rejected(tmp_path):
    docx = tmp_path / 'entity.docx'
    with zipfile.ZipFile(docx, 'w') as archive:
        archive.writestr('word/document.xml', '<!DOCTYPE document [<!ENTITY x "unsafe">]><document>&x;</document>')
    with pytest.raises(ValueError, match='XML 声明'):
        read_reference_document(str(docx))


def test_m4a_reference_is_converted_and_sent_as_valid_mp3(tmp_path, monkeypatch):
    original = tmp_path / 'voice.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
                    '-c:a', 'aac', str(original)], check=True)
    before = original.read_bytes()
    monkeypatch.setattr(agent, 'owned_library_image_key', lambda *args: None)
    monkeypatch.setattr(agent, 'reference_path', lambda *args: str(original))
    content = agent.reference_content(None, 'owned-reference')
    assert content['type'] == 'input_audio'
    assert content['input_audio']['format'] == 'mp3'
    result = tmp_path / 'result.mp3'
    result.write_bytes(base64.b64decode(content['input_audio']['data']))
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(result)], text=True))
    assert 1 <= duration < 1.2
    assert original.read_bytes() == before


def test_invalid_audio_reports_decode_failure_without_raw_ffmpeg_output(tmp_path):
    bad = tmp_path / 'private-name.m4a'
    bad.write_bytes(b'invalid-container')
    with pytest.raises(ValueError, match='无法解码') as error:
        chat_audio(str(bad))
    assert str(bad) not in str(error.value)
