from pathlib import Path
import base64
from io import BytesIO
from zipfile import ZipFile


def _doc(text: str):
    return {
        "type": "doc",
        "content": [{"type": "action", "content": [{"type": "text", "text": text}]}],
    }


def test_snapshot_restore_preserves_replaced_document_and_returns_editor_contract(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    project_id = "story-opening"
    first = _doc("开端：雨夜，沈夏在车站等一通没有接通的电话。")
    second = _doc("开端：沈夏已经离开车站，城市灯光在车窗外后退。")

    saved = api.save_document(project_id, api.SaveDocumentRequest(content=first))
    assert saved["status"] == "ok"
    created = api.create_document_snapshot(project_id)
    timestamp = created["timestamp"]

    api.save_document(project_id, api.SaveDocumentRequest(content=second))
    restored = api.restore_document_snapshot(project_id, timestamp)

    assert restored["project_id"] == project_id
    assert restored["content"] == first
    assert restored["updated_at"]

    snapshots = api.list_document_snapshots(project_id)
    assert len(snapshots) == 2
    assert all(snapshot.created_at for snapshot in snapshots)
    assert all(snapshot.size_bytes > 0 for snapshot in snapshots)

    # The document remains writable after a restore.
    api.save_document(project_id, api.SaveDocumentRequest(content=restored["content"]))
    loaded = api.load_document(project_id)
    assert loaded["content"] == first


def test_snapshot_timestamps_do_not_overwrite_same_second(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    project_id = "rapid-edits"
    api.save_document(project_id, api.SaveDocumentRequest(content=_doc("v1")))

    first = api.create_document_snapshot(project_id)
    api.save_document(project_id, api.SaveDocumentRequest(content=_doc("v2")))
    second = api.create_document_snapshot(project_id)

    assert first["timestamp"] != second["timestamp"]
    assert len(api.list_document_snapshots(project_id)) == 2


def test_save_with_snapshot_captures_current_document_even_on_first_save(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    project_id = "current-version"
    current = _doc("当前编辑内容")

    result = api.save_document(
        project_id,
        api.SaveDocumentRequest(content=current, create_snapshot=True),
    )

    assert result["snapshot_created"] is True
    snapshots = api.list_document_snapshots(project_id)
    assert len(snapshots) == 1
    snapshot_path = api._get_project_dir(project_id) / "history" / f"{snapshots[0].timestamp}.json"
    assert api.json.loads(snapshot_path.read_text(encoding="utf-8")) == current


def test_legacy_project_opens_with_editable_source_text(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from src.apps.comic_gen import api

    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    monkeypatch.setattr(
        api,
        "pipeline",
        SimpleNamespace(get_script=lambda project_id: SimpleNamespace(
            id=project_id,
            original_text="故事的开端：沈夏在车站等电话。\n她最终转身离开。",
        )),
    )

    loaded = api.load_document("legacy-opening")

    assert loaded["content"]["type"] == "doc"
    assert [block["content"][0]["text"] for block in loaded["content"]["content"]] == [
        "故事的开端：沈夏在车站等电话。",
        "她最终转身离开。",
    ]


def test_docx_import_creates_editable_paragraphs_without_splitting_episodes():
    from src.apps.comic_gen import api

    document_xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body><w:p><w:r><w:t>第1集 甲到达</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>第2集 乙离开</w:t></w:r></w:p></w:body></w:document>'
    )
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
    request = api.ImportDocRequest(
        filename="series.docx", file_type="docx",
        content=base64.b64encode(buffer.getvalue()).decode(),
    )

    result = api.import_document("draft-project", request)

    assert result["file_type"] == "docx"
    assert [block["content"][0]["text"] for block in result["content"]["content"]] == [
        "第1集 甲到达", "第2集 乙离开",
    ]


def test_script_documents_are_owner_scoped_and_support_version_history(tmp_path, monkeypatch):
    from fastapi import HTTPException

    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    monkeypatch.setattr(api, "_TRON_SCRIPT_DOCUMENTS_DIR", Path(tmp_path) / "script-documents")
    owner = UserContext("user-a", "profile-a", "A", "")
    other = UserContext("user-b", "profile-b", "B", "")
    draft = _doc("创作原稿")

    created = api.create_script_document(api.CreateScriptDocumentRequest(title="原稿", content=draft), owner)
    document_id = created["id"]
    api.save_script_document(document_id, api.UpdateScriptDocumentRequest(content=_doc("修改稿")), owner)
    saved = api.save_script_document(
        document_id,
        api.UpdateScriptDocumentRequest(content=draft, create_snapshot=True),
        owner,
    )

    assert saved["snapshot_created"] is True
    assert len(api.list_script_document_snapshots(document_id, owner)) == 1
    snapshot = api.list_script_document_snapshots(document_id, owner)[0]
    api.save_script_document(document_id, api.UpdateScriptDocumentRequest(content=_doc("下一稿")), owner)
    restored = api.restore_script_document_snapshot(document_id, snapshot["timestamp"], owner)
    assert restored["content"] == draft
    assert len(api.list_script_document_snapshots(document_id, owner)) == 2
    assert api.list_script_documents(other) == []
    try:
        api.load_script_document(document_id, other)
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("another owner must not read this script")


def test_creating_project_from_script_copies_document_as_production_draft(tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    monkeypatch.setattr(api, "_TRON_SCRIPT_DOCUMENTS_DIR", Path(tmp_path) / "script-documents")
    monkeypatch.setattr(api, "_TRON_PROJECTS_DIR", Path(tmp_path) / "projects")
    user = UserContext("user-a", "profile-a", "A", "")
    content = _doc("创作稿正文\n第二行")
    document = api.create_script_document(api.CreateScriptDocumentRequest(title="原稿", content=content), user)
    created = {}

    def create_project(title, text, skip_analysis, workflow_mode, series_id, owner_user_id, owner_profile_id, source_script_document_id=None):
        created.update(locals())
        return SimpleNamespace(id="production-project")

    monkeypatch.setattr(api.pipeline, "create_project", create_project)
    monkeypatch.setattr(api, "signed_response", lambda result: result)
    result = asyncio.run(api.create_project(
        api.CreateProjectRequest(title="制作项目", text="ignored", source_script_document_id=document["id"]),
        skip_analysis=True,
        user=user,
    ))

    production = api.load_document(result.id)
    api.save_document(result.id, api.SaveDocumentRequest(content=_doc("制作阶段修改")))
    assert created["source_script_document_id"] == document["id"]
    assert created["text"] == "创作稿正文\n第二行"
    assert production["content"] == content
    assert api.load_script_document(document["id"], user)["content"] == content
